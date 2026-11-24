import {MMKVLoader} from 'react-native-mmkv-storage';
import type {StateStorage} from 'zustand/middleware';

/**
 * Interface for the StorageService class
 */
export interface IStorageService {
  getRevision?(key: string): number;
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
  getBool(key: string, defaultValue?: boolean): boolean;
  setBool(key: string, value: boolean): void;
  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;
  getObject<T>(key: string): T | undefined;
  setObject<T>(key: string, value: T): void;
  getArray<T>(key: string): T[] | undefined;
  setArray<T>(key: string, value: T[]): void;
  delete(key: string): void;
  contains(key: string): boolean;
  hasKey(key: string): boolean;
  clearAll(): void;
  getKeys(): Promise<string[]>;
}

/**
 * Base storage service that wraps MMKV operations
 */
export class StorageService implements IStorageService {
  // Define storage variable with proper typing
  private storage;
  private revision = 0;
  private clearedAt = 0;
  private readonly keyRevisions = new Map<string, number>();

  getRevision(key: string): number {
    return this.keyRevisions.get(key) ?? this.clearedAt;
  }

  private didWrite(key: string): void {
    this.keyRevisions.set(key, ++this.revision);
  }

  constructor(instanceId?: string) {
    const loader = new MMKVLoader();
    this.storage = instanceId
      ? loader.withInstanceID(instanceId).initialize()
      : loader.initialize();
  }

  // String operations
  getString(key: string): string | undefined {
    return this.storage.getString(key) ?? undefined;
  }

  setString(key: string, value: string): void {
    this.storage.setString(key, value);
    this.didWrite(key);
  }

  // Boolean operations
  getBool(key: string, defaultValue?: boolean): boolean {
    const value = this.storage.getBool(key);
    return value == null ? defaultValue || false : value;
  }

  setBool(key: string, value: boolean): void {
    this.storage.setBool(key, value);
    this.didWrite(key);
  }

  // Number operations
  getNumber(key: string): number | undefined {
    // Use getInt or getFloat equivalent methods which exist in MMKV
    return this.storage.getInt(key) ?? undefined;
  }

  setNumber(key: string, value: number): void {
    // Use setInt for number values
    this.storage.setInt(key, value);
    this.didWrite(key);
  }

  // Object operations
  getObject<T>(key: string): T | undefined {
    const json = this.storage.getString(key);
    if (!json) {
      return undefined;
    }
    try {
      return JSON.parse(json) as T;
    } catch (e) {
      console.error(`Failed to parse stored object for key ${key}:`, e);
      return undefined;
    }
  }

  setObject<T>(key: string, value: T): void {
    this.setString(key, JSON.stringify(value));
  }

  // Array operations
  getArray<T>(key: string): T[] | undefined {
    return this.getObject<T[]>(key);
  }

  setArray<T>(key: string, value: T[]): void {
    this.setObject(key, value);
  }

  // Delete operations
  delete(key: string): void {
    this.storage.removeItem(key);
    this.didWrite(key);
  }

  // Check if key exists
  contains(key: string): boolean {
    // Check if key exists by attempting to get the value
    return (
      this.storage.getString(key) !== undefined ||
      this.storage.getBool(key) !== undefined ||
      this.storage.getInt(key) !== undefined
    );
  }

  // Check if a key was saved, whatever its type
  hasKey(key: string): boolean {
    return this.storage.indexer.hasKey(key);
  }

  // Clear all storage
  clearAll(): void {
    this.storage.clearStore();
    this.keyRevisions.clear();
    this.clearedAt = ++this.revision;
  }

  // Get all keys
  async getKeys(): Promise<string[]> {
    if (this.storage?.indexer?.getKeys) {
      try {
        const keys = await this.storage.indexer.getKeys();
        return Array.isArray(keys) ? keys : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

// Create and export default instances
export const mainStorage: IStorageService = new StorageService();
export const cacheStorage: IStorageService = new StorageService('cache');
export const providerKvStorage: IStorageService = new StorageService(
  'provider_kv',
);
// Cookies saved by providers, one jar per source author.
export const providerCookieStorage: IStorageService = new StorageService(
  'provider_cookies',
);

const storageClearHooks: Array<() => void> = [];
export const registerStorageClearHook = (hook: () => void): void => {
  storageClearHooks.push(hook);
};

export const clearAllMMKVStorage = (): void => {
  cacheStorage.clearAll();
  mainStorage.clearAll();
  providerKvStorage.clearAll();
  providerCookieStorage.clearAll();
  storageClearHooks.forEach(hook => {
    try {
      hook();
    } catch (e) {
      console.error("Error running storage clear hook:", e);
    }
  });
};

export const createZustandStorage = (
  storage: IStorageService = mainStorage,
): StateStorage => ({
  getItem: name => storage.getString(name) ?? null,
  setItem: (name, value) => storage.setString(name, value),
  removeItem: name => storage.delete(name),
});
