jest.mock('../src/lib/hooks/useSavedSubtitles', () => {
  const savedSubtitles: any[] = [];
  return {useSavedSubtitles: () => ({savedSubtitles, saveSubtitle: jest.fn(), removeSavedSubtitle: jest.fn()})};
});
jest.mock('../src/lib/subtitles/savedSubtitles', () => ({
  subtitleVideoKey: (episode: any) => episode?.sourceLink || episode?.id || episode?.link || '',
  savedSubtitleTrack: (track: any) => track,
}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {ToastAndroid} from 'react-native';

const mockGetStream = jest.fn();

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (args: object) => mockGetStream(args)},
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getExcludedQualities: () => []},
}));
jest.mock('../src/lib/file/ifExists', () => ({
  ifExists: jest.fn(async () => null),
}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: jest.fn(async () => false),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: {}})},
  isSubtitleDownloadItem: () => false,
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));

import {useStream} from '../src/lib/hooks/useStream';

const params = {primaryTitle: 'Show', type: 'series', providerValue: 'test'};
let episode = {link: 'https://provider.test/episode-1', title: 'Episode 1'};
let tree: renderer.ReactTestRenderer;
let client: QueryClient;
const Probe = () => {
  useStream({activeEpisode: episode, routeParams: params, provider: 'test'});
  return null;
};
const app = () => (
  <QueryClientProvider client={client}>
    <Probe />
  </QueryClientProvider>
);
const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
  });
};
const providerSignal = (call: number): AbortSignal =>
  mockGetStream.mock.calls[call][0].signal;

beforeEach(() => {
  episode = {link: 'https://provider.test/episode-1', title: 'Episode 1'};
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  // A slow provider that stops when its request is aborted, as the sandbox does.
  mockGetStream.mockReset().mockImplementation(
    ({signal}: {signal: AbortSignal}) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Aborted'))),
      ),
  );
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

it('cancels the provider call when the player closes', async () => {
  await act(async () => {
    tree = renderer.create(app());
  });
  await flush();
  expect(providerSignal(0).aborted).toBe(false);
  act(() => tree.unmount());
  await flush();
  expect(providerSignal(0).aborted).toBe(true);
});

it('cancels the previous episode call when the episode changes', async () => {
  await act(async () => {
    tree = renderer.create(app());
  });
  await flush();
  episode = {link: 'https://provider.test/episode-2', title: 'Episode 2'};
  act(() => tree.update(app()));
  await flush();
  expect(mockGetStream).toHaveBeenCalledTimes(2);
  expect(providerSignal(0).aborted).toBe(true);
  expect(providerSignal(1).aborted).toBe(false);
  act(() => tree.unmount());
});
