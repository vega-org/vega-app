import {SeekThumbnailSession, type PreviewNativeModule} from '../src/lib/player/seekThumbnail';

const flush = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

function setup() {
  const pending: Array<{resolve: (value: {uri: string}) => void; reject: (error: Error) => void}> = [];
  const getThumbnail = jest.fn<ReturnType<PreviewNativeModule['getThumbnail']>, Parameters<PreviewNativeModule['getThumbnail']>>(() => new Promise<{uri: string}>((resolve, reject) => {
    pending.push({resolve, reject});
  }));
  const native: PreviewNativeModule = {getThumbnail, cancelPreview: jest.fn()};
  const publish = jest.fn();
  const headers = {Referer: 'https://provider.test/'};
  const session = new SeekThumbnailSession(native, 'https://cdn.test/video.m3u8', headers, publish);
  return {session, native, getThumbnail, publish, pending, headers};
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('starts immediately and sends only the latest pending position after rapid scrubbing', async () => {
  const {session, getThumbnail, publish, pending, headers} = setup();
  session.request(5_000);
  expect(getThumbnail).toHaveBeenCalledTimes(1);
  expect(getThumbnail.mock.calls[0]).toEqual([
    'https://cdn.test/video.m3u8', 5_000, headers,
    expect.objectContaining({previewSession: expect.any(String), maxWidth: 320, maxHeight: 180}),
  ]);
  for (let index = 1; index <= 100; index++) session.request(index * 10_000);
  expect(getThumbnail).toHaveBeenCalledTimes(1);

  pending[0].resolve({uri: 'file://old.jpg'});
  await flush();
  jest.advanceTimersByTime(40);
  expect(getThumbnail).toHaveBeenCalledTimes(2);
  expect(getThumbnail.mock.calls[1][1]).toBe(1_000_000);
  expect(publish).not.toHaveBeenCalledWith('file://old.jpg', false);

  pending[1].resolve({uri: 'file://latest.jpg'});
  await flush();
  expect(publish).toHaveBeenLastCalledWith('file://latest.jpg', false);

  session.request(5_000);
  expect(getThumbnail).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith('file://old.jpg', false);
  session.dispose();
});

it('cancels native work on pause and prevents its late result from replacing a resumed preview', async () => {
  const {session, getThumbnail, native, publish, pending} = setup();
  session.request(5_000);
  const owner = getThumbnail.mock.calls[0][3].previewSession;
  session.pause();
  expect(native.cancelPreview).toHaveBeenCalledWith(owner);
  session.request(10_000);
  pending[0].resolve({uri: 'file://cancelled.jpg'});
  await flush();
  jest.advanceTimersByTime(40);
  expect(getThumbnail.mock.calls[1][3].previewSession).not.toBe(owner);
  expect(publish).not.toHaveBeenCalledWith('file://cancelled.jpg', false);
  session.dispose();
  pending[1].resolve({uri: 'file://disposed.jpg'});
  await flush();
  expect(publish).not.toHaveBeenCalledWith('file://disposed.jpg', false);
});

it('does not decode a queued position if the user returns to an already cached frame', async () => {
  const {session, getThumbnail, publish, pending} = setup();
  session.request(1_000);
  pending[0].resolve({uri: 'file://cached.jpg'});
  await flush();
  session.request(2_000);
  session.request(3_000);
  session.request(1_000);
  expect(publish).toHaveBeenLastCalledWith('file://cached.jpg', false);
  pending[1].resolve({uri: 'file://unused.jpg'});
  await flush();
  jest.advanceTimersByTime(100);
  expect(getThumbnail).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith('file://cached.jpg', false);
  session.dispose();
});

it('backs off after failed sources instead of continually reconnecting', async () => {
  const {session, getThumbnail, publish, pending} = setup();
  session.request(1_000);
  session.request(2_000);
  pending[0].reject(new Error('Unsupported stream'));
  await flush();
  session.request(3_000);
  expect(getThumbnail).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenLastCalledWith(null, false);
  jest.advanceTimersByTime(2_000);
  session.request(4_000);
  expect(getThumbnail).toHaveBeenCalledTimes(2);
  session.dispose();
});

it('stays compatible with installed builds that have no native cancel method', async () => {
  const native = {getThumbnail: jest.fn(async () => ({uri: 'file://frame.jpg'}))};
  const publish = jest.fn();
  const session = new SeekThumbnailSession(native, '/local.mp4', {}, publish);
  session.request(100);
  await flush();
  expect(publish).toHaveBeenLastCalledWith('file://frame.jpg', false);
  expect(() => session.dispose()).not.toThrow();
});
