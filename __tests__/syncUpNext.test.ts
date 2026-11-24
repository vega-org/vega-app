import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('expo-crypto', () => ({randomUUID: () => 'this-device'}));

jest.mock('../src/lib/storage/StorageService', () => {
  const createStorage = () => {
    const values = new Map<string, unknown>();
    return {
      getString: (key: string) => values.get(key) as string | undefined,
      setString: (key: string, value: string) => values.set(key, value),
      getNumber: (key: string) => values.get(key) as number | undefined,
      setNumber: (key: string, value: number) => values.set(key, value),
      getObject: (key: string) => values.get(key),
      setObject: (key: string, value: unknown) =>
        values.set(key, JSON.parse(JSON.stringify(value))),
      getArray: (key: string) => values.get(key),
      setArray: (key: string, value: unknown) => values.set(key, value),
      delete: (key: string) => values.delete(key),
      clear: () => values.clear(),
    };
  };
  const mainStorage = createStorage();
  return {
    mainStorage,
    cacheStorage: createStorage(),
    createZustandStorage: () => ({
      getItem: (name: string) => mainStorage.getString(name) ?? null,
      setItem: (name: string, value: string) =>
        mainStorage.setString(name, value),
      removeItem: (name: string) => mainStorage.delete(name),
    }),
  };
});

const mockWatchProgress = new Map<string, {position: number; duration: number}>();
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getDownloadLocationConfig: () => ({
      type: 'saf',
      uri: 'content://storage/tree/primary%3Avega',
      label: 'vega',
    }),
  },
  watchProgressStorage: {
    setProgress: (key: string, position: number, duration: number) => {
      mockWatchProgress.set(key, {position, duration});
    },
    getProgress: (key: string) => mockWatchProgress.get(key) || null,
    clearAllProgress: () => mockWatchProgress.clear(),
  },
}));

jest.mock('../src/lib/storage/WatchListStorage', () => ({
  WatchListKeys: {WATCH_LIST: 'watchList'},
  watchListStorage: {
    getWatchList: () => [],
    getCollections: () => [],
    saveCollections: () => undefined,
  },
}));

jest.mock('../src/lib/zustand/downloadsStore', () => {
  const {create} = require('zustand');
  return {
    __esModule: true,
    default: create(() => ({downloads: {}})),
  };
});

jest.mock('../src/lib/zustand/watchListStore', () => {
  const {create} = require('zustand');
  return {
    __esModule: true,
    default: create(() => ({watchList: [], collections: []})),
  };
});

jest.mock('../src/lib/downloadLocation', () => ({
  getSafEntryName: () => undefined,
  isSafDownloadLocation: (config: {type: string}) => config.type === 'saf',
}));

jest.mock('../src/lib/sync/mobileManifestStorage', () => ({
  readMobileSyncManifests: jest.fn(),
  writeMobileSyncManifest: jest.fn(() => Promise.resolve()),
  resolveMobileSyncFileWithLegacyFallback: jest.fn(),
}));

import {
  readMobileSyncManifests,
  writeMobileSyncManifest,
} from '../src/lib/sync/mobileManifestStorage';
import {
  initializeSyncService,
  syncFromSharedFolder,
} from '../src/lib/sync/syncService';
import {cacheStorage, mainStorage} from '../src/lib/storage/StorageService';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../src/lib/zustand/continueWatchingStore';
import {getContinueWatchingRow} from '../src/lib/player/upNext';
import type {SyncedHistory, VegaSyncManifest} from '../src/lib/sync/manifest';

const readManifests = readMobileSyncManifests as jest.MockedFunction<
  typeof readMobileSyncManifests
>;
const writeManifest = writeMobileSyncManifest as jest.MockedFunction<
  typeof writeMobileSyncManifest
>;

const episode = (number: number) => ({
  title: `Episode ${number}`,
  link: `https://example.com/show/${number}`,
});
const movieLink = {title: 'Movie', link: 'https://example.com/movie/1'};

const item = (
  overrides: Partial<ContinueWatchingItem>,
): ContinueWatchingItem => ({
  id: 'show',
  title: 'Show',
  seasonTitle: 'Season 1',
  episode: episode(4),
  type: 'series',
  providerValue: 'vega',
  infoUrl: 'show',
  position: 0,
  duration: 1200,
  updatedAt: 1000,
  ...overrides,
});

const historyEntry = (
  entry: ContinueWatchingItem,
  updatedAt: number,
): SyncedHistory => ({
  id: entry.episode.link,
  title: entry.title,
  provider: entry.providerValue,
  link: entry.infoUrl,
  duration: entry.duration,
  progress: entry.position,
  currentTime: entry.position,
  isSeries: entry.type === 'series',
  lastPlayed: updatedAt,
  episode: entry.episode,
  seasonTitle: entry.seasonTitle,
  type: entry.type,
  updatedAt,
});

const remoteManifest = (entries: SyncedHistory[]): VegaSyncManifest => ({
  schemaVersion: 1,
  deviceId: 'other-device',
  revision: 1,
  generatedAt: 1,
  downloads: {},
  history: Object.fromEntries(entries.map(entry => [entry.id, entry])),
  tombstones: {},
});

const publishedManifest = () =>
  writeManifest.mock.calls[writeManifest.mock.calls.length - 1][1];

describe('Up next with shared-folder sync', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    readManifests.mockReset();
    readManifests.mockResolvedValue([]);
    writeManifest.mockClear();
    await initializeSyncService();
    // Empty the store first: its subscription records removals in storage.
    useContinueWatchingStore.setState({items: []});
    mainStorage.clear();
    cacheStorage.clear();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('publishes the watched episode and the next one without tombstones', async () => {
    const store = useContinueWatchingStore.getState();
    store.upsertItem(item({}));
    store.updateProgress('show', 1100, 1200, episode(4));
    store.finishEpisode('show', episode(4), episode(5));

    await syncFromSharedFolder();

    const {history = {}, tombstones} = publishedManifest();
    expect(history[episode(4).link]).toMatchObject({
      progress: 1100,
      duration: 1200,
    });
    expect(history[episode(5).link]).toMatchObject({progress: 0, duration: 0});
    expect(history[episode(5).link].updatedAt).toBeGreaterThan(
      history[episode(4).link].updatedAt,
    );
    expect(tombstones).toEqual({});
    expect(useContinueWatchingStore.getState().items[0].episode).toEqual(
      episode(5),
    );
  });

  it('keeps a watched movie in history instead of removing it', async () => {
    const store = useContinueWatchingStore.getState();
    store.upsertItem(
      item({id: 'movie', infoUrl: 'movie', type: 'movie', episode: movieLink}),
    );
    store.updateProgress('movie', 1150, 1200, movieLink);
    store.finishEpisode('movie', movieLink);

    await syncFromSharedFolder();

    const {history = {}, tombstones} = publishedManifest();
    expect(history[movieLink.link]).toMatchObject({progress: 1150});
    expect(tombstones).toEqual({});
    const items = useContinueWatchingStore.getState().items;
    expect(items.map(entry => entry.id)).toEqual(['movie']);
    expect(getContinueWatchingRow(items)).toEqual([]);
  });

  it('moves another device on to the next episode', async () => {
    readManifests.mockResolvedValue([
      remoteManifest([
        historyEntry(item({position: 1100}), 1000),
        historyEntry(item({episode: episode(5), duration: 0}), 1001),
      ]),
    ]);

    await syncFromSharedFolder();

    const items = useContinueWatchingStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({episode: episode(5), position: 0});
    expect(getContinueWatchingRow(items)).toEqual(items);
    // Watched marker of the finished episode; the next one keeps its own.
    expect(mockWatchProgress.get(episode(4).link)).toEqual({
      position: 1100,
      duration: 1200,
    });
    expect(mockWatchProgress.get(episode(5).link)).toBeUndefined();
  });

  it('hides a movie another device watched to the end', async () => {
    const movie = item({
      id: 'movie',
      infoUrl: 'movie',
      type: 'movie',
      episode: movieLink,
      position: 1150,
    });
    readManifests.mockResolvedValue([
      remoteManifest([historyEntry(movie, 1000)]),
    ]);

    await syncFromSharedFolder();

    const items = useContinueWatchingStore.getState().items;
    expect(items.map(entry => entry.id)).toEqual(['movie']);
    expect(getContinueWatchingRow(items)).toEqual([]);
  });
});
