import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

type Listener = (state: any) => void;

const mockCreateStore = (initial: Record<string, unknown>) => {
  let state: any = {...initial};
  const listeners: Listener[] = [];
  return {
    getState: () => state,
    setState: (partial: Record<string, unknown>) => {
      state = {...state, ...partial};
      listeners.forEach(listener => listener(state));
    },
    subscribe: (listener: Listener) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
};

jest.mock('expo-crypto', () => ({randomUUID: () => 'device-a'}));

jest.mock('../src/lib/storage/StorageService', () => {
  const makeStorage = () => {
    const values = new Map<string, unknown>();
    const get = (key: string) => values.get(key);
    const set = (key: string, value: unknown) => {
      values.set(key, JSON.parse(JSON.stringify(value)));
    };
    return {
      values,
      getString: get,
      setString: set,
      getNumber: get,
      setNumber: set,
      getObject: get,
      setObject: set,
      getArray: get,
      setArray: set,
    };
  };
  return {mainStorage: makeStorage(), cacheStorage: makeStorage()};
});

jest.mock('../src/lib/storage/WatchListStorage', () => {
  const {mainStorage} = require('../src/lib/storage/StorageService');
  return {
    WatchListKeys: {WATCH_LIST: 'watchlist'},
    watchListStorage: {
      getWatchList: () => mainStorage.getArray('watchlist') || [],
      getCollections: () => [],
      saveCollections: () => undefined,
    },
  };
});

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getDownloadLocationConfig: () => ({type: 'saf', uri: 'content://tree'}),
  },
  watchProgressStorage: {
    setProgress: jest.fn(),
    getProgress: jest.fn(),
  },
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getSafEntryName: (uri?: string) => uri?.split('/').pop() || '',
  isSafDownloadLocation: () => true,
}));

jest.mock('../src/lib/sync/mobileManifestStorage', () => ({
  readMobileSyncManifests: jest.fn(),
  resolveMobileSyncFileWithLegacyFallback: jest.fn(),
  writeMobileSyncManifest: jest.fn(async () => undefined),
}));

jest.mock('../src/lib/zustand/downloadsStore', () => {
  const store = mockCreateStore({downloads: {}});
  const state = store.getState();
  state.removeDownload = (id: string) => {
    const downloads = {...store.getState().downloads};
    delete downloads[id];
    store.setState({downloads});
  };
  state.enqueueDownload = (item: {id: string}) => {
    store.setState({
      downloads: {...store.getState().downloads, [item.id]: item},
    });
  };
  return {__esModule: true, default: store};
});

jest.mock('../src/lib/zustand/continueWatchingStore', () => ({
  __esModule: true,
  default: mockCreateStore({items: []}),
}));

jest.mock('../src/lib/zustand/watchListStore', () => ({
  __esModule: true,
  default: mockCreateStore({watchList: [], collections: []}),
}));

import type {VegaSyncManifest} from '../src/lib/sync/manifest';

// Each test gets fresh modules, so the sync service starts uninitialized.
const load = () => {
  jest.resetModules();
  const files = require('../src/lib/sync/mobileManifestStorage');
  return {
    mainStorage: require('../src/lib/storage/StorageService').mainStorage,
    continueWatching: require('../src/lib/zustand/continueWatchingStore')
      .default,
    watchListStore: require('../src/lib/zustand/watchListStore').default,
    downloads: require('../src/lib/zustand/downloadsStore').default,
    readManifests: files.readMobileSyncManifests as jest.Mock<any>,
    resolveFile:
      files.resolveMobileSyncFileWithLegacyFallback as jest.Mock<any>,
    initializeSyncService: require('../src/lib/sync/syncService')
      .initializeSyncService as () => Promise<void>,
  };
};

let m: ReturnType<typeof load>;

const watchItem = (link: string, updatedAt: number) => ({
  title: link,
  link,
  provider: 'p',
  poster: '',
  updatedAt,
});

const remoteManifest = (
  watchlist: Record<string, ReturnType<typeof watchItem>>,
): VegaSyncManifest => ({
  schemaVersion: 1,
  deviceId: 'desktop',
  revision: 1,
  generatedAt: 1,
  downloads: {
    movie: {
      id: 'movie',
      title: 'Movie',
      relativePath: 'Movie.mp4',
      completedAt: 1,
      updatedAt: 1,
    } as VegaSyncManifest['downloads'][string],
  },
  history: {},
  watchlist,
  tombstones: {},
});

const setLocalWatchList = (items: ReturnType<typeof watchItem>[]) => {
  m.mainStorage.setArray('watchlist', items);
  m.watchListStore.setState({watchList: items});
};

const historyItem = (position: number, updatedAt: number) => ({
  id: 'https://p/show',
  title: 'Show',
  episode: {id: 'ep1', title: 'Ep 1', link: 'ep1', sourceLink: 'ep1'},
  type: 'movie',
  providerValue: 'p',
  infoUrl: 'https://p/show',
  position,
  duration: 100,
  updatedAt,
});

// Starts a sync that pauses while the download file is resolved.
const startSlowSync = async (manifest: VegaSyncManifest) => {
  let finishResolve: (path: string) => void = () => undefined;
  m.readManifests.mockResolvedValue([manifest]);
  m.resolveFile.mockReturnValue(
    new Promise<string>(resolve => {
      finishResolve = resolve;
    }),
  );
  const sync = m.initializeSyncService();
  for (let i = 0; i < 20 && m.resolveFile.mock.calls.length === 0; i++) {
    await Promise.resolve();
  }
  expect(m.resolveFile).toHaveBeenCalled();
  return async () => {
    finishResolve('content://tree/Movie.mp4');
    await sync;
  };
};

describe('shared folder sync keeps local edits made during sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    m = load();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('never publishes local folder imports or overwrites them during shared-folder sync', async () => {
    const local = JSON.stringify({state: {titles: [{id: 'local-only-series', folderUri: 'content://private/video-folder',
      episodes: [{uri: 'content://private/episode.mkv'}], metadata: {imdbId: 'tt123'}}]}, version: 0});
    m.mainStorage.setString('device-local-content-v1', local);
    m.readManifests.mockResolvedValue([]);
    await m.initializeSyncService();
    const {writeMobileSyncManifest} = require('../src/lib/sync/mobileManifestStorage');
    expect(writeMobileSyncManifest).toHaveBeenCalled();
    expect(JSON.stringify(writeMobileSyncManifest.mock.calls)).not.toContain('local-only-series');
    expect(JSON.stringify(writeMobileSyncManifest.mock.calls)).not.toContain('content://private');
    expect(m.mainStorage.getString('device-local-content-v1')).toBe(local);
  });

  it('keeps a watchlist item added while the folder is read', async () => {
    const finish = await startSlowSync(remoteManifest({}));

    setLocalWatchList([watchItem('added', Date.now())]);
    await finish();

    expect(
      m.watchListStore.getState().watchList.map((i: any) => i.link),
    ).toEqual(['added']);
    expect(
      (m.mainStorage.getArray('watchlist') as any[]).map(i => i.link),
    ).toEqual(['added']);
    expect(m.downloads.getState().downloads.movie.filePath).toBe(
      'content://tree/Movie.mp4',
    );
  });

  it('records a tombstone for a watchlist item removed during sync', async () => {
    setLocalWatchList([watchItem('old', 1)]);
    const finish = await startSlowSync(
      remoteManifest({old: watchItem('old', 1)}),
    );

    setLocalWatchList([]);
    await finish();

    expect(m.watchListStore.getState().watchList).toEqual([]);
    expect(m.mainStorage.getObject('vega-sync-tombstones')).toHaveProperty([
      'watchlist:old',
    ]);
  });

  it('keeps Continue Watching progress saved during sync', async () => {
    m.continueWatching.setState({items: [historyItem(10, 1000)]});
    const finish = await startSlowSync(remoteManifest({}));

    m.continueWatching.setState({items: [historyItem(50, 2000)]});
    await finish();

    expect(m.continueWatching.getState().items[0].position).toBe(50);
  });
});
