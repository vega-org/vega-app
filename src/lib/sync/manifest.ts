import type {SkipInterval} from '../providers/types';

export const VEGA_SYNC_SCHEMA_VERSION = 1;
export const VEGA_SYNC_DIRECTORY = '.vega-sync';

export type SyncRecordKind =
  | 'download'
  | 'history'
  | 'watchlist'
  | 'collection';

export interface SyncedDownload {
  id: string;
  mediaKey?: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  type: 'movie' | 'series';
  isSubtitle?: boolean;
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  provider?: string;
  infoUrl?: string;
  sourceLink?: string;
  relativePath: string;
  totalBytes: number;
  completedAt: number;
  updatedAt: number;
  skip?: SkipInterval[];
}

export interface SyncedHistoryEpisode {
  id?: string;
  title: string;
  link: string;
  sourceLink?: string;
  description?: string;
  image?: string;
  skip?: SkipInterval[];
}

export interface SyncedHistory {
  id: string;
  title: string;
  poster?: string;
  background?: string;
  provider?: string;
  link: string;
  duration?: number;
  progress?: number;
  isSeries?: boolean;
  lastPlayed?: number;
  currentTime?: number;
  playbackRate?: number;
  episodeTitle?: string;
  /** Season (link group) the episode belongs to. Older versions omit it. */
  seasonTitle?: string;
  episode?: SyncedHistoryEpisode;
  type?: string;
  cachedInfoData?: unknown;
  updatedAt: number;
}

export interface SyncedWatchListItem {
  title: string;
  poster: string;
  link: string;
  provider: string;
  updatedAt: number;
  /** Library category ids. Missing in manifests from older versions. */
  collections?: string[];
}

/** User-made library category. Older versions ignore this. */
export interface SyncedLibraryCollection {
  id: string;
  name: string;
  icon: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SyncTombstone {
  kind: SyncRecordKind;
  id: string;
  mediaKey?: string;
  deletedAt: number;
}

export interface VegaSyncManifest {
  schemaVersion: number;
  deviceId: string;
  revision: number;
  generatedAt: number;
  downloads: Record<string, SyncedDownload>;
  history?: Record<string, SyncedHistory>;
  watchlist?: Record<string, SyncedWatchListItem>;
  collections?: Record<string, SyncedLibraryCollection>;
  tombstones: Record<string, SyncTombstone>;
  /** When watch progress was last cleared on any device. Older versions omit it. */
  progressClearedAt?: number;
}

export interface MergedSyncState {
  downloads: Record<string, SyncedDownload>;
  history: Record<string, SyncedHistory>;
  watchlist: Record<string, SyncedWatchListItem>;
  collections: Record<string, SyncedLibraryCollection>;
  tombstones: Record<string, SyncTombstone>;
  progressClearedAt: number;
}

export const MAX_SYNC_HISTORY_ITEMS = 50;

export const getTombstoneKey = (kind: SyncRecordKind, id: string): string =>
  `${kind}:${id}`;

const normalizeKeyPart = (value?: string): string =>
  (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getEpisodeKey = (item: SyncedDownload): string => {
  const episodeNumber =
    item.id.match(/_E(\d+)$/i)?.[1] ||
    item.episodeName?.match(/(?:episode|ep|e)[\s_.-]*(\d+)/i)?.[1];
  if (episodeNumber) {
    return `i${Math.max(Number(episodeNumber) - 1, 0)}`;
  }
  const directIndex = item.id.match(/_direct_(\d+)$/i)?.[1];
  return directIndex ? `i${Number(directIndex)}` : 'i0';
};

const getSeasonKey = (item: SyncedDownload): string => {
  const normalized = normalizeKeyPart(item.seasonTitle);
  const plainSeason = normalized.match(/^season-?(\d+)$/)?.[1];
  return plainSeason ? String(Number(plainSeason)) : normalized;
};

export const getDownloadMediaKey = (item: SyncedDownload): string => {
  const identity = item.imdbId
    ? normalizeKeyPart(item.imdbId)
    : normalizeKeyPart(item.showName || item.title);
  const baseKey = `${item.type}:${identity}:${getSeasonKey(item)}:${getEpisodeKey(item)}`;
  if (item.isSubtitle || item.id.includes('_subtitle_')) {
    const subPart = item.id.includes('_subtitle_')
      ? item.id.split('_subtitle_')[1]
      : item.title;
    return `${baseKey}:subtitle:${normalizeKeyPart(subPart)}`;
  }
  return baseKey;
};

const isManifest = (value: unknown): value is VegaSyncManifest => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const manifest = value as Partial<VegaSyncManifest>;
  return (
    manifest.schemaVersion === VEGA_SYNC_SCHEMA_VERSION &&
    typeof manifest.deviceId === 'string' &&
    typeof manifest.revision === 'number' &&
    Boolean(manifest.downloads) &&
    Boolean(manifest.tombstones)
  );
};

export const parseSyncManifest = (content: string): VegaSyncManifest | null => {
  const parse = (value: string): VegaSyncManifest | null => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const complete = parse(content);
  if (complete) {
    return complete;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return parse(content.slice(0, index + 1));
      }
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const hasUpdatedAt = (value: unknown): boolean =>
  isRecord(value) && typeof value.updatedAt === 'number';

const isValidDownload = (value: unknown): value is SyncedDownload =>
  hasUpdatedAt(value) && typeof (value as SyncedDownload).id === 'string';

const isValidTombstone = (value: unknown): value is SyncTombstone =>
  isRecord(value) &&
  typeof value.kind === 'string' &&
  typeof value.id === 'string' &&
  typeof value.deletedAt === 'number';

export const mergeSyncManifests = (
  manifests: VegaSyncManifest[],
): MergedSyncState => {
  const downloads: Record<string, SyncedDownload> = {};
  const history: Record<string, SyncedHistory> = {};
  const watchlist: Record<string, SyncedWatchListItem> = {};
  const collections: Record<string, SyncedLibraryCollection> = {};
  const tombstones: Record<string, SyncTombstone> = {};

  for (const manifest of manifests) {
    for (const item of Object.values(manifest.downloads)) {
      if (!isValidDownload(item)) {
        continue;
      }
      const mediaKey = getDownloadMediaKey(item);
      const normalizedItem = {...item, mediaKey};
      if (
        !downloads[mediaKey] ||
        normalizedItem.updatedAt > downloads[mediaKey].updatedAt
      ) {
        downloads[mediaKey] = normalizedItem;
      }
    }
    for (const [link, item] of Object.entries(manifest.watchlist || {})) {
      if (!hasUpdatedAt(item)) {
        continue;
      }
      if (!watchlist[link] || item.updatedAt >= watchlist[link].updatedAt) {
        watchlist[link] = item;
      }
    }
    for (const [id, item] of Object.entries(manifest.collections || {})) {
      if (!hasUpdatedAt(item)) {
        continue;
      }
      if (!collections[id] || item.updatedAt >= collections[id].updatedAt) {
        collections[id] = item;
      }
    }
    for (const [id, item] of Object.entries(manifest.history || {})) {
      if (!hasUpdatedAt(item)) {
        continue;
      }
      const existing = history[id];
      if (!existing) {
        history[id] = item;
      } else if (item.updatedAt >= existing.updatedAt) {
        history[id] = {
          ...existing,
          ...item,
          title: item.title || existing.title,
          poster: item.poster ?? existing.poster,
          background: item.background ?? existing.background,
          provider: item.provider ?? existing.provider,
          link: item.link || existing.link,
          episodeTitle: item.episodeTitle ?? existing.episodeTitle,
          episode: item.episode ?? existing.episode,
          type: item.type ?? existing.type,
          isSeries: item.isSeries ?? existing.isSeries,
          progress: item.progress ?? existing.progress,
          duration: item.duration ?? existing.duration,
          currentTime: item.currentTime ?? existing.currentTime,
        };
      }
    }
    for (const [key, tombstone] of Object.entries(manifest.tombstones)) {
      if (!isValidTombstone(tombstone)) {
        continue;
      }
      if (!tombstones[key] || tombstone.deletedAt > tombstones[key].deletedAt) {
        tombstones[key] = tombstone;
      }
    }
  }

  for (const tombstone of Object.values(tombstones)) {
    if (tombstone.kind === 'download') {
      const itemKey = Object.keys(downloads).find(
        key =>
          downloads[key].id === tombstone.id ||
          key === tombstone.id ||
          key === tombstone.mediaKey,
      );
      const item = itemKey ? downloads[itemKey] : undefined;
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete downloads[itemKey!];
      }
    } else if (tombstone.kind === 'history') {
      const item = history[tombstone.id];
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete history[tombstone.id];
      }
    } else if (tombstone.kind === 'collection') {
      const item = collections[tombstone.id];
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete collections[tombstone.id];
      }
    } else {
      const item = watchlist[tombstone.id];
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete watchlist[tombstone.id];
      }
    }
  }

  const limitedHistory = Object.fromEntries(
    Object.entries(history)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SYNC_HISTORY_ITEMS),
  );

  // The newest clear on any device wins.
  const progressClearedAt = Math.max(
    0,
    ...manifests.map(manifest =>
      Number.isFinite(manifest.progressClearedAt)
        ? (manifest.progressClearedAt as number)
        : 0,
    ),
  );

  return {
    downloads,
    history: limitedHistory,
    watchlist,
    collections,
    tombstones,
    progressClearedAt,
  };
};
