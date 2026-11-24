import {RTCPeerConnection,RTCSessionDescription,RTCIceCandidate} from 'react-native-webrtc';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import {fromByteArray} from 'base64-js';
import {Buffer} from 'buffer';

type Signal={type:string;transportId:string;mediaId:string;sdp?:{type:string;sdp:string};candidate?:any};
/** Serve only URLs registered by Vega's existing media-delivery service. */
export class SecureCastDelivery {
 private peer:RTCPeerConnection|null=null;
 private channel:RTCDataChannel|null=null;
 private controls:RTCDataChannel|null=null;
 onControl?: (message:any)=>void;
 sendControl(message:Record<string,unknown>):boolean{
  if(this.controls?.readyState!=='open'||this.controls.bufferedAmount>64*1024)return false;
  try{this.controls.send(JSON.stringify(message));return true;}catch{return false;}
 }
 private id='';
 private allowed=new Set<string>();
 private aborted=new Set<AbortController>();
 private candidates=new Map<string,any[]>();
 private reads=0;
 constructor(private send:(message:Record<string,unknown>)=>Promise<unknown>,private mediaId:string,urls:string[],private iceServers:any[]=[]){
  urls.forEach(url=>this.allowed.add(new URL(url).toString()));
 }
 register(url:string){this.allowed.add(new URL(url).toString());}
 async signal(message:Signal){
  if(message.mediaId!==this.mediaId||typeof message.transportId!=='string')return;
  if(message.type==='RTC_ICE'&&message.candidate){
   if(this.id===message.transportId&&this.peer?.remoteDescription)await this.peer.addIceCandidate(new RTCIceCandidate(message.candidate));
   else{const queue=this.candidates.get(message.transportId)||[];if(this.candidates.size<4&&queue.length<64){queue.push(message.candidate);this.candidates.set(message.transportId,queue);}}
   return;
  }
  if(message.type!=='RTC_OFFER'||!message.sdp||message.sdp.type!=='offer')return;
  if(this.id===message.transportId&&this.peer?.localDescription?.type==='answer'){
   await this.send({type:'RTC_ANSWER',transportId:this.id,mediaId:this.mediaId,sdp:this.peer.localDescription});return;
  }
  if(this.id===message.transportId&&this.peer)return; // Answer construction is already in flight.
  this.closePeer();this.id=message.transportId;
  const transportId=message.transportId;
  const peer=this.peer=new RTCPeerConnection({iceServers:this.iceServers});
  peer.addEventListener('icecandidate',event=>{if(event.candidate&&this.peer===peer)void this.send({type:'RTC_ICE',transportId,mediaId:this.mediaId,candidate:event.candidate.toJSON()}).catch(()=>{});});
  peer.addEventListener('datachannel',event=>{
   if(event.channel.label==='vega-controls-v1'){
    const controls=this.controls=event.channel;
    controls.addEventListener('message',event=>{
     if(this.controls!==controls||typeof event.data!=='string'||event.data.length>65536)return;
     try{const message=JSON.parse(event.data);if(['ACK','STATE'].includes(message.type))this.onControl?.(message);}catch{}
    });return;
   }
   if(event.channel.label!=='vega-media-v1'){event.channel.close();return;}
   const channel=this.channel=event.channel;
   channel.addEventListener('message',event=>{if(this.channel===channel)void this.read(event.data);});
  });
  await peer.setRemoteDescription(new RTCSessionDescription(message.sdp as any));
  for(const candidate of this.candidates.get(this.id)||[])await peer.addIceCandidate(new RTCIceCandidate(candidate));
  this.candidates.clear();
  await peer.setLocalDescription(await peer.createAnswer());
  if(this.peer===peer)await this.send({type:'RTC_ANSWER',transportId,mediaId:this.mediaId,sdp:peer.localDescription});
 }
 private async sendData(channel:RTCDataChannel,message:Record<string,unknown>){
  const until=Date.now()+10_000;
  while(channel.bufferedAmount>256*1024){
   if(channel.readyState!=='open'||Date.now()>until)throw new Error('Encrypted channel backpressure timeout');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(channel.readyState!=='open')throw new Error('Encrypted channel disconnected');
  channel.send(JSON.stringify(message));
 }
 private async read(raw:unknown){
  const channel=this.channel;if(!channel||typeof raw!=='string'||raw.length>8192)return;
  let message;try{message=JSON.parse(raw);}catch{return;}
  if(message.type!=='READ'||typeof message.id!=='string'||message.id.length>80)return;
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),25_000);
  let counted=false;
  try{
   if(this.reads>=8)throw new Error('Too many simultaneous media reads');
   const url=new URL(message.url);
   if(!this.allowed.has(url.toString()))throw new Error('Media resource is not registered for this session');
   if(!['GET','HEAD'].includes(message.method))throw new Error('Unsupported media method');
   this.reads++;counted=true;this.aborted.add(abort);
   const playlist=/\.m3u8(?:\?|$)/i.test(url.toString());
   const hls=url.pathname.startsWith('/hls/');
   // Native fetch talks only to registered phone delivery sessions here.
   // Closing local HTTP responses avoids stale pooled NanoHTTPD sockets.
   const headers:Record<string,string>={Connection:'close'};
   // Bound progressive reads. HLS fragments must remain complete for demuxing.
   if(!hls){
    const match=typeof message.range==='string'?/^bytes=(\d+)-(\d*)$/.exec(message.range):null;
    if(message.range&&!match)throw new Error('Unsupported range');
    const start=match?Number(match[1]):0;
    if(!Number.isSafeInteger(start)||start<0)throw new Error('Invalid range');
    const end=Math.min(start+512*1024-1,match?.[2]?Number(match[2]):Infinity);
    headers.Range=`bytes=${start}-${end}`;
   }else if(message.range){if(!/^bytes=\d+-\d*$/.test(message.range))throw new Error('Unsupported range');headers.Range=message.range;}
   const read=()=>fetch(url.toString(),{method:message.method,headers,signal:abort.signal,redirect:'error'});
   let response:Response;
   try{response=await read();}catch(error){
    if(abort.signal.aborted||!/Unexpected status line|ProtocolException/i.test(String(error)))throw error;
    response=await read(); // One retry; no response bytes have been delivered.
   }
   if(!response.ok&&response.status!==416){
    try{await response.body?.cancel();}catch{/* Preserve the original HTTP failure. */}
    throw new Error(`Phone media request failed (HTTP ${response.status})`);
   }
   const responseHeaders:Record<string,string>={};
   for(const name of ['content-type','content-length','content-range','accept-ranges']){const value=response.headers.get(name);if(value)responseHeaders[name]=value;}
   if(Number(responseHeaders['content-length'])>16*1024*1024)throw new Error('Media fragment exceeds encrypted transfer limit');
   const body=message.method==='HEAD'?new Uint8Array():new Uint8Array(await response.arrayBuffer());
   if(body.length>16*1024*1024)throw new Error('Media fragment exceeds encrypted transfer limit');
   if(!hls&&message.method!=='HEAD'&&response.ok&&response.status!==206&&body.length>=512*1024)throw new Error('Phone delivery does not support byte-range reads');
   if((playlist||/mpegurl/i.test(responseHeaders['content-type']||''))&&response.ok){
    // Only references learned from a registered playlist become readable.
    const text=Buffer.from(body).toString('utf8');
    for(const line of text.split(/\r?\n/)){
     const refs=line.startsWith('#')?[...line.matchAll(/URI="([^"]+)"/g)].map(match=>match[1]):line.trim()?[line.trim()]:[];
     for(const ref of refs){const target=new URL(ref,url);if(target.origin===url.origin&&this.allowed.size<10_000)this.allowed.add(target.toString());}
    }
   }
   for(let offset=0;offset<body.length;offset+=12*1024)await this.sendData(channel,{type:'DATA',id:message.id,data:fromByteArray(body.subarray(offset,offset+12*1024))});
   await this.sendData(channel,{type:'DONE',id:message.id,status:response.status,headers:responseHeaders});
  }catch(error){if(channel.readyState==='open')channel.send(JSON.stringify({type:'ERROR',id:message.id,message:error instanceof Error?error.message:'Phone media read failed'}));}
  finally{clearTimeout(timer);this.aborted.delete(abort);if(counted)this.reads--;}
 }
 private closePeer(){for(const abort of this.aborted)abort.abort();this.aborted.clear();this.controls?.close();this.controls=null;this.channel?.close();this.peer?.close();this.channel=null;this.peer=null;}
 close(){this.closePeer();this.allowed.clear();this.candidates.clear();}
}
