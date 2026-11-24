import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockFiles = new Map<string, number>();
const mockDirectories = new Set<string>();
const mockSafFiles = new Map<string, number>();
const mockSafDirectories = new Set<string>();
const mockScheduleQueuedDownloads = jest.fn(async () => undefined);

const getSafChildren = (parent: string) =>
  [
    ...[...mockSafDirectories].filter(uri => uri.startsWith(`${parent}/`)),
    ...[...mockSafFiles.keys()].filter(uri => uri.startsWith(`${parent}/`)),
  ].filter(uri => !uri.slice(parent.length + 1).includes('/'));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  DocumentDirectoryPath: '/files',
  exists: async (path: string) =>
    mockFiles.has(path) || mockDirectories.has(path),
  stat: async (path: string) => ({size: mockFiles.get(path) || 0}),
  unlink: async (path: string) => {
    mockFiles.delete(path);
    mockDirectories.delete(path);
  },
  readDir: async (path: string) =>
    [...mockDirectories]
      .filter(directory => directory.startsWith(`${path}/`))
      .map(directory => ({path: directory, isDirectory: () => true})),
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async (uri: string) => ({
    exists: mockSafFiles.has(uri),
    size: mockSafFiles.get(uri),
  }),
  StorageAccessFramework: {
    readDirectoryAsync: async (directory: string) => getSafChildren(directory),
    makeDirectoryAsync: async (parent: string, name: string) => {
      const uri = `${parent}/${name}`;
      mockSafDirectories.add(uri);
      return uri;
    },
    deleteAsync: async (uri: string) => {
      mockSafFiles.delete(uri);
      mockSafDirectories.delete(uri);
    },
    createFileAsync: async (directory: string, name: string) => {
      const uri = `${directory}/${name}`;
      mockSafFiles.set(uri, 0);
      return uri;
    },
  },
}));

jest.mock('react-native', () => ({
  NativeModules: {
    SafCopyModule: {
      copyFileToUri: async (from: string, uri: string) =>
        mockSafFiles.set(uri, mockFiles.get(from) || 0),
      getUriSize: async (uri: string) => mockSafFiles.get(uri) ?? -1,
    },
  },
}));

jest.mock('../src/lib/services/Notification', () => ({
  notificationService: {
    cancelNotification: jest.fn(async () => undefined),
    resetDownloadForegroundState: jest.fn(async () => undefined),
  },
}));

jest.mock('../src/lib/downloadManager', () => ({
  scheduleQueuedDownloads: mockScheduleQueuedDownloads,
}));

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }
    initialize() {
      return {
        getString: () => undefined,
        setString: () => undefined,
        getBool: () => undefined,
        setBool: () => undefined,
        getInt: () => undefined,
        setInt: () => undefined,
        removeItem: () => undefined,
        clearStore: () => undefined,
      };
    }
  },
}));

import {
  reconcileCompletedDownloadOutputs,
  reconcileDownloadState,
} from '../src/lib/downloadReconciliation';
import {getDownloadStagingDirectory} from '../src/lib/downloadDestination';
import * as downloadDestination from '../src/lib/downloadDestination';
import {notificationService} from '../src/lib/services/Notification';
import useDownloadsStore from '../src/lib/zustand/downloadsStore';

const mockCancelNotification =
  notificationService.cancelNotification as jest.Mock;
const mockResetForeground =
  notificationService.resetDownloadForegroundState as jest.Mock;

const location = {
  type: 'saf' as const,
  uri: 'content://downloads/tree',
  label: 'Downloads',
};

describe('download startup reconciliation', () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    mockFiles.clear();
    mockDirectories.clear();
    mockSafFiles.clear();
    mockSafDirectories.clear();
    mockCancelNotification.mockClear();
    mockResetForeground.mockClear();
    mockScheduleQueuedDownloads.mockClear();
    useDownloadsStore.setState({downloads: {}});
  });

  it('marks persisted active work as interrupted without resuming it', async () => {
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_direct_0',
      title: 'Movie',
      type: 'movie',
      url: 'https://example.com/movie.mp4',
      status: 'downloading',
      stagingPath: '/cache/downloads/movie/movie.mp4.part',
    });
    mockFiles.set('/cache/downloads/movie/movie.mp4.part', 100);

    await reconcileDownloadState();

    expect(useDownloadsStore.getState().downloads.movie_direct_0.status).toBe(
      'interrupted',
    );
  });

  it('requeues a native HTTP download from its partial SAF file', async () => {
    const partialUri = 'content://downloads/tree/movie/Movie.mp4';
    mockSafFiles.set(partialUri, 4096);
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_native_0',
      title: 'Movie',
      type: 'movie',
      url: 'https://example.com/movie.mp4',
      sourceType: 'http',
      status: 'downloading',
      finalDocumentUri: partialUri,
      downloadLocation: location,
    });

    await reconcileDownloadState();

    expect(useDownloadsStore.getState().downloads.movie_native_0).toMatchObject(
      {
        status: 'queued',
        downloadedBytes: 4096,
      },
    );
    expect(mockScheduleQueuedDownloads).toHaveBeenCalledTimes(1);
  });

  it('requeues a network-paused native HTTP download after restart', async () => {
    const partialUri = 'content://downloads/tree/movie/Movie.mp4';
    mockSafFiles.set(partialUri, 8192);
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_network_paused_0',
      title: 'Movie',
      type: 'movie',
      url: 'https://example.com/movie.mp4',
      sourceType: 'http',
      status: 'paused',
      errorCode: 'NETWORK_INTERRUPTED',
      finalDocumentUri: partialUri,
      downloadLocation: location,
    });

    await reconcileDownloadState();

    expect(
      useDownloadsStore.getState().downloads.movie_network_paused_0,
    ).toMatchObject({
      status: 'queued',
      downloadedBytes: 8192,
      errorCode: undefined,
    });
  });

  it('marks a completed record missing when its SAF document is gone', async () => {
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_direct_0',
      title: 'Movie',
      type: 'movie',
      url: 'https://example.com/movie.mp4',
      status: 'completed',
      filePath: 'content://downloads/movie.mp4',
    });

    await reconcileDownloadState();

    expect(useDownloadsStore.getState().downloads.movie_direct_0.status).toBe(
      'missing',
    );
  });

  it('rechecks completed files without interrupting active downloads', async () => {
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_completed_0',
      title: 'Completed Movie',
      type: 'movie',
      url: 'https://example.com/completed.mp4',
      status: 'completed',
      filePath: 'content://downloads/completed.mp4',
    });
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_active_0',
      title: 'Active Movie',
      type: 'movie',
      url: 'https://example.com/active.mp4',
      status: 'downloading',
    });

    await reconcileCompletedDownloadOutputs();

    expect(
      useDownloadsStore.getState().downloads.movie_completed_0.status,
    ).toBe('missing');
    expect(useDownloadsStore.getState().downloads.movie_active_0.status).toBe(
      'downloading',
    );
  });

  const addCompletedFiles = (count: number) => {
    for (let index = 0; index < count; index++) {
      useDownloadsStore.getState().enqueueDownload({
        id: `completed_${index}`,
        title: `Movie ${index}`,
        type: 'movie',
        url: 'https://example.com/movie.mp4',
        status: 'completed',
        filePath: `content://downloads/movie_${index}.mp4`,
      });
    }
  };
  const flushChecks = async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
  };

  it('bounds native file checks while still checking the whole library', async () => {
    addCompletedFiles(11);
    const pending: Array<(exists: boolean) => void> = [];
    let active = 0;
    let peak = 0;
    const exists = jest.spyOn(downloadDestination, 'downloadOutputExists')
      .mockImplementation(() => {
        active++;
        peak = Math.max(peak, active);
        return new Promise<boolean>(resolve => pending.push(value => {
          active--;
          resolve(value);
        }));
      });
    const check = reconcileCompletedDownloadOutputs();
    expect(exists).toHaveBeenCalledTimes(4);
    while (pending.length) {
      pending.splice(0).forEach(resolve => resolve(true));
      await flushChecks();
    }
    await check;
    expect(exists).toHaveBeenCalledTimes(11);
    expect(peak).toBe(4);
    expect(Object.values(useDownloadsStore.getState().downloads)
      .every(record => record.status === 'completed')).toBe(true);
  });

  it('checks only the opened title/season IDs and leaves unrelated files alone', async () => {
    addCompletedFiles(11);
    const exists = jest.spyOn(downloadDestination, 'downloadOutputExists')
      .mockResolvedValue(false);
    await reconcileCompletedDownloadOutputs(undefined, new Set(['completed_2', 'completed_5']));
    expect(exists).toHaveBeenCalledTimes(2);
    expect(useDownloadsStore.getState().downloads.completed_2.status).toBe('missing');
    expect(useDownloadsStore.getState().downloads.completed_5.status).toBe('missing');
    expect(useDownloadsStore.getState().downloads.completed_0.status).toBe('completed');
  });

  it('keeps completed files when access checks fail rather than report absence', async () => {
    addCompletedFiles(2);
    jest.spyOn(downloadDestination, 'downloadOutputExists').mockRejectedValue(new Error('Permission denied'));
    await reconcileCompletedDownloadOutputs();
    expect(useDownloadsStore.getState().downloads.completed_0.status).toBe('completed');
    expect(useDownloadsStore.getState().downloads.completed_1.status).toBe('completed');
  });

  it('stops launching checks and applying results after focus cancellation', async () => {
    addCompletedFiles(11);
    const pending: Array<(exists: boolean) => void> = [];
    const exists = jest.spyOn(downloadDestination, 'downloadOutputExists')
      .mockImplementation(() => new Promise<boolean>(resolve => pending.push(resolve)));
    const controller = new AbortController();
    const check = reconcileCompletedDownloadOutputs(controller.signal);
    controller.abort();
    pending.forEach(resolve => resolve(false));
    await check;
    expect(exists).toHaveBeenCalledTimes(4);
    expect(Object.values(useDownloadsStore.getState().downloads)
      .every(record => record.status === 'completed')).toBe(true);
  });

  it('does not overwrite a record replaced while a file check was pending', async () => {
    addCompletedFiles(1);
    let resolveCheck!: (exists: boolean) => void;
    jest.spyOn(downloadDestination, 'downloadOutputExists')
      .mockImplementation(() => new Promise<boolean>(resolve => {resolveCheck = resolve;}));
    const check = reconcileCompletedDownloadOutputs();
    const record = useDownloadsStore.getState().downloads.completed_0;
    const replacement = {...record, filePath: 'content://downloads/new.mp4'};
    useDownloadsStore.setState({downloads: {completed_0: replacement}});
    resolveCheck(false);
    await check;
    expect(useDownloadsStore.getState().downloads.completed_0).toBe(replacement);
    expect(replacement.status).toBe('completed');
  });

  it.each(['queued', 'paused', 'interrupted', 'error'] as const)(
    'preserves an existing %s state',
    async status => {
      useDownloadsStore.getState().enqueueDownload({
        id: 'movie_direct_0',
        title: 'Movie',
        type: 'movie',
        url: 'https://example.com/movie.mp4',
        status,
      });

      await reconcileDownloadState();

      expect(useDownloadsStore.getState().downloads.movie_direct_0.status).toBe(
        status,
      );
    },
  );

  it('finishes a persisted finalizing record from staging', async () => {
    const stagingPath = '/cache/downloads/movie/movie.mp4.part';
    mockFiles.set(stagingPath, 512);
    useDownloadsStore.getState().enqueueDownload({
      id: 'movie_direct_0',
      title: 'Movie',
      type: 'movie',
      url: 'https://example.com/movie.mp4',
      videoType: 'mp4',
      status: 'finalizing',
      stagingPath,
      downloadLocation: location,
    });

    await reconcileDownloadState();

    expect(useDownloadsStore.getState().downloads.movie_direct_0).toMatchObject(
      {
        status: 'completed',
        filePath: 'content://downloads/tree/Movie/Movie.mp4',
      },
    );
  });

  it('clears stale foreground notification state', async () => {
    await reconcileDownloadState();
    expect(mockResetForeground).toHaveBeenCalledTimes(1);
  });

  it('starts persisted queued downloads after reconciliation', async () => {
    await reconcileDownloadState();

    expect(mockScheduleQueuedDownloads).toHaveBeenCalledTimes(1);
  });

  it('keeps staging directories that belong to known downloads', async () => {
    const id =
      'A Very Long Show Title_SSeason 1 (2022) Dual Audio {Hindi-English} 480p [150MB] || 720p [400MB] || 1080p [1.2GB]_E1';
    const stagingDirectory = getDownloadStagingDirectory(id);
    mockDirectories.add('/cache/downloads');
    mockDirectories.add(stagingDirectory);
    mockDirectories.add('/cache/downloads/orphan');
    useDownloadsStore.getState().enqueueDownload({
      id,
      title: 'Episode 1',
      type: 'series',
      url: 'https://example.com/episode.m3u8',
      videoType: 'm3u8',
      status: 'queued',
      downloadLocation: location,
    });

    await reconcileDownloadState();

    expect(mockDirectories.has(stagingDirectory)).toBe(true);
    expect(mockDirectories.has('/cache/downloads/orphan')).toBe(false);
  });

  it('removes orphan app-private staging directories', async () => {
    mockDirectories.add('/cache/downloads');
    mockDirectories.add('/cache/downloads/orphan');

    await reconcileDownloadState();

    expect(mockDirectories.has('/cache/downloads/orphan')).toBe(false);
  });

  it('removes orphaned legacy and cached torrent stream directories on startup', async () => {
    mockDirectories.add('/files/torrents');
    mockDirectories.add('/cache/torrents');

    await reconcileDownloadState();

    expect(mockDirectories.has('/files/torrents')).toBe(false);
    expect(mockDirectories.has('/cache/torrents')).toBe(false);
  });
});
