// Export StorageService
export {
  StorageService,
  mainStorage,
  cacheStorage,
  clearAllMMKVStorage,
  createZustandStorage,
} from './StorageService';

// Export SettingsStorage
export {
  SettingsStorage,
  settingsStorage,
  BUFFER_LIMITS,
  MAX_DOWNLOAD_CONNECTIONS,
  MIN_DOWNLOAD_CONNECTIONS,
  SEEK_INTERVAL_OPTIONS,
  PLAYBACK_SPEEDS,
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_STEP,
  PLAYER_RESIZE_MODES,
} from './SettingsStorage';
export type {SettingsKeys, PlayerResizeMode} from './SettingsStorage';

// Export WatchListStorage
export {
  WatchListStorage,
  watchListStorage,
  DEFAULT_COLLECTION,
  DEFAULT_COLLECTION_ID,
  getItemCollectionIds,
} from './WatchListStorage';
export type {
  WatchListKeys,
  WatchListItem,
  LibraryCollection,
} from './WatchListStorage';

// Export CacheStorage
export {CacheStorage, cacheStorageService} from './CacheStorage';

// Export ProvidersStorage
export {ProvidersStorage, providersStorage} from './ProvidersStorage';
export type {ProvidersKeys} from './ProvidersStorage';

// Export DownloadsStorage
export {DownloadsStorage, downloadsStorage} from './DownloadsStorage';
export type {DownloadsKeys, DownloadPayload} from './DownloadsStorage';

// Export ExtensionStorage
export {ExtensionStorage, extensionStorage} from './extensionStorage';
export type {
  ExtensionKeys,
  ProviderExtension,
  ProviderModule,
} from './extensionStorage';

// Export WatchProgressStorage
export {
  WatchProgressStorage,
  watchProgressStorage,
  migrateWatchProgressFromCacheStorage,
} from './WatchProgressStorage';
export type {WatchProgress} from './WatchProgressStorage';

