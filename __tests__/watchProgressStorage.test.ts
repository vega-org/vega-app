import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const getMockStores = () => {
  const g = globalThis as any;
  if (!g.__mockMMKVStores) {
    g.__mockMMKVStores = new Map<string, Map<string, any>>();
  }
  return g.__mockMMKVStores as Map<string, Map<string, any>>;
};

jest.mock('react-native-mmkv-storage', () => {
  const getOrCreateStore = (instanceId: string) => {
    const g = globalThis as any;
    if (!g.__mockMMKVStores) {
      g.__mockMMKVStores = new Map<string, Map<string, any>>();
    }
    const stores = g.__mockMMKVStores as Map<string, Map<string, any>>;
    let store = stores.get(instanceId);
    if (!store) {
      store = new Map<string, any>();
      stores.set(instanceId, store);
    }
    return store;
  };

  return {
    MMKVLoader: class {
      private instanceId = 'default';

      withInstanceID(id: string) {
        this.instanceId = id;
        return this;
      }

      initialize() {
        const id = this.instanceId;
        const map = getOrCreateStore(id);
        return {
          getString: (key: string) => map.get(key),
          setString: (key: string, value: string) => map.set(key, value),
          getBool: (key: string) => map.get(key),
          setBool: (key: string, value: boolean) => map.set(key, value),
          getInt: (key: string) => map.get(key),
          setInt: (key: string, value: number) => map.set(key, value),
          removeItem: (key: string) => map.delete(key),
          clearStore: () => map.clear(),
          indexer: {
            getKeys: async () => Array.from(map.keys()),
            hasKey: (key: string) => map.has(key),
          },
        };
      }
    },
  };
});

import {
  WATCH_PROGRESS_MIGRATED_KEY,
  isWatchProgressValue,
  migrateWatchProgressFromCacheStorage,
  watchProgressStorage,
} from '../src/lib/storage/WatchProgressStorage';
import {cacheStorage, clearAllMMKVStorage, mainStorage} from '../src/lib/storage/StorageService';

describe('watchProgressStorage', () => {
  beforeEach(() => {
    getMockStores().forEach(map => map.clear());
  });

  it('sets, gets, and removes episode watch progress', () => {
    expect(watchProgressStorage.getProgress('ep1')).toBeNull();

    watchProgressStorage.setProgress('ep1', 120, 600);
    expect(watchProgressStorage.getProgress('ep1')).toEqual({
      position: 120,
      duration: 600,
    });

    watchProgressStorage.setProgress('ep1', 300, 600);
    expect(watchProgressStorage.getProgress('ep1')).toEqual({
      position: 300,
      duration: 600,
    });

    watchProgressStorage.removeProgress('ep1');
    expect(watchProgressStorage.getProgress('ep1')).toBeNull();
  });

  it('clears all progress entries', () => {
    watchProgressStorage.setProgress('ep1', 10, 100);
    watchProgressStorage.setProgress('ep2', 20, 100);

    watchProgressStorage.clearAllProgress();

    expect(watchProgressStorage.getProgress('ep1')).toBeNull();
    expect(watchProgressStorage.getProgress('ep2')).toBeNull();
  });

  it('gets all progress and sets all progress in bulk', () => {
    expect(watchProgressStorage.getAllProgress()).toEqual({});

    watchProgressStorage.setProgress('ep1', 10, 100);
    watchProgressStorage.setProgress('ep2', 20, 200);

    expect(watchProgressStorage.getAllProgress()).toEqual({
      ep1: {position: 10, duration: 100},
      ep2: {position: 20, duration: 200},
    });

    const listener = jest.fn();
    watchProgressStorage.subscribe(listener);
    const versionBefore = watchProgressStorage.getVersion();

    watchProgressStorage.setAllProgress({
      ep3: {position: 30, duration: 300},
      ep4: {position: 40, duration: 400},
    });

    expect(watchProgressStorage.getAllProgress()).toEqual({
      ep1: {position: 10, duration: 100},
      ep2: {position: 20, duration: 200},
      ep3: {position: 30, duration: 300},
      ep4: {position: 40, duration: 400},
    });
    expect(watchProgressStorage.getVersion()).toBe(versionBefore + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('increments version counter and notifies subscribers on changes', () => {
    const listener = jest.fn();
    const unsubscribe = watchProgressStorage.subscribe(listener);

    const initialVersion = watchProgressStorage.getVersion();
    watchProgressStorage.setProgress('ep1', 50, 100);
    expect(watchProgressStorage.getVersion()).toBe(initialVersion + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    watchProgressStorage.removeProgress('ep1');
    expect(watchProgressStorage.getVersion()).toBe(initialVersion + 2);
    expect(listener).toHaveBeenCalledTimes(2);

    watchProgressStorage.clearAllProgress();
    expect(watchProgressStorage.getVersion()).toBe(initialVersion + 3);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    watchProgressStorage.setProgress('ep2', 10, 100);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('validates progress-shaped JSON strings correctly', () => {
    expect(isWatchProgressValue(undefined)).toBeNull();
    expect(isWatchProgressValue('')).toBeNull();
    expect(isWatchProgressValue('invalid json')).toBeNull();
    expect(isWatchProgressValue('{"position":100}')).toBeNull();
    expect(isWatchProgressValue('{"position":"abc","duration":100}')).toBeNull();
    expect(isWatchProgressValue('{"position":100,"duration":500,"extra":1}')).toBeNull();
    expect(isWatchProgressValue('[{"position":100}]')).toBeNull();

    expect(isWatchProgressValue('{"position":150,"duration":900}')).toEqual({
      position: 150,
      duration: 900,
    });
  });

  describe('migration from cacheStorage', () => {
    it('moves only progress-shaped values and preserves unrelated keys', async () => {
      cacheStorage.setString('https://example.com/ep1', JSON.stringify({position: 450, duration: 1800}));
      cacheStorage.setString('https://example.com/ep2', JSON.stringify({position: 1, duration: 1}));

      cacheStorage.setString('skips_show_1', JSON.stringify([{start: 0, end: 90}]));
      cacheStorage.setString('LastPlayed:show_1', JSON.stringify({link: 'ep1'}));
      cacheStorage.setString('ActiveSeason', 'Season 2');
      cacheStorage.setString('EpisodeRange:show_1', '25');
      cacheStorage.setString('lastTextTrack', 'English');
      cacheStorage.setString('contentInfo:show_1', JSON.stringify({title: 'Show 1'}));
      cacheStorage.setString('not_progress', JSON.stringify({position: 1, duration: 1, extra: true}));

      expect(mainStorage.getBool(WATCH_PROGRESS_MIGRATED_KEY, false)).toBe(false);

      const migrated = await migrateWatchProgressFromCacheStorage();
      expect(migrated).toBe(true);

      expect(watchProgressStorage.getProgress('https://example.com/ep1')).toEqual({
        position: 450,
        duration: 1800,
      });
      expect(watchProgressStorage.getProgress('https://example.com/ep2')).toEqual({
        position: 1,
        duration: 1,
      });

      expect(cacheStorage.getString('https://example.com/ep1')).toBeUndefined();
      expect(cacheStorage.getString('https://example.com/ep2')).toBeUndefined();

      expect(cacheStorage.getString('skips_show_1')).toBe(JSON.stringify([{start: 0, end: 90}]));
      expect(cacheStorage.getString('LastPlayed:show_1')).toBe(JSON.stringify({link: 'ep1'}));
      expect(cacheStorage.getString('ActiveSeason')).toBe('Season 2');
      expect(cacheStorage.getString('EpisodeRange:show_1')).toBe('25');
      expect(cacheStorage.getString('lastTextTrack')).toBe('English');
      expect(cacheStorage.getString('contentInfo:show_1')).toBe(JSON.stringify({title: 'Show 1'}));
      expect(cacheStorage.getString('not_progress')).toBe(
        JSON.stringify({position: 1, duration: 1, extra: true}),
      );

      expect(mainStorage.getBool(WATCH_PROGRESS_MIGRATED_KEY, false)).toBe(true);
    });

    it('runs only once and skips migration when flag is already set', async () => {
      mainStorage.setBool(WATCH_PROGRESS_MIGRATED_KEY, true);

      cacheStorage.setString('https://example.com/ep3', JSON.stringify({position: 200, duration: 1000}));

      const secondRun = await migrateWatchProgressFromCacheStorage();
      expect(secondRun).toBe(false);

      expect(cacheStorage.getString('https://example.com/ep3')).toBe(
        JSON.stringify({position: 200, duration: 1000}),
      );
      expect(watchProgressStorage.getProgress('https://example.com/ep3')).toBeNull();
    });
  });

  it('clears watch progress when clearAllMMKVStorage is called', () => {
    watchProgressStorage.setProgress('ep1', 100, 200);
    expect(watchProgressStorage.getProgress('ep1')).not.toBeNull();

    clearAllMMKVStorage();

    expect(watchProgressStorage.getProgress('ep1')).toBeNull();
  });
});
