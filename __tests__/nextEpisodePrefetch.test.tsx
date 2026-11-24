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
const mockDownloads: Record<string, any> = {};

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (args: object) => mockGetStream(args)},
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getExcludedQualities: () => []},
}));
jest.mock('../src/lib/file/ifExists', () => ({ifExists: async () => null}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: async () => true,
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: mockDownloads})},
  isSubtitleDownloadItem: () => false,
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));

import {useStream} from '../src/lib/hooks/useStream';
import {
  NEXT_EPISODE_PREFETCH_SECONDS,
  shouldPrefetchNextEpisode,
  useNextEpisodePrefetch,
} from '../src/lib/hooks/useNextEpisodePrefetch';
import {canPromptWaf} from '../src/lib/services/wafSession';

const params = {primaryTitle: 'Show', type: 'series', providerValue: 'source'};
const episode1 = {link: 'https://provider.test/e1', title: 'Episode 1'};
const episode2 = {link: 'https://provider.test/e2', title: 'Episode 2'};
const server = ({link}: {link: string}) => ({
  server: 'Remote',
  link: `${link}.mp4`,
  type: 'mp4',
});

beforeEach(() => {
  for (const key of Object.keys(mockDownloads)) delete mockDownloads[key];
  mockGetStream.mockReset();
});

describe('shouldPrefetchNextEpisode', () => {
  const near = {
    currentTime: 1500 - NEXT_EPISODE_PREFETCH_SECONDS,
    duration: 1500,
    nextEpisode: episode2,
    routeParams: params,
  };

  it('starts when three minutes of the episode are left', () => {
    expect(NEXT_EPISODE_PREFETCH_SECONDS).toBe(180);
    expect(shouldPrefetchNextEpisode(near)).toBe(true);
    expect(shouldPrefetchNextEpisode({...near, currentTime: 1499})).toBe(true);
    expect(
      shouldPrefetchNextEpisode({...near, currentTime: near.currentTime - 1}),
    ).toBe(false);
  });

  it.each([
    ['the last episode', {nextEpisode: undefined}],
    ['movies', {routeParams: {...params, type: 'movie'}}],
    ['imported local files', {routeParams: {...params, localContent: true}}],
    [
      'videos opened from other apps',
      {routeParams: {...params, externalVideo: {mimeType: 'video/mp4'}}},
    ],
    ['an unknown duration', {duration: 0}],
    ['an endless duration', {duration: Infinity}],
  ])('skips %s', (_, change) => {
    expect(shouldPrefetchNextEpisode({...near, ...change})).toBe(false);
  });

  it('skips a downloaded next episode', () => {
    mockDownloads.e2 = {
      id: 'e2',
      status: 'completed',
      filePath: '/downloads/e2.mkv',
      sourceLink: episode2.link,
    };
    expect(shouldPrefetchNextEpisode(near)).toBe(false);
  });
});

describe('useNextEpisodePrefetch', () => {
  let active = episode1;
  let enabled = true;
  let streams: ReturnType<typeof useStream>;
  let prefetch: (currentTime: number, duration: number) => void;
  let tree: renderer.ReactTestRenderer | undefined;
  let client: QueryClient;

  const Probe = () => {
    streams = useStream({
      activeEpisode: active,
      routeParams: params,
      provider: 'test',
    });
    prefetch = useNextEpisodePrefetch({
      activeEpisode: active,
      nextEpisode: active === episode1 ? episode2 : undefined,
      routeParams: params,
      provider: 'test',
      enabled,
    });
    return null;
  };
  const element = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const flush = () =>
    act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  const mount = async () => {
    client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    await act(async () => {
      tree = renderer.create(element());
    });
    await flush();
  };
  const rerender = async () => {
    act(() => tree?.update(element()));
    await flush();
  };
  const nearEnd = async () => {
    act(() => prefetch(1400, 1500));
    await flush();
  };

  beforeEach(() => {
    active = episode1;
    enabled = true;
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  });
  afterEach(() => {
    if (tree) act(() => tree?.unmount());
    tree = undefined;
    client.clear();
    jest.restoreAllMocks();
  });

  it('opens a prefetched next episode without asking the provider again', async () => {
    mockGetStream.mockImplementation(async ({link}) => [server({link})]);
    await mount();
    act(() => prefetch(100, 1500));
    await flush();
    expect(mockGetStream).toHaveBeenCalledTimes(1);

    await nearEnd();
    await nearEnd();
    expect(mockGetStream).toHaveBeenCalledTimes(2);
    expect(mockGetStream).toHaveBeenLastCalledWith(
      expect.objectContaining({link: episode2.link, providerValue: 'source'}),
    );
    // The current episode keeps its servers and selection.
    expect(streams.streamData).toEqual([server(episode1)]);
    expect(streams.selectedStream).toEqual(server(episode1));

    active = episode2;
    await rerender();
    expect(mockGetStream).toHaveBeenCalledTimes(2);
    expect(streams.isLoading).toBe(false);
    expect(streams.selectedStream).toEqual(server(episode2));
  });

  it('fails quietly behind a captcha and loads the episode when opened', async () => {
    // A provider behind a captcha only succeeds when it may show it.
    mockGetStream.mockImplementation(async ({link, signal}) => {
      if (link === episode2.link && !canPromptWaf(signal)) {
        throw new Error('WAF_DIALOG_CANCELLED');
      }
      return [server({link})];
    });
    await mount();
    await nearEnd();
    expect(mockGetStream).toHaveBeenCalledTimes(2);
    expect(streams.selectedStream).toEqual(server(episode1));

    active = episode2;
    await rerender();
    expect(mockGetStream).toHaveBeenCalledTimes(3);
    expect(streams.selectedStream).toEqual(server(episode2));
    expect(streams.error).toBeNull();
    expect(ToastAndroid.show).not.toHaveBeenCalled();
  });

  it('lets an opened episode wait on its prefetch, which may then prompt and stops with the player', async () => {
    let signal: AbortSignal | undefined;
    mockGetStream.mockImplementation(args => {
      if (args.link !== episode2.link) return Promise.resolve([server(args)]);
      signal = args.signal;
      return new Promise((_, reject) =>
        args.signal.addEventListener('abort', () =>
          reject(new Error('Aborted')),
        ),
      );
    });
    await mount();
    await nearEnd();
    expect(canPromptWaf(signal)).toBe(false);

    active = episode2;
    await rerender();
    expect(mockGetStream).toHaveBeenCalledTimes(2);
    expect(streams.isLoading).toBe(true);
    expect(canPromptWaf(signal)).toBe(true);

    act(() => tree?.unmount());
    tree = undefined;
    expect(signal?.aborted).toBe(true);
  });

  it('stops a pending prefetch without retrying when the player closes', async () => {
    mockGetStream.mockImplementation(({link, signal}) =>
      link === episode2.link
        ? new Promise((_, reject) => {
            const fail = () => reject(new Error('Aborted'));
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail);
          })
        : Promise.resolve([server({link})]),
    );
    await mount();
    await nearEnd();
    jest.useFakeTimers();
    act(() => tree?.unmount());
    tree = undefined;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    jest.useRealTimers();
    expect(mockGetStream).toHaveBeenCalledTimes(2);
    expect(mockGetStream.mock.calls[1][0].signal.aborted).toBe(true);
  });

  it('skips a fresh next episode and players not loading online servers', async () => {
    mockGetStream.mockImplementation(async ({link}) => [server({link})]);
    enabled = false;
    await mount();
    await nearEnd();
    expect(mockGetStream).toHaveBeenCalledTimes(1);

    enabled = true;
    client.setQueryData(
      ['stream', episode2.link, params.type, 'test'],
      [server(episode2)],
    );
    await rerender();
    await nearEnd();
    expect(mockGetStream).toHaveBeenCalledTimes(1);
  });
});
