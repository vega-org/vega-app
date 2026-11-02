import {beforeEach, describe, expect, it, jest} from '@jest/globals';

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
      setObject: (key: string, value: unknown) => values.set(key, value),
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

import {readMobileSyncManifests} from '../src/lib/sync/mobileManifestStorage';
import {syncFromSharedFolder} from '../src/lib/sync/syncService';
import {cacheStorage, mainStorage} from '../src/lib/storage/StorageService';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../src/lib/zustand/continueWatchingStore';
import type {SyncedHistory, VegaSyncManifest} from '../src/lib/sync/manifest';

const readManifests = readMobileSyncManifests as jest.MockedFunction<
  typeof readMobileSyncManifests
>;

const historyEntry = (
  show: string,
  episode: number,
  updatedAt: number,
  position: number,
  duration: number,
): SyncedHistory => {
  const link = `https://example.com/${show}/${episode}`;
  return {
    id: link,
    title: show,
    provider: 'vega',
    link: show,
    duration,
    progress: position,
    currentTime: position,
    isSeries: true,
    lastPlayed: updatedAt,
    episode: {title: `Episode ${episode}`, link},
    type: 'series',
    updatedAt,
  };
};

const remoteManifest = (entries: SyncedHistory[]): VegaSyncManifest => ({
  schemaVersion: 1,
  deviceId: 'other-device',
  revision: 1,
  generatedAt: 1,
  downloads: {},
  history: Object.fromEntries(entries.map(entry => [entry.id, entry])),
  tombstones: {},
});

const localItem = (show: string, updatedAt: number): ContinueWatchingItem => ({
  id: show,
  title: show,
  episode: {title: 'Episode 1', link: `https://example.com/${show}/1`},
  type: 'series',
  providerValue: 'vega',
  infoUrl: show,
  position: 300,
  duration: 1200,
  updatedAt,
});

describe('continue watching sync', () => {
  beforeEach(() => {
    readManifests.mockReset();
    mainStorage.clear();
    cacheStorage.clear();
    useContinueWatchingStore.setState({items: []});
  });

  it('keeps a show that fell out of the synced history', async () => {
    useContinueWatchingStore.setState({items: [localItem('old-show', 1)]});
    readManifests.mockResolvedValue([
      remoteManifest(
        Array.from({length: 50}, (_, index) =>
          historyEntry('busy-show', index, 1000 + index, 300, 1200),
        ),
      ),
    ]);

    await syncFromSharedFolder();

    const ids = useContinueWatchingStore.getState().items.map(item => item.id);
    expect(ids).toEqual(['busy-show', 'old-show']);
  });

  it('does not add a show only marked as watched or unwatched', async () => {
    readManifests.mockResolvedValue([
      remoteManifest([
        historyEntry('marked-show', 1, 2000, 1, 1),
        historyEntry('unmarked-show', 1, 2001, 0, 1),
        historyEntry('played-show', 1, 1000, 300, 1200),
      ]),
    ]);

    await syncFromSharedFolder();

    const ids = useContinueWatchingStore.getState().items.map(item => item.id);
    expect(ids).toEqual(['played-show']);
    expect(mockWatchProgress.get('https://example.com/marked-show/1')).toEqual({
      position: 1,
      duration: 1,
    });
  });
});
