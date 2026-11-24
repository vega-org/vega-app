import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import {DeviceEventEmitter} from 'react-native';
import {mainStorage} from '../storage/StorageService';
import {getCookieHeader} from '../services/cookieManager';
import {remoteDeliveryService} from './remoteDeliveryService';
import {useRemoteStore} from './remoteStore';
import type {RemoteMediaPayload} from './remotePlaybackManager';
import type {RemoteDevice,RemoteServer} from './types';
import type {SecureCastDelivery} from './secureCastDelivery';

interface SavedReceiver {receiverId:string;controllerId:string;token:string;name:string;serviceUrl:string}
interface AccessCapabilities {securePhoneDelivery?:boolean;host:'browser'|'native';nativeNetworking:boolean;customHeaders:boolean;browserSecurity:boolean}
interface CastMedia {processing?:'original'|'remuxed';servers?:{id:string;name:string;quality?:string;tags?:string[]}[];selectedServerId?:string;id:string;title:string;subtitle?:string;artwork?:string;providerStream?:RemoteMediaPayload['providerStream'];source:{url:string;format?:string;headers?:Record<string,string>};proxy?:{secure?:boolean;iceServers?:any[];source:{url:string;format?:string};subtitles?:{uri:string;language?:string;title?:string;type?:string}[]};subtitles?:{uri:string;language?:string;title?:string;type?:string}[];startPosition?:number;delivery:'direct'|'phone-proxy';attempt:number}
export interface VegaPairingState {invitation:string;confirmation?:string;error?:string;pairing:boolean}
export interface VegaReceiver extends RemoteDevice {paired:boolean;serviceUrl?:string;discoveryToken?:string}
const STORE_KEY='vega.cast.receivers.v1';
const DEFAULT_SERVICE_URL='https://cast.vega-app.in/vega-cast/v1';
const localSource=(url:string)=>/^(file:|content:|\/)|^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(url);
const mime=(type?:string)=>/m3u8|hls/i.test(type||'')?'application/vnd.apple.mpegurl':/mkv|matroska/i.test(type||'')?'video/x-matroska':'video/mp4';
const sourceFormat=(type?:string)=>/m3u8|hls|mpegurl/i.test(type||'')?'m3u8':/mkv|matroska/i.test(type||'')?'mkv':/mp4/i.test(type||'')?'mp4':/webm/i.test(type||'')?'webm':undefined;

class VegaCastService {
  private volumeTarget?:{value:number;expires:number};
  private queuedVolume?:number;
  private volumeSending?:Promise<void>;
  setVolume(value:number):Promise<void>{
    value=Math.max(0,Math.min(1,value));
    this.volumeTarget={value,expires:Date.now()+5000};
    useRemoteStore.getState().setVolume(value);
    this.queuedVolume=value;
    if(!this.volumeSending){
      const receiver=this.current;
      this.volumeSending=(async()=>{
        try{
          while(this.queuedVolume!==undefined&&this.current===receiver){
            const next=this.queuedVolume;this.queuedVolume=undefined;
            await this.command('VOLUME',next);
            if(this.volumeTarget)this.volumeTarget.expires=Date.now()+5000;
          }
        }catch(error){this.volumeTarget=undefined;throw error;}
        finally{this.queuedVolume=undefined;this.volumeSending=undefined;}
      })();
    }
    return this.volumeSending;
  }
  private current:SavedReceiver|null=null;
  private capabilities:AccessCapabilities={host:'browser',nativeNetworking:false,customHeaders:false,browserSecurity:true};
  private listeners=new Set<()=>void>();
  private pairing:VegaPairingState={invitation:'',pairing:false};
  private generation=0;
  private polling=false;
  private pollAbort:AbortController|null=null;
  private payload:RemoteMediaPayload|null=null;
  private media:CastMedia|null=null;
  private serverSelector?: (server:RemoteServer,position:number)=>void;
  private serverChoices=new Map<string,RemoteServer>();
  private serverSwitch?:{requestId:string;mediaId:string;position:number};
  private fallbackUsed=false;
  private sessions=new Set<string>();
  private secureDeliveries=new Map<string,SecureCastDelivery>();
  private pending=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private nearby:VegaReceiver[]=[];
  private services=new Set<string>();
  private discoveryTimer?:ReturnType<typeof setInterval>;
  private discoverySubscription?:{remove:()=>void};
  private discoveryAbort?:AbortController;
  private searching=false;
  private pairingGeneration=0;
  private records():SavedReceiver[]{return mainStorage.getObject<SavedReceiver[]>(STORE_KEY)||[];}
  getReceivers():VegaReceiver[]{const saved=this.records().map(record=>({id:record.receiverId,name:record.name,type:'vega-cast' as const,paired:true}));return [...saved,...this.nearby.filter(item=>!saved.some(record=>record.id===item.id))];}
  isDiscovering(){return this.searching;}
  startDiscovery(){
    if(!this.discoverySubscription)this.discoverySubscription=DeviceEventEmitter.addListener('VegaCastServiceDiscovered',(event:{serviceUrl?:string})=>{
      if(event.serviceUrl&&this.services.size<16){try{const url=new URL(event.serviceUrl);if(/^https?:$/.test(url.protocol)&&!url.username&&!url.password){this.services.add(url.toString().replace(/\/$/,''));void this.refreshDiscovery();}}catch{}}
    });
    if(!this.discoveryTimer)this.discoveryTimer=setInterval(()=>{void this.refreshDiscovery();},6000);
    void this.refreshDiscovery();
  }
  stopDiscovery(){if(this.discoveryTimer)clearInterval(this.discoveryTimer);this.discoveryTimer=undefined;this.discoverySubscription?.remove();this.discoverySubscription=undefined;this.discoveryAbort?.abort();this.searching=false;this.publish();}
  async refreshDiscovery(){
    if(this.searching)return;
    const configured=String(Constants.expoConfig?.extra?.vegaCastServiceUrl||'').trim();
    // Older builds embedded the previous website as their default. Keep saved
    // services and explicit custom endpoints, but discover on the current site.
    const primary=!configured||['https://vega.8man.in/vega-cast/v1','https://vega-app.in/vega-cast/v1'].includes(configured)?DEFAULT_SERVICE_URL:configured;
    const urls=[...new Set([primary,...this.records().map(record=>record.serviceUrl),...this.services])].filter(Boolean).slice(0,16);
    this.searching=true;this.publish();const abort=new AbortController();this.discoveryAbort=abort;const timer=setTimeout(()=>abort.abort(),5000);
    try {
      const results=await Promise.all(urls.map(async serviceUrl=>{try{const result=await this.request(serviceUrl,{op:'discover'},abort.signal);return (Array.isArray(result.receivers)?result.receivers:[]).filter((item:any)=>typeof item.receiverId==='string'&&typeof item.name==='string'&&typeof item.discoveryToken==='string').map((item:any)=>({id:item.receiverId,name:item.name,type:'vega-cast' as const,paired:false,serviceUrl,discoveryToken:item.discoveryToken}));}catch{return [];}}));
      if(!abort.signal.aborted)this.nearby=results.flat();
    }finally{clearTimeout(timer);if(this.discoveryAbort===abort){this.searching=false;this.publish();}}
  }
  getPairingState():VegaPairingState{return this.pairing;}
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private publish(){for(const listener of this.listeners)listener();}
  handleInvitation(url:string):boolean {
    if(!/^vega-cast:\/\/pair\?/i.test(url))return false;
    this.pairing={invitation:url,pairing:false};this.publish();return true;
  }
  private async request(serviceUrl:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<any>{
    const timeout=new AbortController();const timer=signal?undefined:setTimeout(()=>timeout.abort(),20_000);
    try{
      const response=await fetch(serviceUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal||timeout.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Vega Cast connection failed');return result;
    }finally{if(timer)clearTimeout(timer);}
  }
  private auth(){if(!this.current)throw new Error('Connect a Vega Cast receiver first');return{kind:'controller',receiverId:this.current.receiverId,controllerId:this.current.controllerId,token:this.current.token};}
  cancelPairing(){this.pairingGeneration++;this.pairing={invitation:'',pairing:false};this.publish();}
  async pair(input:string|VegaReceiver):Promise<string>{
    if(this.pairing.pairing)throw new Error('Pairing is already in progress');
    let serviceUrl='';let code='';let discoveryToken:string|undefined;let receiverId:string|undefined;
    if(typeof input==='string'){
      const invitation=new URL(input.trim());
      if(invitation.protocol!=='vega-cast:'||invitation.hostname!=='pair')throw new Error('Scan a Vega Cast receiver QR code');
      serviceUrl=invitation.searchParams.get('server')||'';code=invitation.searchParams.get('code')||'';
      if(!/^\d{6}$/.test(code))throw new Error('This QR code has expired or is invalid');
    }else{serviceUrl=input.serviceUrl||'';discoveryToken=input.discoveryToken;receiverId=input.id;if(!discoveryToken)throw new Error('Search for the receiver again');}
    if(!serviceUrl)throw new Error('Scan the receiver QR code');
    const server=new URL(serviceUrl);
    if(!/^https?:$/.test(server.protocol)||server.username||server.password)throw new Error('Invalid pairing service');
    serviceUrl=serviceUrl.replace(/\/$/,'');
    const generation=++this.pairingGeneration;
    const check=()=>{if(generation!==this.pairingGeneration)throw new Error('Pairing canceled');};
    this.pairing={invitation:typeof input==='string'?input:'',pairing:true};this.publish();
    try {
      const request=await this.request(serviceUrl,{op:'pair',...(discoveryToken?{receiverId,discoveryToken}:{code}),name:Constants.deviceName?.trim()||'Vega Mobile'});check();
      this.pairing={...this.pairing,confirmation:request.confirmation};this.publish();
      const deadline=Date.now()+120_000;
      while(Date.now()<deadline){
        const result=await this.request(serviceUrl,{op:'pairStatus',requestId:request.requestId,secret:request.secret});
        check();
        if(result.status==='rejected')throw new Error('Pairing was declined on the receiver');
        if(result.status==='approved'){
          const record:SavedReceiver={...result.grant,serviceUrl};
          mainStorage.setObject(STORE_KEY,[...this.records().filter(item=>item.receiverId!==record.receiverId),record]);
          this.pairing={invitation:'',pairing:false};this.publish();return record.receiverId;
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('Confirmation expired. Select the receiver or scan again.');
    } catch(error){if(generation===this.pairingGeneration){this.pairing={...this.pairing,pairing:false,error:error instanceof Error?error.message:'Pairing failed'};this.publish();}throw error;}
  }
  async connect(receiverId:string):Promise<void>{
    const record=this.records().find(item=>item.receiverId===receiverId);if(!record)throw new Error('Receiver is not paired');
    await this.disconnect(false);
    this.current=record;
    const connected=await this.request(record.serviceUrl,{op:'connect',auth:this.auth()});
    this.capabilities=connected.capabilities;
    useRemoteStore.getState().setConnectedDevice({id:record.receiverId,name:connected.name,type:'vega-cast'});
    useRemoteStore.getState().setStatus('idle');
    useRemoteStore.getState().setCapabilities({canSeek:true,canChangeAudio:true,canChangeSubtitles:true,canChangeVolume:true,canChangeSpeed:true,canChangeQuality:false});
    this.polling=true;void this.poll(record);this.publish();
  }
  private async poll(record:SavedReceiver){
    while(this.polling&&this.current===record){
      this.pollAbort=new AbortController();
      try {
        const result=await this.request(record.serviceUrl,{op:'poll',auth:this.auth()},this.pollAbort.signal);
        for(const message of result.messages)this.receive(message);
      } catch(error){
        if(!this.polling||this.current!==record)return;
        useRemoteStore.getState().setErrorMessage('Receiver connection interrupted. Playback may still be running.');
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
    }
  }
  private receive(message:any){
    const store=useRemoteStore.getState();
    if(['RTC_OFFER','RTC_ICE'].includes(message.type)){
      const delivery=this.secureDeliveries.get(message.mediaId);
      const negotiationError=(text:string)=>{
        store.setErrorMessage(text);
        if(this.current)void this.request(this.current.serviceUrl,{op:'send',auth:this.auth(),message:{type:'RTC_ERROR',mediaId:message.mediaId,transportId:message.transportId,error:text}}).catch(()=>{});
      };
      if(delivery)void delivery.signal(message).catch(error=>negotiationError(error.message||'Phone could not create the encrypted connection'));
      else if(message.type==='RTC_OFFER')negotiationError('Phone delivery session is no longer available. Select the stream again in Vega Mobile.');
      return;
    }
    if(message.type==='ACK'){
      const waiting=this.pending.get(message.id);if(!waiting)return;clearTimeout(waiting.timer);this.pending.delete(message.id);
      if(message.ok)waiting.resolve();else waiting.reject(new Error(message.error||'Receiver rejected command'));return;
    }
    if(message.type==='SERVER_CHANGE'){void this.handleServerChange(message).catch(error=>store.setErrorMessage(error.message));return;}
    if(message.type==='CAPABILITIES'){this.capabilities=message.capabilities;return;}
    if(message.type==='DELIVERY_CHANGED'){
      const media=this.media;
      if(media&&media.id===message.mediaId&&message.delivery==='phone-proxy'){
        this.media={...media,delivery:'phone-proxy',attempt:1};
        void remoteDeliveryService.startForegroundService({title:media.title,subtitle:'Vega Cast Ã‚Â· phone-assisted playback',isPlaying:true}).catch(()=>{});
      }
      return;
    }
    if(message.type==='FALLBACK_REQUEST'){void this.fallback(message).catch(error=>store.setErrorMessage(error.message));return;}
    if(message.type==='PLAYBACK_ERROR'){store.setErrorMessage(message.message||'Receiver playback failed');return;}
    if(message.type!=='STATE')return;
    const state=message.state;
    if(this.media&&state.mediaId===this.media.id&&state.delivery==='phone-proxy'){this.media={...this.media,delivery:'phone-proxy',attempt:1};}
    const status=state.status==='loaded'?'loading':state.status==='seeking'?'buffering':state.status==='ended'?'stopped':state.status;
    if(['idle','loading','buffering','playing','paused','stopped','error'].includes(status))store.setStatus(status);
    store.setTimeline(state.currentTime||0,state.duration||0);
    const target=this.volumeTarget;
    if(!target||(!this.volumeSending&&Date.now()>target.expires)||(this.queuedVolume===undefined&&Math.abs((state.volume??1)-target.value)<0.005)){
      this.volumeTarget=undefined;store.setVolume(state.volume??1,Boolean(state.isMuted));
    }
    store.setPlaybackRate(state.playbackRate||1);
    store.setAudioTracks((state.audioTracks||[]).map((track:any)=>({id:String(track.id),index:track.index,language:track.language||'und',title:track.label,codec:track.codec,channels:track.channels,isSelected:track.selected})),state.selectedAudioTrackId==null?undefined:String(state.selectedAudioTrackId));
    store.setSubtitleTracks((state.subtitleTracks||[]).map((track:any)=>({id:String(track.id),index:track.index,language:track.language||'und',title:track.label,isEmbedded:true,isSelected:track.selected})),state.selectedSubtitleTrackId==null?undefined:String(state.selectedSubtitleTrackId));
    store.setErrorMessage(state.error?.message);
    if(this.sessions.size)void remoteDeliveryService.updateMediaPlayback({isPlaying:status==='playing',position:state.currentTime||0,duration:state.duration||0}).catch(()=>{});
  }
  private async send(message:Record<string,unknown>):Promise<void>{
    if(!this.current)throw new Error('Receiver is disconnected');
    const record=this.current;const messageId=Crypto.randomUUID();
    const acknowledgement=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(messageId);reject(new Error('The receiver did not confirm this command'));},45_000);
      this.pending.set(messageId,{resolve,reject,timer});
    });
    let fallback:ReturnType<typeof setTimeout>|undefined;
    const relay=()=>this.request(record.serviceUrl,{op:'send',auth:this.auth(),message:{...message,id:messageId}});
    const delivery=this.media?this.secureDeliveries.get(this.media.id):undefined;
    // Attach a rejection handler before the network operation can fail.
    acknowledgement.catch(()=>{});
    try {
      if(message.type==='COMMAND'&&delivery?.sendControl({...message,id:messageId})){
        // Reuse the ID so a delayed direct command and its relay retry execute once.
        fallback=setTimeout(()=>{if(this.pending.has(messageId)&&this.current===record)void relay().catch(()=>{});},1500);
      }else await relay();
      await acknowledgement;
    }
    catch(error){const pending=this.pending.get(messageId);if(pending){clearTimeout(pending.timer);this.pending.delete(messageId);pending.reject(error instanceof Error?error:new Error('Command failed'));}throw error;}
    finally{if(fallback)clearTimeout(fallback);}
  }
  command(command:string,value?:unknown){return this.send({type:'COMMAND',command,value});}
  setServerSelector(selector:(server:RemoteServer,position:number)=>void):()=>void {
    this.serverSelector=selector;
    return()=>{if(this.serverSelector===selector)this.serverSelector=undefined;};
  }
  private async handleServerChange(message:any){
    if(!this.current)return;
    const reply=(ok:boolean,error?:string)=>this.request(this.current!.serviceUrl,{op:'send',auth:this.auth(),message:{type:'SERVER_CHANGE_RESULT',requestId:message.requestId,mediaId:message.mediaId,ok,error}});
    try{
      if(!this.media||message.mediaId!==this.media.id)throw new Error('This server list is no longer current');
      if(this.media.processing==='remuxed')throw new Error('Server switching is unavailable during remuxed playback');
      if(this.serverSwitch)throw new Error('A server change is already in progress');
      const server=this.serverChoices.get(message.serverId);
      if(!server||!this.serverSelector)throw new Error('Server selection is unavailable on mobile');
      const position=Number(message.position);
      if(!Number.isFinite(position)||position<0)throw new Error('Invalid playback position');
      this.serverSwitch={requestId:String(message.requestId),mediaId:this.media.id,position};
      this.serverSelector(server,position);
    }catch(error){if(this.serverSwitch?.requestId===String(message.requestId))this.serverSwitch=undefined;await reply(false,error instanceof Error?error.message:'Server change failed');}
  }
  private async finishServerChange(request:NonNullable<VegaCastService['serverSwitch']>,error?:string){
    if(this.serverSwitch!==request)return;
    this.serverSwitch=undefined;
    if(this.current)await this.request(this.current.serviceUrl,{op:'send',auth:this.auth(),message:{type:'SERVER_CHANGE_RESULT',requestId:request.requestId,mediaId:request.mediaId,ok:!error,error}}).catch(()=>{});
  }
  async addExternalSubtitle(uri:string):Promise<void>{
    if(this.capabilities.nativeNetworking&&!localSource(uri))return this.command('EXTERNAL_SUBTITLE',uri);
    const sessionId=`vega_sub_${Crypto.randomUUID()}`;this.sessions.add(sessionId);
    try{
      const prepared=await remoteDeliveryService.prepareStream({sessionId,sourceUrl:uri,isLocal:/^(file:|content:|\/)/.test(uri),mode:'proxy',mimeType:uri.split('?')[0].endsWith('.vtt')?'text/vtt':'application/x-subrip'});
      for(const delivery of this.secureDeliveries.values())delivery.register(prepared.streamUrl);
      await this.command('EXTERNAL_SUBTITLE',prepared.streamUrl);
    }catch(error){this.sessions.delete(sessionId);await remoteDeliveryService.cleanupSession(sessionId).catch(()=>{});throw error;}
  }
  async load(payload:RemoteMediaPayload):Promise<void>{
    const generation=++this.generation;this.payload=payload;this.fallbackUsed=false;
    const serverRequest=this.serverSwitch;
    const servers=(payload.servers||[]).slice(0,50);this.serverChoices=new Map(servers.map((server,index)=>['server-'+index,server]));
    useRemoteStore.getState().setStatus('loading');
    const headers:Record<string,string>={};
    if(Array.isArray(payload.headers))for(const pair of payload.headers as unknown as unknown[][]){if(pair.length>1)headers[String(pair[0])]=String(pair[1]);}
    else for(const [key,value] of Object.entries(payload.headers||{}))if(value!=null)headers[key]=String(value);
    if(!localSource(payload.sourceUrl)&&!Object.keys(headers).some(key=>key.toLowerCase()==='cookie')){
      const cookie=await getCookieHeader(payload.sourceUrl).catch(()=>undefined);if(cookie)headers.Cookie=cookie;
    }
    if(generation!==this.generation)return;
    const previousSessions=new Set(this.sessions);
    const media:CastMedia={id:Crypto.randomUUID(),title:payload.title,subtitle:payload.subtitle,artwork:payload.artwork,providerStream:payload.providerStream,
      source:{url:payload.sourceUrl,format:sourceFormat(payload.sourceType),headers},
      subtitles:payload.subtitles?.filter(track=>!track.isEmbedded&&track.uri).map(track=>({uri:track.uri!,language:track.language,title:track.title})),startPosition:serverRequest?.position??payload.initialPosition??0,delivery:'direct',attempt:0,processing:'original',
      servers:servers.map((server,index)=>({id:'server-'+index,name:server.name,quality:server.quality,tags:server.tags})),
      selectedServerId:[...this.serverChoices].find(([,server])=>server.id===(payload.serverId||payload.providerStream?.link)||server.link===payload.providerStream?.link)?.[0]};
    this.media=media;
    try{
      media.proxy=await this.prepareStandbyProxy(media,generation);
      await this.prepareSecureDelivery(media);
      if(generation!==this.generation)return;
      await this.send({type:'LOAD_MEDIA',media});
    }catch(error){
      this.secureDeliveries.get(media.id)?.close();this.secureDeliveries.delete(media.id);
      if(generation===this.generation){for(const key of [...this.sessions])if(!previousSessions.has(key)){this.sessions.delete(key);await remoteDeliveryService.cleanupSession(key).catch(()=>{});}}
      if(serverRequest)await this.finishServerChange(serverRequest,error instanceof Error?error.message:'Unable to load selected server');
      throw error;
    }
    if(serverRequest&&generation===this.generation)await this.finishServerChange(serverRequest);
    if(generation===this.generation){for(const [id,delivery] of this.secureDeliveries)if(id!==media.id){delivery.close();this.secureDeliveries.delete(id);}for(const key of previousSessions){this.sessions.delete(key);await remoteDeliveryService.cleanupSession(key).catch(()=>{});}}
    if(previousSessions.size&&!this.sessions.size)await remoteDeliveryService.stopForegroundService().catch(()=>{});
  }
  private async prepareStandbyProxy(media:CastMedia,generation:number):Promise<NonNullable<CastMedia['proxy']>>{
    const owned=new Set<string>();
    const register=async(url:string,headers:Record<string,string>,mimeType:string)=>{
      const sessionId=`vega_ready_${Crypto.randomUUID()}`;owned.add(sessionId);this.sessions.add(sessionId);
      return remoteDeliveryService.prepareStream({sessionId,sourceUrl:url,isLocal:localSource(url)||(url===media.source.url&&Boolean(this.payload?.isLocal)),headers,mode:'proxy',mimeType,startPositionSeconds:0,durationSeconds:this.payload?.duration});
    };
    try{
      const prepared=await register(media.source.url,media.source.headers||{},mime(media.source.format));
      const subtitles=[];
      for(const track of media.subtitles||[]){
        const sameOrigin=/^https?:\/\//i.test(track.uri)&&/^https?:\/\//i.test(media.source.url)&&new URL(track.uri).origin===new URL(media.source.url).origin;
        const subtitle=await register(track.uri,sameOrigin?media.source.headers||{}:{},track.uri.split('?')[0].endsWith('.vtt')?'text/vtt':'application/x-subrip');
        subtitles.push({...track,type:track.type||/\.(srt|vtt|ass|ssa|ttml)(?:[?#]|$)/i.exec(track.uri)?.[1],uri:subtitle.streamUrl});
      }
      if(generation!==this.generation)throw new Error('Source changed while preparing proxy');
      await remoteDeliveryService.startForegroundService({title:media.title,subtitle:'Vega Cast Ã‚Â· proxy ready',isPlaying:false});
      if(generation!==this.generation)throw new Error('Source changed while preparing proxy');
      return{source:{url:prepared.streamUrl,format:media.source.format},subtitles};
    }catch(error){for(const key of owned){this.sessions.delete(key);await remoteDeliveryService.cleanupSession(key).catch(()=>{});}if(!this.sessions.size)await remoteDeliveryService.stopForegroundService().catch(()=>{});throw error;}
  }
  private async prepareSecureDelivery(media:CastMedia){
    if(!this.capabilities.securePhoneDelivery||!media.proxy)return;
    // Metro loads the native module only when a receiver supports this path.
    const {SecureCastDelivery}=require('./secureCastDelivery') as typeof import('./secureCastDelivery');
    const iceServers=Array.isArray(Constants.expoConfig?.extra?.vegaCastIceServers)?Constants.expoConfig!.extra!.vegaCastIceServers:[];
    const current=this.current;if(!current)throw new Error('Receiver disconnected');
    const delivery=new SecureCastDelivery(message=>this.request(current.serviceUrl,{op:'send',auth:{kind:'controller',receiverId:current.receiverId,controllerId:current.controllerId,token:current.token},message}),media.id,[media.proxy.source.url,...(media.proxy.subtitles||[]).map(track=>track.uri)],iceServers);
    delivery.onControl=message=>{if(this.current===current&&this.secureDeliveries.get(media.id)===delivery)this.receive(message);};
    this.secureDeliveries.get(media.id)?.close();this.secureDeliveries.set(media.id,delivery);
    media.proxy={...media.proxy,secure:true,iceServers};
  }
  private async fallback(request:any){
    if(!this.media||request.mediaId!==this.media.id||this.fallbackUsed)return;
    this.fallbackUsed=true;
    if(request.category==='UNSUPPORTED_VIDEO_CODEC')throw new Error('This receiver cannot decode the video. Video transcoding is not available in this Vega Cast path.');
    await this.deliverProxy({...this.media,startPosition:Math.max(0,Number(request.position)||0)},request.category,this.generation);
  }
  private async deliverProxy(media:CastMedia,category:string,generation:number){
    const owned=new Set<string>();
    const sessionId=`vega_${Crypto.randomUUID()}`;owned.add(sessionId);this.sessions.add(sessionId);
    try {
      const mode=category==='UNSUPPORTED_AUDIO_CODEC'||category==='UNSUPPORTED_CONTAINER'?'ffmpeg':'proxy';
      let audioCodec:string|undefined;
      if(mode==='ffmpeg'){
        const inspection=await remoteDeliveryService.inspectTracks(media.source.url,Boolean(this.payload?.isLocal),media.source.headers,media.source.format);
        audioCodec=inspection.audioTracks[0]?.codec;
      }
      const prepared=await remoteDeliveryService.prepareStream({sessionId,sourceUrl:media.source.url,isLocal:Boolean(this.payload?.isLocal||/^(file:|content:|\/)/.test(media.source.url)),headers:media.source.headers,
        mode,mimeType:mode==='ffmpeg'?'video/mp4':mime(media.source.format),audioCodec,startPositionSeconds:0,durationSeconds:this.payload?.duration});
      if(mode==='ffmpeg'&&(!prepared.byteRangeSeek||prepared.timelineOffsetSeconds!==0))throw new Error('This conversion cannot provide independent receiver seeking');
      const subtitles=[];
      for(const track of media.subtitles||[]){
        if(!/^https?:\/\//i.test(track.uri))continue;
        const subId=`vega_sub_${Crypto.randomUUID()}`;owned.add(subId);this.sessions.add(subId);
        const sameOrigin=/^https?:\/\//i.test(media.source.url)&&new URL(track.uri).origin===new URL(media.source.url).origin;
        const sub=await remoteDeliveryService.prepareStream({sessionId:subId,sourceUrl:track.uri,mode:'proxy',headers:sameOrigin?media.source.headers:{},mimeType:track.uri.split('?')[0].endsWith('.vtt')?'text/vtt':'application/x-subrip'});
        subtitles.push({...track,type:track.type||/\.(srt|vtt|ass|ssa|ttml)(?:[?#]|$)/i.exec(track.uri)?.[1],uri:sub.streamUrl});
      }
      if(generation!==this.generation)return;
      await remoteDeliveryService.startForegroundService({title:media.title,subtitle:'Vega Cast Ã‚Â· phone-assisted playback',isPlaying:true});
      const replacement:CastMedia={...media,source:{url:prepared.streamUrl,format:mode==='ffmpeg'?'mp4':media.source.format},subtitles,delivery:'phone-proxy',attempt:1,processing:mode==='ffmpeg'?'remuxed':'original'};
      replacement.proxy={source:replacement.source,subtitles};
      await this.prepareSecureDelivery(replacement);
      this.media=replacement;
      await this.send({type:'FALLBACK_SOURCE',media:replacement});
    } catch(error){for(const key of owned){this.sessions.delete(key);void remoteDeliveryService.cleanupSession(key).catch(()=>{});}if(generation!==this.generation)return;throw error;}
    finally {if(generation!==this.generation)for(const key of owned){this.sessions.delete(key);void remoteDeliveryService.cleanupSession(key).catch(()=>{});}}
  }
  async disconnect(stopPlayback:boolean):Promise<void>{
    // Cancel mobile source preparation before awaiting any network request.
    this.generation++;
    if(this.current){
      const record=this.current;
      const message={type:'CONTROLLER_DISCONNECT',stopPlayback};
      // Send cancellation immediately; do not wait behind a blocked LOAD ACK.
      if(stopPlayback&&this.media)this.secureDeliveries.get(this.media.id)?.sendControl({type:'COMMAND',command:'STOP',id:Crypto.randomUUID()});
      try{await this.request(record.serviceUrl,{op:'send',auth:this.auth(),message});}catch{/* Still release local delivery resources when offline. */}
    }
    this.generation++;this.polling=false;this.pollAbort?.abort();this.current=null;
    for(const delivery of this.secureDeliveries.values())delivery.close();this.secureDeliveries.clear();
    for(const waiting of this.pending.values()){clearTimeout(waiting.timer);waiting.reject(new Error('Receiver disconnected'));}this.pending.clear();
    for(const key of this.sessions)await remoteDeliveryService.cleanupSession(key).catch(()=>{});this.sessions.clear();
    this.payload=null;this.media=null;this.serverChoices.clear();this.serverSwitch=undefined;
  }
  forget(receiverId:string){mainStorage.setObject(STORE_KEY,this.records().filter(record=>record.receiverId!==receiverId));this.publish();}
}
export const vegaCastService=new VegaCastService();
