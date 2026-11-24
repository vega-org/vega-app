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

import {findSameServer, useStream} from '../src/lib/hooks/useStream';

const episode = {link: 'https://provider.test/episode', title: 'Episode 1'};
const params = {primaryTitle: 'Show', type: 'series', providerValue: 'test'};
const serverA = (n: number) => ({
  server: 'A',
  link: `https://a.test/${n}.m3u8`,
  type: 'm3u8',
});
const serverB = (n: number) => ({
  server: 'B',
  link: `https://b.test/${n}.m3u8`,
  type: 'm3u8',
});

let streams: ReturnType<typeof useStream>;
let tree: renderer.ReactTestRenderer;
let client: QueryClient;
const Probe = () => {
  streams = useStream({activeEpisode: episode, routeParams: params, provider: 'test'});
  return null;
};
const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
  });
};
const mount = async () => {
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  await act(async () => {
    tree = renderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await flush();
};

beforeEach(() => {
  mockGetStream.mockReset();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  client?.clear();
  jest.restoreAllMocks();
});

describe('findSameServer', () => {
  const list = [
    {server: 'A', link: '1', type: 'mp4', quality: '720', tag: 'Hindi'},
    {server: 'A', link: '2', type: 'mp4', quality: '1080', tag: 'Hindi'},
    {server: 'A', link: '3', type: 'mp4', quality: '1080', tag: 'English'},
    {server: 'B', link: '4', type: 'mp4', quality: '1080'},
  ];

  it('prefers the same quality and tag on the same server', () => {
    const current = {server: 'A', link: 'old', type: 'mp4', quality: '1080', tag: 'English'};
    expect(findSameServer(list, current)).toBe(list[2]);
  });

  it('falls back to any entry of the same server', () => {
    const current = {server: 'A', link: 'old', type: 'mp4', quality: '480'};
    expect(findSameServer(list, current)?.server).toBe('A');
  });

  it('finds nothing for a missing or unnamed server', () => {
    expect(findSameServer(list, {server: 'C', link: 'x', type: 'mp4'})).toBeUndefined();
    expect(findSameServer(list, {server: '', link: 'x', type: 'mp4'})).toBeUndefined();
  });
});

it('moves to the same server when new links replace the old ones', async () => {
  mockGetStream.mockResolvedValue([serverA(1), serverB(1)]);
  await mount();
  act(() => streams.setSelectedStream(streams.streamData[1]));
  expect(streams.selectedStream.link).toBe(serverB(1).link);

  mockGetStream.mockResolvedValue([serverA(2), serverB(2)]);
  let refreshed: boolean | undefined;
  await act(async () => {
    refreshed = await streams.refreshLinks();
  });
  await flush();
  expect(refreshed).toBe(true);
  expect(streams.selectedStream.link).toBe(serverB(2).link);
});

it('reports no new link when the provider returns the same one', async () => {
  mockGetStream.mockResolvedValue([serverA(1), serverB(1)]);
  await mount();
  const selected = streams.selectedStream;

  mockGetStream.mockResolvedValue([serverA(1), serverB(1)]);
  let refreshed: boolean | undefined;
  await act(async () => {
    refreshed = await streams.refreshLinks();
  });
  await flush();
  expect(refreshed).toBe(false);
  expect(streams.selectedStream.link).toBe(selected.link);
});

it('reports no new link when the refresh fails', async () => {
  mockGetStream.mockResolvedValue([serverA(1)]);
  await mount();

  mockGetStream.mockRejectedValue(new Error('Network error'));
  let refreshed: boolean | undefined;
  await act(async () => {
    refreshed = await streams.refreshLinks();
  });
  await flush();
  expect(refreshed).toBe(false);
  expect(streams.selectedStream.link).toBe(serverA(1).link);
});
