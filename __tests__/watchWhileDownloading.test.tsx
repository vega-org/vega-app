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
const mockNavigate = jest.fn();
const mockDownloads: Record<string, any> = {};

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (args: object) => mockGetStream(args)},
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getExcludedQualities: () => []},
}));
jest.mock('../src/lib/file/ifExists', () => ({ifExists: async () => null}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: async () => false,
}));
jest.mock('../src/lib/zustand/downloadsStore', () => {
  const state = () => ({downloads: mockDownloads});
  return {
    __esModule: true,
    default: Object.assign(
      (selector: (value: object) => unknown) => selector(state()),
      {getState: state},
    ),
    isSubtitleDownloadItem: () => false,
    selectCurrentDownloads: (value: {downloads: object}) =>
      Object.values(value.downloads),
  };
});
jest.mock('../src/lib/downloadManager', () => ({
  cancelDownload: jest.fn(),
  pauseDownload: jest.fn(),
  resumeDownload: jest.fn(),
  retryDownload: jest.fn(),
  startQueuedDownloadNow: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#FFFFFF',
}));
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View};
});
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({}),
}));

import {getDownloadPlayerParams} from '../src/lib/downloadPlayback';
import {getInitialStream, streamQueryOptions, useStream} from '../src/lib/hooks/useStream';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';
import CurrentDownloadsSection from '../src/screens/settings/components/CurrentDownloadsSection';

// Inactive failed/cancelled requests can finish after teardown and schedule
// cache eviction. Keep cache GC disabled in this isolated test environment.
const originalGcTime = streamQueryOptions.gcTime;
beforeAll(() => { streamQueryOptions.gcTime = Infinity; });
afterAll(() => { streamQueryOptions.gcTime = originalGcTime; });

const download: DownloadItem = {
  schemaVersion: 1,
  id: 'show_S1_E2',
  title: 'Show Episode 2',
  showName: 'Show',
  episodeName: 'Episode 2',
  seasonTitle: 'Season 1',
  type: 'series',
  url: 'https://cdn.test/episode-2.mkv',
  headers: {Referer: 'https://provider.test/'},
  server: 'Fast',
  provider: 'test',
  infoUrl: 'https://provider.test/show',
  sourceLink: 'https://provider.test/episode-2',
  poster: 'https://img.test/poster.jpg',
  background: 'https://img.test/background.jpg',
  skip: [{from: 0, to: 30}],
  sourceType: 'http',
  videoType: 'mkv',
  isTorrent: false,
  filePath: '',
  totalBytes: 100,
  downloadedBytes: 10,
  speed: 5,
  status: 'downloading',
  canPause: true,
  canResume: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('getDownloadPlayerParams', () => {
  it('opens the episode with the stream the download is reading', () => {
    expect(getDownloadPlayerParams(download)).toEqual({
      linkIndex: 0,
      episodeList: [
        {
          title: 'Episode 2',
          link: 'https://provider.test/episode-2',
          skip: [{from: 0, to: 30}],
        },
      ],
      type: 'series',
      primaryTitle: 'Show',
      secondaryTitle: 'Season 1',
      poster: {
        poster: 'https://img.test/poster.jpg',
        background: 'https://img.test/background.jpg',
      },
      providerValue: 'test',
      infoUrl: 'https://provider.test/show',
      initialStream: {
        server: 'Fast (Downloading)',
        link: 'https://cdn.test/episode-2.mkv',
        type: 'mkv',
        headers: {Referer: 'https://provider.test/'},
        skip: [{from: 0, to: 30}],
      },
    });
  });

  it('plays HLS downloads as m3u8', () => {
    const params = getDownloadPlayerParams({
      ...download,
      url: 'https://cdn.test/master.m3u8',
      sourceType: 'hls',
      videoType: 'mp4',
      server: undefined,
    });
    expect(params?.initialStream).toMatchObject({
      server: 'Downloading',
      link: 'https://cdn.test/master.m3u8',
      type: 'm3u8',
    });
  });

  it('is offered only while the download stream is in use', () => {
    for (const status of [
      'queued',
      'starting',
      'downloading',
      'pausing',
      'paused',
      'finalizing',
    ] as const) {
      expect(getDownloadPlayerParams({...download, status})).toBeDefined();
    }
    for (const status of [
      'completed',
      'interrupted',
      'error',
      'missing',
      'canceling',
    ] as const) {
      expect(getDownloadPlayerParams({...download, status})).toBeUndefined();
    }
  });

  it('is not offered for torrents, subtitles or downloads without an episode link', () => {
    expect(
      getDownloadPlayerParams({
        ...download,
        url: 'magnet:?xt=urn:btih:abc',
        sourceType: 'torrent',
        isTorrent: true,
      }),
    ).toBeUndefined();
    expect(
      getDownloadPlayerParams({
        ...download,
        id: `${download.id}_subtitle_English`,
        isSubtitle: true,
      }),
    ).toBeUndefined();
    expect(
      getDownloadPlayerParams({...download, sourceLink: undefined}),
    ).toBeUndefined();
  });
});

describe('useStream with a download stream', () => {
  const params = getDownloadPlayerParams(download)!;
  const initial = params.initialStream!;
  const remote = {
    server: 'Remote',
    link: 'https://cdn.test/remote.mp4',
    type: 'mp4',
  };
  let streams: ReturnType<typeof useStream>;
  let tree: renderer.ReactTestRenderer;
  let client: QueryClient;
  let fetches: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>;
  const Probe = () => {
    streams = useStream({
      activeEpisode: params.episodeList[0],
      routeParams: params,
      provider: 'other',
    });
    return null;
  };
  const flush = async () => {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  };

  beforeEach(async () => {
    fetches = [];
    mockGetStream.mockReset().mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          fetches.push({resolve, reject});
        }),
    );
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    await act(async () => {
      tree = renderer.create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await flush();
  });

  afterEach(async () => {
    act(() => tree.unmount());
    // Settle superseded fetches so their timeouts are cleared.
    await act(async () => {
      fetches.forEach(fetch => fetch.reject(new Error('Test finished')));
    });
    client.clear();
    jest.restoreAllMocks();
  });

  it('plays it at once and keeps it first once servers load', async () => {
    expect(streams.selectedStream).toBe(initial);
    expect(streams.isLoading).toBe(false);
    expect(mockGetStream).toHaveBeenCalledWith(
      expect.objectContaining({
        link: download.sourceLink,
        providerValue: 'test',
      }),
    );
    await act(async () => {
      fetches[0].resolve([{...remote, link: initial.link}, remote]);
    });
    await flush();
    expect(streams.streamData.map(stream => stream.link)).toEqual([
      initial.link,
      remote.link,
    ]);
    expect(streams.selectedStream).toBe(initial);
  });

  it('clears the failed initial stream when fallback lookup fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    act(() => { expect(streams.switchToNextStream()).toBe(true); });
    await flush();
    await act(async () => {
      fetches[1].reject(new Error('WAF_DIALOG_CANCELLED'));
    });
    await flush();
    expect(streams.error).not.toBeNull();
    expect(streams.selectedStream.link).toBe('');
    expect(streams.streamData).toEqual([]);
    expect(streams.switchToNextStream()).toBe(false);
  });

  it('ignores the failed URL when the provider returns it with a fallback', async () => {
    act(() => { expect(streams.switchToNextStream()).toBe(true); });
    await flush();
    await act(async () => {
      fetches[1].resolve([{...remote, link: initial.link}, remote]);
    });
    await flush();
    expect(streams.selectedStream).toEqual(remote);
    expect(streams.streamData).toEqual([remote]);
  });

  it('does not restore a failed initial stream from an otherwise empty result', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    act(() => { expect(streams.switchToNextStream()).toBe(true); });
    await flush();
    await act(async () => { fetches[1].resolve([{...remote, link: initial.link}]); });
    await flush();
    expect(streams.streamData).toEqual([]);
    expect(streams.selectedStream.link).toBe('');
  });

  it('marks the initial URL failed when an alternative is already cached', async () => {
    await act(async () => { fetches[0].resolve([remote]); });
    await flush();
    act(() => { expect(streams.switchToNextStream()).toBe(true); });
    await flush();
    expect(streams.selectedStream).toEqual(remote);
    expect(streams.streamData).toEqual([remote]);
    expect(fetches).toHaveLength(1);
  });

  it('keeps playing it when the servers fail to load', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      fetches[0].reject(new Error('provider down'));
    });
    await flush();
    expect(streams.selectedStream).toBe(initial);
    expect(streams.streamData).toEqual([initial]);
    expect(streams.error).toBeNull();
    warn.mockRestore();
  });

  it('switches to an online server when it fails before servers load', async () => {
    let switched = false;
    act(() => {
      switched = streams.switchToNextStream();
    });
    expect(switched).toBe(true);
    await flush();
    expect(fetches).toHaveLength(2);
    await act(async () => {
      fetches[1].resolve([remote]);
    });
    await flush();
    expect(streams.selectedStream).toEqual(remote);
  });
});

describe('getInitialStream', () => {
  it('hands the stream only to the episode it was opened for', () => {
    const params = getDownloadPlayerParams(download)!;
    expect(getInitialStream(params.episodeList[0], params)).toBe(
      params.initialStream,
    );
    expect(
      getInitialStream(
        {title: 'Episode 3', link: 'https://provider.test/e3'},
        params,
      ),
    ).toBeUndefined();
  });
});

describe('CurrentDownloadsSection', () => {
  afterEach(() => {
    for (const key of Object.keys(mockDownloads)) delete mockDownloads[key];
    mockNavigate.mockReset();
  });

  it('opens the player from an unfinished download', async () => {
    mockDownloads[download.id] = download;
    mockDownloads.torrent = {
      ...download,
      id: 'torrent',
      title: 'Torrent movie',
      url: 'magnet:?xt=urn:btih:abc',
      sourceType: 'torrent',
      isTorrent: true,
    };
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<CurrentDownloadsSection primary="#ffffff" />);
    });
    expect(
      tree!.root.findAllByProps({accessibilityLabel: 'Watch Torrent movie'}),
    ).toHaveLength(0);
    act(() =>
      tree!.root
        .findByProps({accessibilityLabel: `Watch ${download.title}`})
        .props.onPress(),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      'Player',
      getDownloadPlayerParams(download),
    );
    act(() => tree!.unmount());
  });
});
