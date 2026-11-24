import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {NativeModules} from 'react-native';
import {useSeekThumbnail} from '../src/lib/hooks/useSeekThumbnail';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.Platform.OS = 'android';
  rn.NativeModules.VideoThumbnailModule = {getThumbnail: jest.fn(), cancelPreview: jest.fn()};
  return rn;
});

const native = NativeModules.VideoThumbnailModule;
const snapshot = jest.fn();
function Harness({source = 'https://video.test/one.mp4', timestamp = 1_000, enabled = true, headers = {}}: {
  source?: string;
  timestamp?: number;
  enabled?: boolean;
  headers?: Record<string, string>;
}) {
  snapshot(useSeekThumbnail(source, headers, timestamp, enabled));
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  native.getThumbnail.mockResolvedValue({uri: 'file://first.jpg'});
});

it('keeps the previous preview visible while the next frame loads or fails', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<Harness />);});
  expect(snapshot).toHaveBeenLastCalledWith({uri: 'file://first.jpg', loading: false});

  let reject!: (error: Error) => void;
  native.getThumbnail.mockImplementation(() => new Promise((_resolve: unknown, fail: typeof reject) => {reject = fail;}));
  await act(async () => tree.update(<Harness timestamp={2_000} />));
  expect(snapshot).toHaveBeenLastCalledWith({uri: 'file://first.jpg', loading: true});
  await act(async () => reject(new Error('failed')));
  expect(snapshot).toHaveBeenLastCalledWith({uri: 'file://first.jpg', loading: false});
  act(() => tree.unmount());
});

it('cancels the previous source and never shows its frame for the replacement source', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<Harness />);});
  native.getThumbnail.mockReturnValue(new Promise(() => {}));
  act(() => tree.update(<Harness source="https://video.test/two.mp4" />));
  expect(native.cancelPreview).toHaveBeenCalledTimes(1);
  expect(snapshot).toHaveBeenLastCalledWith({uri: null, loading: true});
  act(() => tree.unmount());
  expect(native.cancelPreview).toHaveBeenCalledTimes(2);
});

it('does not restart work when equivalent request header objects are recreated', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<Harness headers={{Referer: 'provider', Cookie: 'session'}} />);});
  act(() => tree.update(<Harness headers={{Cookie: 'session', Referer: 'provider'}} />));
  expect(native.getThumbnail).toHaveBeenCalledTimes(1);
  expect(native.cancelPreview).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('survives Strict Mode effect cleanup and skips disabled previews', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<React.StrictMode><Harness enabled={false} /></React.StrictMode>);
  });
  expect(native.getThumbnail).not.toHaveBeenCalled();
  await act(async () => tree.update(<React.StrictMode><Harness /></React.StrictMode>));
  expect(snapshot).toHaveBeenLastCalledWith({uri: 'file://first.jpg', loading: false});
  act(() => tree.unmount());
});
