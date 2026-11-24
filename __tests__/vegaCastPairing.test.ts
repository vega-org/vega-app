const mockStorage=new Map();
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{vegaCastServiceUrl:'https://cast.example/vega-cast/v1'}}}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'test-command'}));
jest.mock('react-native',()=>({DeviceEventEmitter:{addListener:()=>({remove:()=>{}})}}));
jest.mock('../src/lib/storage/StorageService',()=>({mainStorage:{getObject:(key:string)=>mockStorage.get(key),setObject:(key:string,value:unknown)=>mockStorage.set(key,value)}}));
jest.mock('../src/lib/services/cookieManager',()=>({getCookieHeader:jest.fn()}));
jest.mock('../src/lib/remote/remoteDeliveryService',()=>({remoteDeliveryService:{}}));
jest.mock('../src/lib/remote/remoteStore',()=>({useRemoteStore:{getState:()=>({})}}));
jest.mock('../src/lib/remote/secureCastDelivery',()=>({SecureCastDelivery:jest.fn().mockImplementation(()=>({close:jest.fn(),signal:jest.fn(async()=>{}),register:jest.fn()}))}));
describe('Vega Cast selection and QR pairing',()=>{
 let service:any;
 const requests:any[]=[];
 beforeEach(()=>{
  jest.resetModules();mockStorage.clear();requests.length=0;
  global.fetch=jest.fn(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));requests.push(body);
   const data=body.op==='discover'?{receivers:[{receiverId:'screen',name:'Living room',discoveryToken:'selection-token'}]}:
    body.op==='pair'?{requestId:'request',secret:'private',confirmation:'5678'}:
    {status:'approved',grant:{receiverId:'screen',controllerId:'phone',token:'saved-secret',name:'Living room'}};
   return {ok:true,json:async()=>data} as Response;
  });
  service=require('../src/lib/remote/vegaCastService').vegaCastService;
 });
 afterEach(()=>service.stopDiscovery());
 it('selects a discovered receiver without submitting a manually entered code',async()=>{
  await service.refreshDiscovery();
  const receiver=service.getReceivers()[0];
  expect(receiver.name).toBe('Living room');expect(receiver.paired).toBe(false);
  expect(await service.pair(receiver)).toBe('screen');
  expect(requests.find(item=>item.op==='pair')).toEqual({op:'pair',receiverId:'screen',discoveryToken:'selection-token',name:'Vega Mobile'});
  expect(service.getReceivers()[0].paired).toBe(true);
  expect(service.getReceivers()[0].token).toBeUndefined();
 });
 it('retains QR invitations and rejects bare code input',async()=>{
  await expect(service.pair('123456')).rejects.toThrow();
  expect(requests).toEqual([]);
  await service.pair('vega-cast://pair?server=https%3A%2F%2Fcast.example%2Fvega-cast%2Fv1&code=123456');
  expect(requests[0]).toEqual({op:'pair',code:'123456',name:'Vega Mobile'});
 });
 it('does not save or connect a grant after pairing is canceled',async()=>{
  let complete:(value:unknown)=>void=()=>{};
  global.fetch=jest.fn(()=>new Promise(resolve=>{complete=resolve;}));
  const pairing=service.pair({id:'screen',name:'Living room',type:'vega-cast',paired:false,serviceUrl:'https://cast.example/vega-cast/v1',discoveryToken:'token'});
  service.cancelPairing();
  complete({ok:true,json:async()=>({requestId:'request',secret:'private',confirmation:'5678'})});
  await expect(pairing).rejects.toThrow('canceled');
  expect(service.getReceivers()).toEqual([]);
 });
});
it('uses the phone device name in the receiver confirmation request',async()=>{
 jest.resetModules();
 const constants=require('expo-constants').default;constants.deviceName='My phone';
 const service=require('../src/lib/remote/vegaCastService').vegaCastService;
 global.fetch=jest.fn(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  if(body.op==='pair')expect(body.name).toBe('My phone');
  return {ok:true,json:async()=>body.op==='pair'?{requestId:'request',secret:'private',confirmation:'1234'}:{status:'approved',grant:{receiverId:'screen',controllerId:'phone',token:'saved-secret',name:'Living room'}}} as Response;
 });
 await service.pair('vega-cast://pair?server=https%3A%2F%2Fcast.example%2Fvega-cast%2Fv1&code=123456');
});
it.each(['direct','phone-proxy'])('explicit stop disconnects %s playback without waiting for a STOP acknowledgement',async delivery=>{
 jest.resetModules();
 const service=require('../src/lib/remote/vegaCastService').vegaCastService;
 service.current={receiverId:'screen',controllerId:'phone',token:'saved-secret',serviceUrl:'https://cast.example/vega-cast/v1'};
 service.media={delivery};
 service.command=jest.fn(async()=>{});
 const messages:any[]=[];
 global.fetch=jest.fn(async(_url,init)=>{messages.push(JSON.parse(String(init?.body)).message);return {ok:true,json:async()=>({ok:true})} as Response;});
 await service.disconnect(true);
 expect(service.command).not.toHaveBeenCalled();
 expect(messages).toEqual([{type:'CONTROLLER_DISCONNECT',stopPlayback:true}]);
});
describe('Vega Cast standby proxy descriptors',()=>{
 let service:any;let delivery:any;let send:any;
 beforeEach(()=>{
  jest.resetModules();
  const crypto=require('expo-crypto');let next=0;crypto.randomUUID=()=>String(++next);
  require('../src/lib/services/cookieManager').getCookieHeader.mockResolvedValue(undefined);
  const store=require('../src/lib/remote/remoteStore');store.useRemoteStore.getState=()=>({setStatus:jest.fn(),setErrorMessage:jest.fn()});
  delivery=require('../src/lib/remote/remoteDeliveryService').remoteDeliveryService;
  Object.assign(delivery,{
   prepareStream:jest.fn(async options=>({streamUrl:'http://phone.test/stream/'+options.sessionId})),
   cleanupSession:jest.fn(async()=>{}),startForegroundService:jest.fn(async()=>{}),stopForegroundService:jest.fn(async()=>{}),
  });
  service=require('../src/lib/remote/vegaCastService').vegaCastService;
  send=jest.fn(async()=>{});service.send=send;
 });
 const payload={sourceUrl:'https://provider.test/movie.mkv',sourceType:'mkv',title:'Movie',headers:{Referer:'https://provider.test/'},initialPosition:120};
 it('always sends the original descriptor plus a ready proxy without choosing delivery on mobile',async()=>{
  await service.load(payload);
  expect(delivery.prepareStream).toHaveBeenCalledWith(expect.objectContaining({sourceUrl:payload.sourceUrl,headers:payload.headers,mode:'proxy',startPositionSeconds:0}));
  const message=send.mock.calls[0][0];
  expect(message.type).toBe('LOAD_MEDIA');expect(message.media.source.url).toBe(payload.sourceUrl);
  expect(message.media.source.headers).toEqual(payload.headers);
  expect(message.media.delivery).toBe('direct');expect(message.media.proxy.source.url).toMatch(/^http:\/\/phone.test\/stream\//);
  expect(message.media.startPosition).toBe(120);
 });
 it('does not forward provider headers to another subtitle origin',async()=>{
  await service.load({...payload,subtitles:[{uri:'https://subtitles.test/en.srt',language:'en',title:'English'}]});
  expect(delivery.prepareStream.mock.calls[1][0].headers).toEqual({});
  expect(send.mock.calls[0][0].media.proxy.subtitles[0].uri).toMatch(/^http:\/\/phone.test\//);
 });
 it('prepares encrypted delivery only for supported receivers and closes the previous source channel',async()=>{
  service.capabilities={securePhoneDelivery:true};
  service.current={receiverId:'screen',controllerId:'phone',token:'secret',serviceUrl:'https://cast.test/vega-cast/v1'};
  await service.load(payload);
  const first=service.media;
  expect(first.delivery).toBe('direct');expect(first.proxy.secure).toBe(true);
  const delivery=service.secureDeliveries.get(first.id);
  service.receive({type:'RTC_OFFER',mediaId:first.id,transportId:'channel',sdp:{type:'offer',sdp:'test'}});
  expect(delivery.signal).toHaveBeenCalled();
  service.receive({type:'RTC_OFFER',mediaId:'unknown',transportId:'channel'});
  expect(delivery.signal).toHaveBeenCalledTimes(1);
  await service.load({...payload,sourceUrl:'https://provider.test/next.mkv'});
  expect(delivery.close).toHaveBeenCalledTimes(1);
  expect(service.secureDeliveries.has(first.id)).toBe(false);
 });
 it('tracks the receiver-selected proxy so ending playback stops a phone-dependent stream',async()=>{
  await service.load(payload);
  const mediaId=service.media.id;
  service.receive({type:'DELIVERY_CHANGED',mediaId,delivery:'phone-proxy'});
  expect(service.media.delivery).toBe('phone-proxy');expect(service.fallbackUsed).toBe(false);
 });
 it('cleans up a failed standby registration and does not send an incomplete descriptor',async()=>{
  delivery.prepareStream.mockRejectedValue(new Error('Server unavailable'));
  await expect(service.load(payload)).rejects.toThrow('Server unavailable');
  expect(delivery.cleanupSession).toHaveBeenCalled();expect(service.sessions.size).toBe(0);expect(send).not.toHaveBeenCalled();
 });
});
describe('receiver server requests',()=>{
 let service:any;let send:any;let select:any;
 const servers=[{id:'original-a',link:'https://a.test/video.mkv',name:'Alpha',quality:'1080p'},{id:'original-b',link:'https://b.test/video.mkv',name:'Beta',quality:'720p'}];
 beforeEach(()=>{
  jest.resetModules();
  let id=0;require('expo-crypto').randomUUID=()=>String(++id);
  require('../src/lib/services/cookieManager').getCookieHeader.mockResolvedValue(undefined);
  require('../src/lib/remote/remoteStore').useRemoteStore.getState=()=>({setStatus:jest.fn(),setErrorMessage:jest.fn()});
  Object.assign(require('../src/lib/remote/remoteDeliveryService').remoteDeliveryService,{prepareStream:jest.fn(async()=>({streamUrl:'http://phone.test/proxy'})),startForegroundService:jest.fn(async()=>{}),cleanupSession:jest.fn(async()=>{}),stopForegroundService:jest.fn(async()=>{})});
  service=require('../src/lib/remote/vegaCastService').vegaCastService;send=jest.fn(async()=>{});service.send=send;select=jest.fn();service.setServerSelector(select);
  service.current={receiverId:'screen',controllerId:'phone',token:'saved-secret',serviceUrl:'https://cast.example/vega-cast/v1'};service.request=jest.fn(async()=>({ok:true}));
 });
 it('sends opaque choices, uses the existing selector, and preserves receiver position on replacement',async()=>{
  await service.load({sourceUrl:servers[0].link,title:'Movie',servers,serverId:'original-a'});
  const first=send.mock.calls[0][0].media;
  expect(first.servers[1]).toEqual({id:'server-1',name:'Beta',quality:'720p',tags:undefined});
  expect(first.selectedServerId).toBe('server-0');
  await service.handleServerChange({mediaId:first.id,requestId:'switch',serverId:'server-1',position:333});
  expect(select).toHaveBeenCalledWith(servers[1],333);
  await service.load({sourceUrl:servers[1].link,title:'Movie',servers,serverId:'original-b',initialPosition:0});
  expect(send.mock.calls[1][0].media.startPosition).toBe(333);
  expect(send.mock.calls[1][0].media.selectedServerId).toBe('server-1');
  expect(service.serverSwitch).toBeUndefined();
 });
 it('rejects arbitrary choices and remuxed sessions without invoking providers',async()=>{
  await service.load({sourceUrl:servers[0].link,title:'Movie',servers,serverId:'original-a'});
  await service.handleServerChange({mediaId:service.media.id,requestId:'invalid',serverId:'https://untrusted.test/',position:1});
  expect(select).not.toHaveBeenCalled();
  service.media.processing='remuxed';
  await service.handleServerChange({mediaId:service.media.id,requestId:'remux',serverId:'server-1',position:1});
  expect(select).not.toHaveBeenCalled();
  expect(service.request.mock.calls.at(-1)[1].message).toEqual(expect.objectContaining({type:'SERVER_CHANGE_RESULT',ok:false,error:expect.stringContaining('remuxed')}));
 });
});

it('migrates the old discovery default to vega-app.in without dropping saved services',async()=>{
 jest.resetModules();mockStorage.clear();
 const constants=require('expo-constants').default;
 constants.expoConfig.extra.vegaCastServiceUrl='https://vega.8man.in/vega-cast/v1';
 mockStorage.set('vega.cast.receivers.v1',[{receiverId:'saved',controllerId:'phone',token:'secret',name:'Saved',serviceUrl:'http://192.168.1.10:5173/vega-cast/v1'}]);
 global.fetch=jest.fn(async()=>({ok:true,json:async()=>({receivers:[]})})) as any;
 const service=require('../src/lib/remote/vegaCastService').vegaCastService;
 await service.refreshDiscovery();
 const urls=(global.fetch as jest.Mock).mock.calls.map(call=>call[0]);
 expect(urls).toContain('https://cast.vega-app.in/vega-cast/v1');
 expect(urls).toContain('http://192.168.1.10:5173/vega-cast/v1');
 expect(service.getReceivers()[0].id).toBe('saved');
 constants.expoConfig.extra.vegaCastServiceUrl='https://cast.example/vega-cast/v1';
 service.stopDiscovery();
});


it('coalesces held volume keys and ignores stale receiver volume until the requested level arrives',async()=>{
 jest.resetModules();
 const values:number[]=[];
 const store={setVolume:jest.fn((value:number)=>values.push(value)),setStatus:jest.fn(),setTimeline:jest.fn(),setPlaybackRate:jest.fn(),setAudioTracks:jest.fn(),setSubtitleTracks:jest.fn(),setErrorMessage:jest.fn()};
 require('../src/lib/remote/remoteStore').useRemoteStore.getState=()=>store;
 const service=require('../src/lib/remote/vegaCastService').vegaCastService as any;
 const completions:(()=>void)[]=[];
 service.command=jest.fn(()=>new Promise<void>(resolve=>completions.push(resolve)));
 const first=service.setVolume(0.95);
 service.setVolume(0.90);service.setVolume(0.85);
 service.receive({type:'STATE',state:{volume:1}});
 expect(values).toEqual([0.95,0.90,0.85]);
 expect(service.command).toHaveBeenCalledTimes(1);
 completions.shift()!();await Promise.resolve();
 expect(service.command.mock.calls).toEqual([['VOLUME',0.95],['VOLUME',0.85]]);
 completions.shift()!();await first;
 service.receive({type:'STATE',state:{volume:0.95}});
 expect(values.at(-1)).toBe(0.85);
 service.receive({type:'STATE',state:{volume:0.85}});
 service.receive({type:'STATE',state:{volume:0.8}});
 expect(values.slice(-2)).toEqual([0.85,0.8]);
});


it('uses the encrypted control channel and relays an unacknowledged command with the same ID',async()=>{
 jest.resetModules();jest.useFakeTimers();
 try{
  const service=require('../src/lib/remote/vegaCastService').vegaCastService as any;
  service.current={receiverId:'screen',controllerId:'phone',token:'secret',serviceUrl:'https://cast.example/vega-cast/v1'};
  service.media={id:'movie'};
  const direct=jest.fn(()=>true);
  service.secureDeliveries.set('movie',{sendControl:direct});
  service.request=jest.fn(async()=>({ok:true}));
  const command=service.command('VOLUME',0.4);
  expect(direct).toHaveBeenCalledWith(expect.objectContaining({type:'COMMAND',command:'VOLUME',value:0.4}));
  expect(service.request).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1500);
  const message=direct.mock.calls[0][0];
  expect(service.request.mock.calls[0][1].message).toEqual(message);
  service.receive({type:'ACK',id:message.id,ok:true});await command;
  service.request.mockClear();
  const next=service.command('PAUSE');
  service.receive({type:'ACK',id:direct.mock.calls[1][0].id,ok:true});await next;
  await jest.advanceTimersByTimeAsync(2000);
  expect(service.request).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
