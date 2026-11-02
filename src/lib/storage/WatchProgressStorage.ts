import {MMKVLoader} from 'react-native-mmkv-storage';
import {cacheStorage, mainStorage, registerStorageClearHook} from './StorageService';

export interface WatchProgress {
  position: number;
  duration: number;
}

export const WATCH_PROGRESS_MIGRATED_KEY = 'watch_progress_migrated';

export const isWatchProgressValue = (
  value: string | undefined,
): WatchProgress | null => {
  if (!value) return null;
  if (!value.startsWith('{"position":')) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.position === 'number' &&
      typeof parsed.duration === 'number' &&
      Number.isFinite(parsed.position) &&
      Number.isFinite(parsed.duration) &&
      Object.keys(parsed).length === 2
    ) {
      return {position: parsed.position, duration: parsed.duration};
    }
  } catch {
    return null;
  }
  return null;
};

export class WatchProgressStorage {
  private instance: ReturnType<MMKVLoader['initialize']> | undefined;
  private revision = 0;
  private listeners = new Set<() => void>();
  private knownKeys = new Set<string>();

  // Opened on first use so importing the storage index does not start MMKV.
  private get storage() {
    if (!this.instance) {
      this.instance = new MMKVLoader().withInstanceID('watch-progress').initialize();
      this.loadKnownKeys();
    }
    return this.instance;
  }

  private loadKnownKeys(): void {
    const raw = this.storage.getString('__keys__');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const key of parsed) {
            if (typeof key === 'string') {
              this.knownKeys.add(key);
            }
          }
        }
      } catch {}
    }
  }

  private persistKnownKeys(): void {
    try {
      this.storage.setString(
        '__keys__',
        JSON.stringify(Array.from(this.knownKeys)),
      );
    } catch {}
  }

  getProgress(key: string): WatchProgress | null {
    if (key === '__keys__') return null;
    if (!key) return null;
    const raw = this.storage.getString(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.position === 'number' &&
        typeof parsed.duration === 'number'
      ) {
        return {position: parsed.position, duration: parsed.duration};
      }
    } catch {}
    return null;
  }

  setProgress(key: string, position: number, duration: number): void {
    if (key === '__keys__') return;
    if (!key) return;
    this.storage.setString(key, JSON.stringify({position, duration}));
    this.knownKeys.add(key);
    this.persistKnownKeys();
    this.revision++;
    this.notifyListeners();
  }

  removeProgress(key: string): void {
    if (!key) return;
    this.storage.removeItem(key);
    this.knownKeys.delete(key);
    this.persistKnownKeys();
    this.revision++;
    this.notifyListeners();
  }

  clearAllProgress(): void {
    this.storage.clearStore();
    this.knownKeys.clear();
    this.revision++;
    this.notifyListeners();
  }

  getAllProgress(): Record<string, WatchProgress> {
    const result: Record<string, WatchProgress> = {};
    for (const key of Array.from(this.knownKeys)) {
      if (key === '__keys__') continue;
      const progress = this.getProgress(key);
      if (progress) {
        result[key] = progress;
      } else {
        this.knownKeys.delete(key);
      }
    }
    return result;
  }

  setAllProgress(entries: Record<string, WatchProgress>): void {
    let changed = false;
    for (const [key, progress] of Object.entries(entries)) {
      if (!key || key === '__keys__') continue;
      this.storage.setString(key, JSON.stringify(progress));
      this.knownKeys.add(key);
      changed = true;
    }
    if (changed) {
      this.persistKnownKeys();
      this.revision++;
      this.notifyListeners();
    }
  }

  clearAll(): void {
    this.clearAllProgress();
  }

  getVersion(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (e) {
        console.error('Error in WatchProgressStorage listener:', e);
      }
    });
  }

  async getKeys(): Promise<string[]> {
    if (this.storage?.indexer?.getKeys) {
      try {
        const keys = await this.storage.indexer.getKeys();
        if (Array.isArray(keys)) {
          for (const k of keys) {
            if (k !== '__keys__') {
              this.knownKeys.add(k);
            }
          }
          return keys.filter(k => k !== '__keys__');
        }
        return Array.from(this.knownKeys);
      } catch {
        return Array.from(this.knownKeys);
      }
    }
    return Array.from(this.knownKeys);
  }
}

export const watchProgressStorage = new WatchProgressStorage();

registerStorageClearHook(() => {
  watchProgressStorage.clearAllProgress();
});

export const migrateWatchProgressFromCacheStorage = async (): Promise<boolean> => {
  if (mainStorage.getBool(WATCH_PROGRESS_MIGRATED_KEY, false)) {
    return false;
  }
  const keys = await cacheStorage.getKeys();
  for (const key of keys) {
    const raw = cacheStorage.getString(key);
    const progress = isWatchProgressValue(raw);
    if (progress) {
      watchProgressStorage.setProgress(key, progress.position, progress.duration);
      cacheStorage.delete(key);
    }
  }
  mainStorage.setBool(WATCH_PROGRESS_MIGRATED_KEY, true);
  return true;
};
