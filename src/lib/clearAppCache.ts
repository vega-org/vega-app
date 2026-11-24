import * as RNFS from '@dr.pogodin/react-native-fs';
import {cache as imageColorsCache} from 'react-native-image-colors';
import {queryClient} from './client';
import {clearHeroCache} from './hooks/useHomePageData';
import {clearImageAccentCache} from './imageAccent';
import {clearDownloadedVideoThumbnailMemoryCache} from './downloadThumbnailCache';
import {cacheStorage} from './storage/StorageService';
import {torrentManager} from './torrentManager';

// Partial HLS and torrent downloads are staged here and must survive.
// Torrent streams live under `torrents` and are cleaned separately so active
// playback is never deleted mid-stream.
const PRESERVED_CACHE_ENTRIES: Set<string> = new Set([
  'downloads',
  'hls_segments',
  'torrents',
]);

// The cache store also holds what the user watched, not just fetched data.
const PRESERVED_KEY_PREFIXES = [
  'skips_',
  'LastPlayed:',
  'ActiveSeason',
  'EpisodeRange:',
];
const PRESERVED_KEYS = new Set(['lastTextTrack', 'lastAudioTrack']);

const shouldKeepCacheKey = (key: string): boolean =>
  PRESERVED_KEYS.has(key) ||
  PRESERVED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));

const clearCacheStorage = async (): Promise<void> => {
  const kept: Array<[string, string]> = [];
  for (const key of await cacheStorage.getKeys()) {
    const value = cacheStorage.getString(key);
    if (value !== undefined && shouldKeepCacheKey(key)) {
      kept.push([key, value]);
    }
  }
  cacheStorage.clearAll();
  kept.forEach(([key, value]) => cacheStorage.setString(key, value));
};

const clearFilesystemCache = async (): Promise<void> => {
  const entries = await RNFS.readDir(RNFS.CachesDirectoryPath).catch(() => []);
  await Promise.all(
    entries
      .filter(entry => !PRESERVED_CACHE_ENTRIES.has(entry.name))
      .map(entry => RNFS.unlink(entry.path).catch(() => undefined)),
  );
};

const clearTorrentStreamCache = async (): Promise<void> => {
  if (await torrentManager.clearStreamCache()) {
    return;
  }
  const fallbackDirs = [
    RNFS.DocumentDirectoryPath ? `${RNFS.DocumentDirectoryPath}/torrents` : '',
    RNFS.CachesDirectoryPath ? `${RNFS.CachesDirectoryPath}/torrents` : '',
  ].filter(Boolean);
  await Promise.all(
    fallbackDirs.map(async dir => {
      if (RNFS.exists && !(await RNFS.exists(dir).catch(() => false))) {
        return;
      }
      await RNFS.unlink(dir).catch(() => undefined);
    }),
  );
};

export const clearAppCache = async (): Promise<void> => {
  await clearCacheStorage();
  queryClient.clear();
  imageColorsCache.clear();
  clearImageAccentCache();
  clearDownloadedVideoThumbnailMemoryCache();
  clearHeroCache();
  await clearFilesystemCache();
  await clearTorrentStreamCache();
};
