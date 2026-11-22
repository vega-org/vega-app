import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockCacheStrings = new Map<string, string>();
const mockGetStream = jest.fn<(...args: any[]) => Promise<any>>();
const mockDownloadOutputExists = jest.fn<(path: string) => Promise<boolean>>();
const mockIfExists = jest.fn<(name: string) => Promise<string | false>>();

let mockDownloads: Record<string, any> = {};

jest.mock('react-native', () => ({
  AppState: {addEventListener: jest.fn()},
  ToastAndroid: {show: jest.fn(), SHORT: 0, LONG: 1},
  Platform: {OS: 'android'},
}));

jest.mock('react-native-video', () => ({
  TextTrackType: {
    VTT: 'text/vtt',
    SUBRIP: 'application/x-subrip',
  },
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  exists: jest.fn(),
  readDir: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  StorageAccessFramework: {
    readDirectoryAsync: jest.fn(),
  },
}));

jest.mock('../src/lib/storage', () => ({
  cacheStorage: {
    getString: (key: string) => mockCacheStrings.get(key),
    setString: (key: string, value: string) => mockCacheStrings.set(key, value),
  },
  settingsStorage: {
    getExcludedQualities: () => [],
  },
}));

jest.mock('../src/lib/storage/StorageService', () => ({
  cacheStorage: {
    getString: (key: string) => mockCacheStrings.get(key),
    setString: (key: string, value: string) => mockCacheStrings.set(key, value),
  },
  createZustandStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}));

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {
    getStream: (...args: any[]) => mockGetStream(...args),
    getMetaData: jest.fn(),
  },
}));

jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: (path: string) => mockDownloadOutputExists(path),
}));

jest.mock('../src/lib/file/ifExists', () => ({
  ifExists: (name: string) => mockIfExists(name),
}));

jest.mock('../src/lib/services/videoIntent', () => ({
  externalVideoStream: () => undefined,
}));

jest.mock('../src/lib/services/wafSession', () => ({
  guardWafPrompts: jest.fn(),
}));

jest.mock('../src/lib/hooks/useSavedSubtitles', () => ({
  useSavedSubtitles: () => ({
    savedSubtitles: [],
    saveSubtitle: jest.fn(),
    removeSavedSubtitle: jest.fn(),
  }),
}));

jest.mock('../src/lib/subtitles/savedSubtitles', () => ({
  savedSubtitleTrack: (item: any) => item,
  subtitleVideoKey: () => '',
}));

jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {
    getState: () => ({downloads: mockDownloads}),
  },
  isSubtitleDownloadItem: (item: any) =>
    Boolean(item?.isSubtitle || item?.id?.includes('_subtitle_')),
}));

import {
  fetchStreamList,
  getDownloadedSubtitlesForMedia,
  streamQueryOptions,
} from '../src/lib/hooks/useStream';
import {
  findCompletedDownloadForInfo,
  resolveContinueWatchingOfflinePlayback,
} from '../src/lib/player/offlineContinueWatching';

const makeDownload = (overrides: Record<string, any> = {}) => ({
  schemaVersion: 1,
  id: 'Show_SSeason 1_E1',
  title: 'Show Episode 1',
  showName: 'Show',
  episodeName: 'Episode 1',
  seasonTitle: 'Season 1',
  episodeIndex: 0,
  type: 'series' as const,
  url: 'https://cdn.example.com/ep1.mp4',
  infoUrl: 'https://provider.example.com/show',
  sourceLink: 'https://provider.example.com/show/ep1',
  provider: 'testProvider',
  sourceType: 'http' as const,
  isTorrent: false,
  filePath: '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 1.mp4',
  totalBytes: 1000,
  downloadedBytes: 1000,
  speed: 0,
  status: 'completed' as const,
  canPause: false,
  canResume: false,
  createdAt: 100,
  updatedAt: 100,
  completedAt: 100,
  ...overrides,
});

describe('offline playback', () => {
  beforeEach(() => {
    mockCacheStrings.clear();
    mockDownloads = {};
    mockGetStream.mockReset();
    mockDownloadOutputExists.mockReset();
    mockDownloadOutputExists.mockResolvedValue(true);
    mockIfExists.mockReset();
    mockIfExists.mockResolvedValue(false);
  });

  describe('resolveContinueWatchingOfflinePlayback', () => {
    const continueItem = {
      id: 'https://provider.example.com/show',
      title: 'Show',
      episodeTitle: 'Episode 1',
      seasonTitle: 'Season 1',
      episode: {
        title: 'Episode 1',
        link: 'https://provider.example.com/show/ep1',
      },
      type: 'series',
      poster: 'https://img.example.com/poster.jpg',
      background: 'https://img.example.com/bg.jpg',
      providerValue: 'testProvider',
      infoUrl: 'https://provider.example.com/show',
      position: 120,
      duration: 2400,
      updatedAt: 200,
    };

    it('returns null when cached contentInfo exists (keeps Info screen flow)', async () => {
      mockCacheStrings.set(
        'contentInfo:testProvider:https://provider.example.com/show',
        JSON.stringify({title: 'Show', linkList: [{title: 'Season 1'}]}),
      );
      mockDownloads['Show_SSeason 1_E1'] = makeDownload();

      const params = await resolveContinueWatchingOfflinePlayback(
        continueItem,
        mockDownloads,
      );

      expect(params).toBeNull();
    });

    it('returns direct Player params with sorted season downloads when info cache is missing', async () => {
      const ep1 = makeDownload();
      const ep2 = makeDownload({
        id: 'Show_SSeason 1_E2',
        title: 'Show Episode 2',
        episodeName: 'Episode 2',
        episodeIndex: 1,
        sourceLink: 'https://provider.example.com/show/ep2',
        filePath: '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 2.mp4',
      });
      mockDownloads = {[ep2.id]: ep2, [ep1.id]: ep1};

      const params = await resolveContinueWatchingOfflinePlayback(
        continueItem,
        mockDownloads,
        {alwaysCast: false},
      );

      expect(params).not.toBeNull();
      expect(params?.directUrl).toBe(ep1.filePath);
      expect(params?.linkIndex).toBe(0);
      expect(params?.episodeList).toHaveLength(2);
      expect(params?.episodeList[0]).toMatchObject({
        id: ep1.id,
        link: ep1.filePath,
        sourceLink: ep1.sourceLink,
      });
      expect(params?.episodeList[1]).toMatchObject({
        id: ep2.id,
        link: ep2.filePath,
        sourceLink: ep2.sourceLink,
      });
    });

    it('returns null when downloaded file is missing on disk', async () => {
      mockDownloads['Show_SSeason 1_E1'] = makeDownload();
      mockDownloadOutputExists.mockResolvedValue(false);

      const params = await resolveContinueWatchingOfflinePlayback(
        continueItem,
        mockDownloads,
      );

      expect(params).toBeNull();
    });

    it('finds first sorted completed download for Info offline fallback', () => {
      const ep1 = makeDownload();
      const ep2 = makeDownload({
        id: 'Show_SSeason 1_E2',
        episodeIndex: 1,
      });
      mockDownloads = {[ep2.id]: ep2, [ep1.id]: ep1};

      const found = findCompletedDownloadForInfo(
        mockDownloads,
        'https://provider.example.com/show',
        'testProvider',
      );
      expect(found?.id).toBe(ep1.id);
    });
  });

  describe('fetchStreamList offline', () => {
    it('delivers local stream immediately via onLocalStream and falls back cleanly when provider rejects', async () => {
      const ep1 = makeDownload();
      mockDownloads = {[ep1.id]: ep1};
      const onLocalStream = jest.fn();

      mockGetStream.mockImplementation(async () => {
        // Local stream must already have been handed to the player before provider rejects.
        expect(onLocalStream).toHaveBeenCalledWith({
          server: 'Downloaded',
          link: ep1.filePath,
          type: 'mp4',
        });
        throw new Error('Network request failed');
      });

      const streams = await fetchStreamList({
        episode: {
          id: ep1.id,
          title: 'Episode 1',
          link: ep1.filePath,
          sourceLink: ep1.sourceLink,
        },
        routeParams: {
          type: 'series',
          providerValue: 'testProvider',
          directUrl: ep1.filePath,
        },
        provider: 'testProvider',
        onLocalStream,
      });

      expect(streams).toEqual([
        {server: 'Downloaded', link: ep1.filePath, type: 'mp4'},
      ]);
      expect(streamQueryOptions.networkMode).toBe('always');
    });
  });

  describe('getDownloadedSubtitlesForMedia', () => {
    it('loads OpenSubtitles .srt saved with ${downloadId}_subtitle_${title}', () => {
      const ep1 = makeDownload();
      const openSub = makeDownload({
        id: `${ep1.id}_subtitle_YIFY uploader`,
        title: 'Show Episode 1 YIFY uploader Subtitle ',
        isSubtitle: true,
        videoType: 'application/x-subrip',
        displayFileName: 'Show Episode 1 - YIFY uploader.srt',
        filePath:
          '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 1 - YIFY uploader.srt',
        sourceLink: undefined,
        infoUrl: undefined,
        showName: undefined,
      });
      mockDownloads = {[ep1.id]: ep1, [openSub.id]: openSub};

      const tracks = getDownloadedSubtitlesForMedia(
        {id: ep1.id, title: 'Episode 1', link: ep1.filePath},
        {directUrl: ep1.filePath, linkIndex: 0, episodeList: [{id: ep1.id, link: ep1.filePath}]},
      );

      expect(tracks).toEqual([
        {
          type: 'application/x-subrip',
          language: 'YIFY uploader',
          title: 'YIFY uploader (Downloaded)',
          uri: `file://${openSub.filePath}`,
        },
      ]);
    });

    it('does not leak episode 1 directUrl subtitle onto episode 2', () => {
      const ep1 = makeDownload();
      const ep2 = makeDownload({
        id: 'Show_SSeason 1_E2',
        episodeName: 'Episode 2',
        sourceLink: 'https://provider.example.com/show/ep2',
        filePath: '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 2.mp4',
      });
      const ep1Sub = makeDownload({
        id: `${ep1.id}_subtitle_English`,
        title: 'Show Episode 1 English Subtitle ',
        episodeName: 'Episode 1',
        isSubtitle: true,
        videoType: 'text/vtt',
        displayFileName: 'Show Episode 1 - English.vtt',
        filePath:
          '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 1.vtt',
        sourceLink: ep1.sourceLink,
      });
      const ep2Sub = makeDownload({
        id: `${ep2.id}_subtitle_Spanish`,
        title: 'Show Episode 2 Spanish Subtitle ',
        episodeName: 'Episode 2',
        isSubtitle: true,
        videoType: 'application/x-subrip',
        displayFileName: 'Show Episode 2 - Spanish.SRT',
        filePath:
          '/storage/emulated/0/Download/Vega/Show/Season 1/Show Episode 2.SRT',
        sourceLink: ep2.sourceLink,
      });
      mockDownloads = {
        [ep1.id]: ep1,
        [ep2.id]: ep2,
        [ep1Sub.id]: ep1Sub,
        [ep2Sub.id]: ep2Sub,
      };

      const tracks = getDownloadedSubtitlesForMedia(
        {id: ep2.id, title: 'Episode 2', link: ep2.filePath, sourceLink: ep2.sourceLink},
        {
          directUrl: ep1.filePath,
          linkIndex: 0,
          episodeList: [
            {id: ep1.id, title: 'Episode 1', link: ep1.filePath},
            {id: ep2.id, title: 'Episode 2', link: ep2.filePath},
          ],
        },
      );

      expect(tracks).toEqual([
        {
          type: 'application/x-subrip',
          language: 'Spanish',
          title: 'Spanish (Downloaded)',
          uri: `file://${ep2Sub.filePath}`,
        },
      ]);
    });
  });
});
