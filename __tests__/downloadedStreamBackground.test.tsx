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
const mockDownloadExists = jest.fn();
const mockLegacyFile = jest.fn();
const mockDownloads: Record<string, any> = {};

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (args: object) => mockGetStream(args)},
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getExcludedQualities: () => []},
}));
jest.mock('../src/lib/file/ifExists', () => ({
  ifExists: (...args: unknown[]) => mockLegacyFile(...args),
}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: (...args: unknown[]) => mockDownloadExists(...args),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: mockDownloads})},
  isSubtitleDownloadItem: () => false,
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));

import {useStream} from '../src/lib/hooks/useStream';

const episode = {link: 'https://provider.test/episode', title: 'Episode 1'};
const params = {primaryTitle: 'Show', type: 'series', providerValue: 'test'};
const localPath = '/downloads/episode.mkv';
const remote = {
  server: 'Remote',
  link: 'https://cdn.test/video.mp4',
  type: 'mp4',
  subtitles: [{uri: 'https://cdn.test/sub.vtt', title: 'English'}],
};
let streams: ReturnType<typeof useStream>;
let tree: renderer.ReactTestRenderer;
let client: QueryClient;
let probeEpisode = episode;
let localPlaybackReady = true;
let localContent = false;
let externalParams: Record<string, unknown> = {};
const Probe = () => {
  streams = useStream({
    activeEpisode: probeEpisode,
    routeParams: {...params, localContent, ...externalParams},
    enabled: !localContent,
    provider: 'test',
    localPlaybackReady,
  });
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
  probeEpisode = episode;
  localPlaybackReady = true;
  localContent = false;
  externalParams = {};
  for (const key of Object.keys(mockDownloads)) delete mockDownloads[key];
  mockGetStream.mockReset();
  mockDownloadExists.mockReset().mockResolvedValue(true);
  mockLegacyFile.mockReset().mockResolvedValue(null);
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
});

it('waits for Downloads playback to load before fetching remote servers', async () => {
  probeEpisode = {
    ...episode,
    link: 'content://downloads/video.mp4',
    sourceLink: episode.link,
  } as typeof episode;
  localPlaybackReady = false;
  let resolve!: (value: unknown) => void;
  mockGetStream.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await mount();
  const selected = streams.selectedStream;
  expect(selected.link).toBe(probeEpisode.link);
  expect(streams.isLoading).toBe(false);
  expect(mockGetStream).not.toHaveBeenCalled();
  localPlaybackReady = true;
  act(() =>
    tree.update(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await flush();
  expect(mockGetStream).toHaveBeenCalledTimes(1);
  expect(streams.selectedStream).toBe(selected);
  expect(streams.isLoading).toBe(false);
  await act(async () => {
    resolve([remote]);
  });
  await flush();
  expect(streams.selectedStream).toBe(selected);
  expect(streams.externalSubs).toEqual(remote.subtitles);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  client?.clear();
  jest.restoreAllMocks();
});

it('keeps imported subtitles when provider streams refresh', async () => {
  mockGetStream.mockResolvedValue([remote]);
  await mount();
  const imported = {uri: 'file:///picked.srt', title: 'Picked subtitle'};
  act(() => streams.setExternalSubs(previous => [...previous, imported]));
  const refreshed = {...remote, subtitles: [{uri: 'https://cdn.test/new.vtt', title: 'Updated English'}]};
  act(() => client.setQueryData(['stream', episode.link, params.type, 'test'], [refreshed]));
  await flush();
  expect(streams.externalSubs).toEqual([...refreshed.subtitles, imported]);
});

it('does not carry imported subtitles into the next episode', async () => {
  mockGetStream.mockResolvedValue([remote]);
  await mount();
  act(() => streams.setExternalSubs(previous => [...previous, {uri: 'file:///picked.srt'}]));
  probeEpisode = {...episode, link: 'https://provider.test/episode-2', title: 'Episode 2'};
  act(() => tree.update(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  await flush();
  expect(streams.externalSubs).toEqual(remote.subtitles);
});

it('starts an asynchronously discovered download while remote servers are pending', async () => {
  let resolve!: (value: unknown) => void;
  mockGetStream.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  mockLegacyFile.mockResolvedValue(localPath);
  await mount();
  expect(mockGetStream).toHaveBeenCalledTimes(1);
  expect(streams.selectedStream.link).toBe(localPath);
  expect(streams.isLoading).toBe(false);
  expect(streams.error).toBeNull();
  const selected = streams.selectedStream;
  await act(async () => {
    resolve([remote]);
  });
  await flush();
  expect(streams.streamData.map(stream => stream.link)).toEqual([
    localPath,
    remote.link,
  ]);
  expect(streams.selectedStream).toBe(selected);
  expect(streams.externalSubs).toEqual(remote.subtitles);
  expect(ToastAndroid.show).not.toHaveBeenCalled();

  // Subtitles stay available if the user subsequently switches servers.
  act(() => streams.setSelectedStream(remote));
  expect(streams.externalSubs).toEqual(remote.subtitles);
});

it('keeps a completed download playing when the background provider fails', async () => {
  mockDownloads.video = {
    id: 'video',
    status: 'completed',
    filePath: localPath,
    sourceLink: episode.link,
  };
  let reject!: (error: Error) => void;
  mockGetStream.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await mount();
  const selected = streams.selectedStream;
  expect(selected.link).toBe(localPath);
  expect(streams.isLoading).toBe(false);
  await act(async () => {
    reject(new Error('Provider offline'));
  });
  await flush();
  expect(streams.selectedStream).toBe(selected);
  expect(streams.error).toBeNull();
  expect(streams.isLoading).toBe(false);
  expect(ToastAndroid.show).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
});

it('preserves a selected local file when a refresh returns only remote streams', async () => {
  let resolve!: (value: unknown) => void;
  mockGetStream.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await mount();
  const local = {server: 'Downloaded', type: 'mp4', link: localPath};
  act(() => streams.setSelectedStream(local));
  expect(streams.isLoading).toBe(false);
  await act(async () => {
    resolve([remote]);
  });
  await flush();
  expect(streams.selectedStream).toBe(local);
  expect(streams.externalSubs).toEqual(remote.subtitles);
});

it('still shows foreground loading when no local file exists', async () => {
  localPlaybackReady = false;
  let resolve!: (value: unknown) => void;
  mockGetStream.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await mount();
  expect(streams.selectedStream.link).toBe('');
  expect(streams.isLoading).toBe(true);
  await act(async () => {
    resolve([remote]);
  });
  await flush();
  expect(streams.selectedStream.link).toBe(remote.link);
  expect(streams.isLoading).toBe(false);
});

const brokenDownload = {
  ...episode,
  link: 'content://downloads/video.mp4',
  sourceLink: episode.link,
} as typeof episode;

it('falls back to remote servers when the downloaded file fails to load', async () => {
  probeEpisode = brokenDownload;
  localPlaybackReady = false;
  mockGetStream.mockResolvedValue([remote]);
  await mount();
  expect(mockGetStream).not.toHaveBeenCalled();
  let handled = false;
  act(() => {
    handled = streams.switchToNextStream();
  });
  expect(handled).toBe(true);
  await flush();
  expect(mockGetStream).toHaveBeenCalledTimes(1);
  expect(streams.selectedStream.link).toBe(remote.link);
});

it('surfaces an error when the download fails and no remote server loads', async () => {
  probeEpisode = brokenDownload;
  localPlaybackReady = false;
  mockGetStream.mockRejectedValue(new Error('Provider offline'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await mount();
  jest.useFakeTimers();
  act(() => {
    streams.switchToNextStream();
  });
  // Let the hook's provider retries run out.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000);
  });
  jest.useRealTimers();
  expect(mockGetStream).toHaveBeenCalledTimes(3);
  expect(streams.selectedStream.link).toBe('');
  expect(streams.error).not.toBeNull();
});


it('plays imported SAF files immediately and never fetches providers, even on retry or failure', async () => {
  localContent = true;
  probeEpisode = {...episode, link: 'content://tree/document/video.mkv', sourceLink: episode.link} as typeof episode;
  await mount();
  expect(streams.selectedStream).toEqual({server: 'Local file', link: probeEpisode.link, type: 'local'});
  expect(streams.isLoading).toBe(false);
  expect(mockGetStream).not.toHaveBeenCalled();
  expect(streams.switchToNextStream()).toBe(false);
  await act(async () => {await streams.refetch();});
  await flush();
  expect(mockGetStream).not.toHaveBeenCalled();
});

it('switches imported episodes to their own local URI without provider work', async () => {
  localContent = true;
  probeEpisode = {...episode, link: 'content://tree/document/episode-1.mkv'};
  await mount();
  probeEpisode = {...episode, link: 'content://tree/document/episode-2.mkv', title: 'Episode 2'};
  act(() => tree.update(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  await flush();
  expect(streams.selectedStream.link).toBe(probeEpisode.link);
  expect(streams.isLoading).toBe(false);
  expect(mockGetStream).not.toHaveBeenCalled();
});


it.each([
  ['content://files/shared.mkv', 'video/x-matroska', ''],
  ['https://cdn.test/videoplayback?sig=a%2Bb', 'video/mp4', ''],
  ['https://cdn.test/manifest', 'application/vnd.apple.mpegurl', 'm3u8'],
])('plays an incoming video directly without provider work or a remote-fetch loader: %s', async (uri, mimeType, type) => {
  localContent = true;
  probeEpisode = {...episode, link: uri};
  externalParams = {directUrl: uri, externalVideo: {mimeType}};
  await mount();
  expect(streams.selectedStream).toEqual({server: 'Opened video', link: uri, type});
  expect(streams.streamData).toEqual([streams.selectedStream]);
  expect(streams.isLoading).toBe(false);
  expect(mockGetStream).not.toHaveBeenCalled();
});
