import {NativeModules} from 'react-native';
import {remoteDeliveryService as service} from '../src/lib/remote/remoteDeliveryService';

jest.mock('react-native', () => ({
  Platform: {OS: 'android'}, DeviceEventEmitter: {},
  NativeModules: {VegaRemoteDelivery: {
    inspectMediaTracks: jest.fn(), stopServer: jest.fn(async () => {}),
    startServer: jest.fn(async () => ({baseUrl: 'http://phone:1234', port: 1234, lanIp: 'phone'})),
    stopForegroundService: jest.fn(async () => {}),
    prepareSubtitle: jest.fn(async () => true),
  }},
}));
jest.mock('../src/lib/remote/mkvParser', () => ({fetchAndParseMkvHeader: jest.fn()}));
const inspect = NativeModules.VegaRemoteDelivery.inspectMediaTracks as jest.Mock;
const info = {hasVideo: true, durationSeconds: 300, audioTracks: [], subtitleTracks: []};
beforeEach(async () => {await service.stopServer(); inspect.mockReset().mockResolvedValue(info);});

it('shares concurrent inspections and reuses metadata for the same source/headers', async () => {
  await Promise.all([service.inspectTracks('https://video/a.mp4'), service.inspectTracks('https://video/a.mp4')]);
  await service.inspectTracks('https://video/a.mp4');
  expect(inspect).toHaveBeenCalledTimes(1);
});
it('does not share results across authentication headers or local file reads', async () => {
  await service.inspectTracks('https://video/a.mp4', false, {Authorization: 'one'});
  await service.inspectTracks('https://video/a.mp4', false, {Authorization: 'two'});
  await service.inspectTracks('file:///a.mp4', true);
  await service.inspectTracks('file:///a.mp4', true);
  expect(inspect).toHaveBeenCalledTimes(4);
});
it('retries failed inspections and clears successful metadata on stop', async () => {
  inspect.mockRejectedValueOnce(new Error('timeout'));
  await service.inspectTracks('https://video/a.mp4');
  await service.inspectTracks('https://video/a.mp4');
  expect(inspect).toHaveBeenCalledTimes(2);
  await service.stopServer();
  await service.inspectTracks('https://video/a.mp4');
  expect(inspect).toHaveBeenCalledTimes(3);
});

it('does not repopulate HLS metadata after a stopped in-flight inspection finishes', async () => {
  const originalFetch = global.fetch;
  let finish!: (value: unknown) => void;
  const response = {ok: true, url: 'https://video/master.m3u8', text: async () =>
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nv1.m3u8\n'};
  const fetchMock = jest.fn().mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}))
    .mockResolvedValue(response);
  global.fetch = fetchMock;
  try {
    const old = service.inspectTracks('https://video/master.m3u8');
    await service.stopServer();
    finish(response);
    await old;
    await service.inspectTracks('https://video/master.m3u8');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {global.fetch = originalFetch;}
});

it('prepares a phone-hosted subtitle through the native bridge without an HTTP request', async () => {
  await service.ensureServerStarted();
  const original = global.fetch;
  global.fetch = jest.fn().mockRejectedValue(new Error('java.net.SocketTimeoutException'));
  const native = NativeModules.VegaRemoteDelivery.prepareSubtitle as jest.Mock;
  native.mockClear();
  try {
    const url = 'http://phone:1234/subtitle/session-id/0.vtt';
    await service.prepareSubtitle(url);
    expect(native).toHaveBeenCalledWith(url);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {global.fetch = original;}
});

it('allows native subtitle extraction to outlast the global HTTP read timeout', async () => {
  await service.ensureServerStarted();
  jest.useFakeTimers();
  const native = NativeModules.VegaRemoteDelivery.prepareSubtitle as jest.Mock;
  native.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 45_000)));
  try {
    const preparation = service.prepareSubtitle('http://phone:1234/subtitle/session-id/0.vtt');
    await jest.advanceTimersByTimeAsync(45_000);
    await expect(preparation).resolves.toBeUndefined();
  } finally {jest.useRealTimers();}
});

it('reports native extraction failures without silently retrying over HTTP', async () => {
  await service.ensureServerStarted();
  const original = global.fetch;
  global.fetch = jest.fn();
  (NativeModules.VegaRemoteDelivery.prepareSubtitle as jest.Mock)
    .mockRejectedValueOnce(new Error('Source read failed'));
  try {
    await expect(service.prepareSubtitle('http://phone:1234/subtitle/session-id/0.vtt'))
      .rejects.toThrow('Source read failed');
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {global.fetch = original;}
});

it('re-verifies native server state on ensureServerStarted instead of returning a stale cached port', async () => {
  const startServer = NativeModules.VegaRemoteDelivery.startServer as jest.Mock;
  startServer.mockClear();
  startServer
    .mockResolvedValueOnce({baseUrl: 'http://phone:1234', port: 1234, lanIp: 'phone'})
    .mockResolvedValueOnce({baseUrl: 'http://phone:5678', port: 5678, lanIp: 'phone'});
  const first = await service.ensureServerStarted();
  const second = await service.ensureServerStarted();
  expect(first.port).toBe(1234);
  expect(second.port).toBe(5678);
  expect(startServer).toHaveBeenCalledTimes(2);
});

it('coalesces concurrent ensureServerStarted calls into one native startServer call', async () => {
  let resolve!: (info: {baseUrl: string; port: number; lanIp: string}) => void;
  const startServer = NativeModules.VegaRemoteDelivery.startServer as jest.Mock;
  startServer.mockReset().mockImplementationOnce(
    () => new Promise(r => {resolve = r;}),
  );
  try {
    const p1 = service.ensureServerStarted();
    const p2 = service.ensureServerStarted();
    expect(startServer).toHaveBeenCalledTimes(1);
    resolve({baseUrl: 'http://phone:4321', port: 4321, lanIp: 'phone'});
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      {baseUrl: 'http://phone:4321', port: 4321, lanIp: 'phone'},
      {baseUrl: 'http://phone:4321', port: 4321, lanIp: 'phone'},
    ]);
  } finally {
    startServer.mockReset().mockResolvedValue({baseUrl: 'http://phone:1234', port: 1234, lanIp: 'phone'});
  }
});

it('clears cached serverInfo even when stopServer or stopForegroundService rejects', async () => {
  const stopServer = NativeModules.VegaRemoteDelivery.stopServer as jest.Mock;
  const stopFg = NativeModules.VegaRemoteDelivery.stopForegroundService as jest.Mock;
  const prepSub = NativeModules.VegaRemoteDelivery.prepareSubtitle as jest.Mock;
  prepSub.mockClear();
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ok: true, status: 200});
  try {
    await service.ensureServerStarted();
    stopServer.mockRejectedValueOnce(new Error('stop error'));
    await service.stopServer();
    await service.prepareSubtitle('http://phone:1234/subtitle/s/0.vtt');
    expect(prepSub).not.toHaveBeenCalled();

    await service.ensureServerStarted();
    stopFg.mockRejectedValueOnce(new Error('fg stop error'));
    await service.stopForegroundService();
    await service.prepareSubtitle('http://phone:1234/subtitle/s/0.vtt');
    expect(prepSub).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
  }
});
