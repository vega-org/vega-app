import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import type {VegaSyncManifest} from '../src/lib/sync/manifest';

let mockSyncEnabled = false;

const mockList = jest.fn(async (_uri: string) => []);
const mockCreate = jest.fn(async (_parent: string, _name: string, _directory: boolean) => 'content://created');
const mockWrite = jest.fn(async (_uri: string, _text: string) => undefined);

const mockNative = {
  listDirectory: mockList,
  createDocument: mockCreate,
  writeManifest: mockWrite,
};

jest.mock('react-native', () => ({
  NativeModules: {
    get VegaSyncStorage() {
      return mockNative;
    },
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    readDirectoryAsync: jest.fn(() => {
      throw new Error('Unsafe legacy listing');
    }),
    makeDirectoryAsync: jest.fn(() => {
      throw new Error('Unsafe legacy creation');
    }),
    createFileAsync: jest.fn(() => {
      throw new Error('Unsafe legacy creation');
    }),
    readAsStringAsync: jest.fn(async () => ''),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-device-uuid',
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getSafEntryName: (uri?: string) => uri?.split('/').pop() || '',
  isSafDownloadLocation: () => true,
  parseDownloadLocation: () => ({type: 'saf', uri: 'content://tree/root'}),
  serializeDownloadLocation: () => '',
  getDownloadLocationDisplayValue: () => 'content://tree/root',
}));

const mockProgressSet = jest.fn();
const mockProgressGet = jest.fn();

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isSyncEnabled: () => mockSyncEnabled,
    getDownloadLocationConfig: () => ({type: 'saf', uri: 'content://tree/root'}),
  },
  watchProgressStorage: {
    setProgress: (...args: any[]) => mockProgressSet(...args),
    getProgress: (...args: any[]) => mockProgressGet(...args),
  },
}));

const makeStorage = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    getString: (key: string) => values.get(key),
    setString: (key: string, val: unknown) => values.set(key, val),
    getNumber: (key: string) => values.get(key),
    setNumber: (key: string, val: unknown) => values.set(key, val),
    getObject: (key: string) => values.get(key),
    setObject: (key: string, val: unknown) => values.set(key, val),
    getArray: (key: string) => values.get(key),
    setArray: (key: string, val: unknown) => values.set(key, val),
  };
};

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: makeStorage(),
  cacheStorage: makeStorage(),
}));

jest.mock('../src/lib/storage/WatchListStorage', () => ({
  WatchListKeys: {WATCH_LIST: 'watchlist'},
  watchListStorage: {
    getWatchList: () => [],
    getCollections: () => [],
    saveCollections: () => undefined,
  },
}));

jest.mock('../src/lib/zustand/downloadsStore', () => {
  let state: any = {downloads: {}};
  const listeners: any[] = [];
  const store = {
    getState: () => state,
    setState: (partial: any) => {
      state = {...state, ...partial};
      listeners.forEach(l => l(state));
    },
    subscribe: (l: any) => {
      listeners.push(l);
      return () => undefined;
    },
  };
  (globalThis as any).__mockDownloadsStore = store;
  return {__esModule: true, default: store};
});

jest.mock('../src/lib/zustand/continueWatchingStore', () => {
  let state: any = {items: []};
  const listeners: any[] = [];
  const store = {
    getState: () => state,
    setState: (partial: any) => {
      state = {...state, ...partial};
      listeners.forEach(l => l(state));
    },
    subscribe: (l: any) => {
      listeners.push(l);
      return () => undefined;
    },
  };
  (globalThis as any).__mockContinueWatchingStore = store;
  return {__esModule: true, default: store};
});

jest.mock('../src/lib/zustand/watchListStore', () => {
  let state: any = {watchList: [], collections: []};
  const listeners: any[] = [];
  const store = {
    getState: () => state,
    setState: (partial: any) => {
      state = {...state, ...partial};
      listeners.forEach(l => l(state));
    },
    subscribe: (l: any) => {
      listeners.push(l);
      return () => undefined;
    },
  };
  (globalThis as any).__mockWatchListStore = store;
  return {__esModule: true, default: store};
});

import * as mobileStorage from '../src/lib/sync/mobileManifestStorage';
import {
  initializeSyncService,
  publishSyncManifest,
  setSyncedEpisodeProgress,
  syncFromSharedFolder,
} from '../src/lib/sync/syncService';

const dummyManifest: VegaSyncManifest = {
  schemaVersion: 1,
  deviceId: 'test-device-uuid',
  revision: 1,
  generatedAt: Date.now(),
  library: {
    watchlist: {},
    history: {},
    collections: [],
  },
  tombstones: [],
};

const safLocation = {
  type: 'saf' as const,
  uri: 'content://tree/root',
};

describe('sync disabled', () => {
  let writeSpy: any;
  let readSpy: any;

  beforeEach(() => {
    mockSyncEnabled = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
    writeSpy = jest.spyOn(mobileStorage, 'writeMobileSyncManifest');
    readSpy = jest.spyOn(mobileStorage, 'readMobileSyncManifests');
  });

  afterEach(() => {
    writeSpy.mockRestore();
    readSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('syncService guards', () => {
    it('publishSyncManifest does not write manifest or access storage when sync is disabled', async () => {
      await publishSyncManifest();

      expect(writeSpy).not.toHaveBeenCalled();
      expect(mockNative.createDocument).not.toHaveBeenCalled();
      expect(mockNative.writeManifest).not.toHaveBeenCalled();
    });

    it('syncFromSharedFolder returns early and does not read or write manifests', async () => {
      await syncFromSharedFolder();

      expect(readSpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(mockNative.listDirectory).not.toHaveBeenCalled();
      expect(mockNative.createDocument).not.toHaveBeenCalled();
    });

    it('setSyncedEpisodeProgress updates local watchProgress but does not trigger publish when sync is disabled', async () => {
      await setSyncedEpisodeProgress({
        title: 'Show',
        poster: '',
        infoUrl: 'show-1',
        provider: 'test-provider',
        type: 'series',
        position: 50,
        duration: 100,
        episode: {
          title: 'Episode 1',
          link: 'ep-link-1',
          season: 1,
          episode: 1,
        } as any,
      });

      expect(mockProgressSet).toHaveBeenCalledWith('ep-link-1', 50, 100);
      expect(writeSpy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('store subscriptions in initializeSyncService do not trigger publish when sync is disabled', async () => {
      await initializeSyncService();

      const continueWatchingStore = (globalThis as any).__mockContinueWatchingStore;
      continueWatchingStore.setState({
        items: [
          {
            id: 'item-1',
            title: 'New Item',
            link: 'new-item',
            infoUrl: 'new-item',
            providerValue: 'test',
            position: 10,
            duration: 100,
            updatedAt: Date.now(),
            episode: {
              id: 'ep-1',
              link: 'ep-1',
              title: 'Episode 1',
              sourceLink: 'ep-1',
            },
          },
        ],
      });

      jest.advanceTimersByTime(5000);
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('mobileManifestStorage defensive guards', () => {
    it('readMobileSyncManifests returns empty array without filesystem calls when sync is disabled', async () => {
      readSpy.mockRestore(); // Call real implementation

      const manifests = await mobileStorage.readMobileSyncManifests(safLocation);

      expect(manifests).toEqual([]);
      expect(mockNative.listDirectory).not.toHaveBeenCalled();
      expect(mockNative.createDocument).not.toHaveBeenCalled();
    });

    it('writeMobileSyncManifest returns false without creating directory or writing file when sync is disabled', async () => {
      writeSpy.mockRestore(); // Call real implementation

      const success = await mobileStorage.writeMobileSyncManifest(safLocation, dummyManifest);

      expect(success).toBe(false);
      expect(mockNative.createDocument).not.toHaveBeenCalled();
      expect(mockNative.writeManifest).not.toHaveBeenCalled();
    });
  });
});
