import * as Crypto from 'expo-crypto';
import {NativeModules} from 'react-native';
import {settingsStorage, watchProgressStorage} from '../storage';
import {
  WatchListKeys,
  watchListStorage,
  type LibraryCollection,
  type WatchListItem,
} from '../storage/WatchListStorage';
import {mainStorage} from '../storage/StorageService';
import useDownloadsStore, {type DownloadItem} from '../zustand/downloadsStore';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
  isSubtitleDownloadItem,
} from '../downloadId';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../zustand/continueWatchingStore';
import useWatchListStore from '../zustand/watchListStore';
import {getSafEntryName, isSafDownloadLocation} from '../downloadLocation';
import {
  getTombstoneKey,
  getDownloadMediaKey,
  MAX_SYNC_HISTORY_ITEMS,
  mergeSyncManifests,
  VEGA_SYNC_SCHEMA_VERSION,
  type SyncTombstone,
  type SyncedDownload,
  type SyncedHistory,
  type SyncedLibraryCollection,
  type SyncedWatchListItem,
  type VegaSyncManifest,
} from './manifest';
import {
  readMobileSyncManifests,
  resolveMobileSyncFileWithLegacyFallback,
  writeMobileSyncManifest,
} from './mobileManifestStorage';

const DEVICE_ID_KEY = 'vega-sync-device-id';
const REVISION_KEY = 'vega-sync-revision';
const TOMBSTONES_KEY = 'vega-sync-tombstones';
const HISTORY_KEY = 'vega-sync-history';
const PROGRESS_CLEARED_KEY = 'vega-sync-progress-cleared-at';
const PUBLISH_DELAY_MS = 1000;

const getProgressClearedAt = () =>
  mainStorage.getNumber(PROGRESS_CLEARED_KEY) || 0;

const isSyncActive = () =>
  typeof settingsStorage?.isSyncEnabled === 'function'
    ? settingsStorage.isSyncEnabled()
    : true;

let initialized = false;
let applyingRemoteState = false;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let syncRequest: Promise<void> | undefined;
let previousDownloads: Record<string, DownloadItem> = {};
let previousHistory: ContinueWatchingItem[] = [];
let previousWatchList: WatchListItem[] = [];
let previousCollections: LibraryCollection[] = [];

const DEVICE_OWNER_KEY = 'vega-sync-device-owner';
const getDeviceId = () => {
  const owner = NativeModules.VegaSyncStorage?.deviceId as string | undefined;
  const existing = mainStorage.getString(DEVICE_ID_KEY);
  const previousOwner = mainStorage.getString(DEVICE_OWNER_KEY);
  // Bind existing installations without renaming their file on this update.
  // Restoring a bound backup to another phone gets a separate identity.
  if (existing && (!owner || !previousOwner || owner === previousOwner)) {
    if (owner) mainStorage.setString(DEVICE_OWNER_KEY, owner);
    return existing;
  }
  const created = owner || Crypto.randomUUID();
  mainStorage.setString(DEVICE_ID_KEY, created);
  if (owner) mainStorage.setString(DEVICE_OWNER_KEY, owner);
  return created;
};

const getTombstones = (): Record<string, SyncTombstone> =>
  mainStorage.getObject<Record<string, SyncTombstone>>(TOMBSTONES_KEY) || {};

const saveTombstones = (tombstones: Record<string, SyncTombstone>) =>
  mainStorage.setObject(TOMBSTONES_KEY, tombstones);

const addTombstone = (
  kind: SyncTombstone['kind'],
  id: string,
  mediaKey?: string,
) => {
  const tombstones = getTombstones();
  const key = getTombstoneKey(kind, id);
  tombstones[key] = {kind, id, mediaKey, deletedAt: Date.now()};
  saveTombstones(tombstones);
};

const getRelativePath = (item: DownloadItem) => {
  const dirs =
    item.showName || item.seasonTitle
      ? [
          createDownloadDirectoryName(item.showName || item.title),
          ...(item.seasonTitle
            ? [
                createDownloadSeasonDirectoryName(item.seasonTitle)!,
              ].filter(Boolean)
            : []),
        ]
      : [];
  const fileName =
    getSafEntryName(item.finalDocumentUri || item.filePath) ||
    item.displayFileName ||
    item.id;
  return [...dirs, fileName].join('/');
};

const toSyncedDownload = (item: DownloadItem): SyncedDownload => {
  const isSubtitle = Boolean(
    item.isSubtitle ||
      item.id.includes('_subtitle_') ||
      isSubtitleDownloadItem(item),
  );
  const download: SyncedDownload = {
    id: item.id,
    title: item.title,
    showName: item.showName,
    episodeName: item.episodeName,
    seasonTitle: item.seasonTitle,
    type: item.type,
    isSubtitle,
    imdbId: item.imdbId,
    poster: item.poster,
    background: item.background,
    synopsis: item.synopsis,
    provider: item.provider,
    infoUrl: item.infoUrl,
    sourceLink: item.sourceLink,
    relativePath: getRelativePath(item),
    totalBytes: item.totalBytes,
    completedAt: item.completedAt || item.updatedAt,
    updatedAt: item.updatedAt,
    skip: item.skip,
  };
  download.mediaKey = getDownloadMediaKey(download);
  return download;
};

// Download items are immutable store entries, so a key computed once per item
// object stays valid. Sync compares every remote download against every local
// one; without the cache that rebuilt the synced form for each pair.
const downloadMediaKeyCache = new WeakMap<DownloadItem, string>();

const getLocalDownloadMediaKey = (item: DownloadItem): string => {
  let key = downloadMediaKeyCache.get(item);
  if (key === undefined) {
    key = getDownloadMediaKey(toSyncedDownload(item));
    downloadMediaKeyCache.set(item, key);
  }
  return key;
};

// The manifest lists completed downloads only. Progress updates of running
// downloads change nothing in it, so they need no publish.
const hasCompletedDownloadChanges = (
  previous: Record<string, DownloadItem>,
  next: Record<string, DownloadItem>,
): boolean => {
  for (const id in next) {
    const nextItem = next[id];
    const previousItem = previous[id];
    if (
      nextItem !== previousItem &&
      (nextItem.status === 'completed' || previousItem?.status === 'completed')
    ) {
      return true;
    }
  }
  for (const id in previous) {
    if (previous[id].status === 'completed' && !next[id]) {
      return true;
    }
  }
  return false;
};

const toSyncedWatchListItem = (item: WatchListItem): SyncedWatchListItem => ({
  ...item,
  updatedAt: item.updatedAt || 0,
});

const getHistoryId = (item: ContinueWatchingItem): string =>
  item.episode.sourceLink || item.episode.id || item.episode.link || item.id;

const toSyncedHistory = (item: ContinueWatchingItem): SyncedHistory => ({
  id: getHistoryId(item),
  title: item.title,
  poster: item.poster,
  background: item.background,
  provider: item.providerValue,
  link: item.infoUrl,
  duration: item.duration,
  progress: item.position,
  currentTime: item.position,
  isSeries: item.type === 'series',
  lastPlayed: item.updatedAt,
  episodeTitle: item.episodeTitle || item.episode.title,
  seasonTitle: item.seasonTitle,
  episode: item.episode,
  type: item.type,
  updatedAt: item.updatedAt,
});

const getLocalHistory = (): Record<string, SyncedHistory> =>
  mainStorage.getObject<Record<string, SyncedHistory>>(HISTORY_KEY) || {};

const saveLocalHistory = (history: Record<string, SyncedHistory>) => {
  const limited = Object.fromEntries(
    Object.entries(history)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SYNC_HISTORY_ITEMS),
  );
  mainStorage.setObject(HISTORY_KEY, limited);
  return limited;
};

const mergeContinueWatchingIntoHistory = (items: ContinueWatchingItem[]) => {
  const history = getLocalHistory();
  items.forEach(item => {
    const synced = toSyncedHistory(item);
    const existing = history[synced.id];
    if (!existing || synced.updatedAt >= existing.updatedAt) {
      history[synced.id] = synced;
    }
  });
  return saveLocalHistory(history);
};

const buildManifest = (): VegaSyncManifest => {
  const revision = (mainStorage.getNumber(REVISION_KEY) || 0) + 1;
  mainStorage.setNumber(REVISION_KEY, revision);
  const downloads = Object.fromEntries(
    Object.values(useDownloadsStore.getState().downloads)
      .filter(item => item.status === 'completed')
      .map(item => [item.id, toSyncedDownload(item)]),
  );
  const watchlist = Object.fromEntries(
    watchListStorage
      .getWatchList()
      .map(item => [item.link, toSyncedWatchListItem(item)]),
  );
  const collections = Object.fromEntries(
    watchListStorage
      .getCollections()
      .map(collection => [collection.id, collection]),
  );
  const history = mergeContinueWatchingIntoHistory(
    useContinueWatchingStore.getState().items,
  );
  return {
    schemaVersion: VEGA_SYNC_SCHEMA_VERSION,
    deviceId: getDeviceId(),
    revision,
    generatedAt: Date.now(),
    downloads,
    history,
    watchlist,
    collections,
    tombstones: getTombstones(),
    progressClearedAt: getProgressClearedAt(),
  };
};

/**
 * Clears watch progress here and, through the published clear time, on every
 * synced device. History recorded before the clear no longer restores
 * progress; Continue watching is left as it is.
 */
export const clearSyncedWatchProgress = () => {
  const clearedAt = Date.now();
  mainStorage.setNumber(PROGRESS_CLEARED_KEY, clearedAt);
  watchProgressStorage.clearAllProgress();
  if (isSyncActive()) {
    schedulePublish();
  }
};

/** Applies a newer clear made on another device. */
const applyRemoteProgressClear = (clearedAt: number) => {
  if (clearedAt > getProgressClearedAt()) {
    mainStorage.setNumber(PROGRESS_CLEARED_KEY, clearedAt);
    // Progress has no timestamps, so a newer remote clear removes it all.
    watchProgressStorage.clearAllProgress();
  }
};

const applyRemoteHistory = (history: Record<string, SyncedHistory>) => {
  const limitedHistory = saveLocalHistory(history);
  const progressClearedAt = getProgressClearedAt();
  const latestByInfoUrl = new Map<string, SyncedHistory>();
  Object.values(limitedHistory).forEach(item => {
    const episode = item.episode;
    const position = item.progress ?? item.currentTime ?? 0;
    const duration = item.duration ?? 0;
    if (episode?.link && duration > 0 && item.updatedAt > progressClearedAt) {
      // Desktop plays downloads from a file path; sourceLink is the provider
      // link the episode list here uses.
      [episode.link, episode.sourceLink]
        .filter((key): key is string => Boolean(key))
        .forEach(key =>
          watchProgressStorage?.setProgress?.(key, position, duration),
        );
    }
    // Mark watched/unwatched saves a 1/1 or 0/1 entry. It sets episode
    // progress only and is not playback, so it must not add a show here.
    if (!item.link || !item.provider || duration === 1) {
      return;
    }
    const existing = latestByInfoUrl.get(item.link);
    if (!existing || item.updatedAt > existing.updatedAt) {
      latestByInfoUrl.set(item.link, item);
    }
  });

  const currentItems = useContinueWatchingStore.getState().items;
  const itemsById = new Map(currentItems.map(item => [item.id, item]));
  [...latestByInfoUrl.values()]
    .map((item): ContinueWatchingItem => {
      const episode = item.episode || {
        id: item.id,
        title: item.episodeTitle || item.title,
        link: item.id,
        sourceLink: item.id,
      };
      const position = item.progress ?? item.currentTime ?? 0;
      const duration = item.duration ?? 0;
      return {
        id: item.link,
        title: item.title,
        episodeTitle:
          item.episodeTitle ||
          (episode.title !== item.title ? episode.title : undefined),
        seasonTitle: item.seasonTitle,
        episode,
        type: item.type || (item.isSeries ? 'series' : 'movie'),
        poster: item.poster,
        background: item.background,
        providerValue: item.provider!,
        infoUrl: item.link,
        position,
        duration,
        updatedAt: item.updatedAt,
      };
    })
    .forEach(item => {
      const existing = itemsById.get(item.id);
      if (!existing || item.updatedAt > existing.updatedAt) {
        itemsById.set(item.id, item);
      }
    });
  // Synced history holds only the latest 50 episodes. Merge it into the list
  // instead of replacing it, so older shows are not dropped. Removed shows
  // were already filtered out by their tombstones.
  const items = [...itemsById.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);

  // Periodic sync usually finds nothing new. Skip the store update then, so
  // screens do not re-render and the store is not persisted again.
  if (JSON.stringify(items) !== JSON.stringify(currentItems)) {
    useContinueWatchingStore.setState({items});
  }
};

// Keep one device file across updates and folder-sync rollbacks. Revision changes
// are normal when Syncthing restores an older snapshot, not proof of a new device.
let publishQueue: Promise<void> = Promise.resolve();
export const publishSyncManifest = (): Promise<void> => {
  if (!isSyncActive()) {
    return Promise.resolve();
  }
  const publish = publishQueue.then(async () => {
    if (!isSyncActive()) return;
    const location = settingsStorage.getDownloadLocationConfig();
    if (!location || !isSafDownloadLocation(location)) return;
    await writeMobileSyncManifest(location, buildManifest());
  });
  publishQueue = publish.catch(() => undefined);
  return publish;
};

const schedulePublish = () => {
  if (!isSyncActive()) {
    return;
  }
  if (applyingRemoteState || publishTimer) {
    return;
  }
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    publishSyncManifest().catch(error =>
      console.warn('[VegaSync] Failed to publish manifest:', error),
    );
  }, PUBLISH_DELAY_MS);
};

export const setSyncedEpisodeProgress = ({
  episode,
  title,
  poster,
  background,
  provider,
  infoUrl,
  type,
  position,
  duration,
  seasonTitle,
}: {
  episode: ContinueWatchingItem['episode'];
  title: string;
  poster?: string;
  background?: string;
  provider: string;
  infoUrl: string;
  type: string;
  position: number;
  duration: number;
  seasonTitle?: string;
}) => {
  const id = episode.sourceLink || episode.id || episode.link;
  if (!id) {
    return;
  }
  const updatedAt = Date.now();
  const history = getLocalHistory();
  history[id] = {
    id,
    title,
    poster,
    background,
    provider,
    link: infoUrl,
    duration,
    progress: position,
    currentTime: position,
    isSeries: type === 'series',
    lastPlayed: updatedAt,
    episodeTitle: episode.title,
    seasonTitle,
    episode,
    type,
    updatedAt,
  };
  saveLocalHistory(history);
  watchProgressStorage?.setProgress?.(episode.link, position, duration);
  if (isSyncActive()) {
    schedulePublish();
  }
};

const findLocalDownloads = (item: SyncedDownload) => {
  const store = useDownloadsStore.getState();
  const isItemSubtitle = Boolean(
    item.isSubtitle || item.id.includes('_subtitle_'),
  );
  const equivalentEntries = Object.entries(store.downloads).filter(
    ([, candidate]) =>
      candidate.status === 'completed' &&
      Boolean(
        candidate.isSubtitle ||
          candidate.id.includes('_subtitle_') ||
          isSubtitleDownloadItem(candidate),
      ) === isItemSubtitle &&
      getLocalDownloadMediaKey(candidate) === item.mediaKey,
  );
  const existing = equivalentEntries
    .map(([, candidate]) => candidate)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const isLocalNewer =
    existing?.status === 'completed' && existing.updatedAt >= item.updatedAt;
  return {store, isItemSubtitle, equivalentEntries, existing, isLocalNewer};
};

// Finds the files of remote downloads. This is the slow SAF part, so it runs
// before any store is touched and local edits made meanwhile stay intact.
const resolveRemoteDownloadPaths = async (
  downloads: Record<string, SyncedDownload>,
): Promise<Map<string, string | null>> => {
  const paths = new Map<string, string | null>();
  const location = settingsStorage.getDownloadLocationConfig();
  if (!location || !isSafDownloadLocation(location)) {
    return paths;
  }
  for (const item of Object.values(downloads)) {
    if (paths.has(item.relativePath) || findLocalDownloads(item).isLocalNewer) {
      continue;
    }
    paths.set(
      item.relativePath,
      await resolveMobileSyncFileWithLegacyFallback(
        location,
        item.relativePath,
      ),
    );
  }
  return paths;
};

const applyRemoteDownloads = (
  downloads: Record<string, SyncedDownload>,
  filePaths: Map<string, string | null>,
) => {
  const location = settingsStorage.getDownloadLocationConfig();
  if (!location || !isSafDownloadLocation(location)) {
    return;
  }
  for (const item of Object.values(downloads)) {
    const {store, isItemSubtitle, equivalentEntries, existing, isLocalNewer} =
      findLocalDownloads(item);
    if (isLocalNewer) {
      equivalentEntries
        .filter(([id]) => id !== existing.id)
        .forEach(([id]) => store.removeDownload(id));
      continue;
    }
    // A path missing here was not resolved yet; the next sync picks it up.
    const filePath = filePaths.get(item.relativePath);
    if (!filePath) {
      continue;
    }
    store.enqueueDownload({
      ...item,
      isSubtitle: isItemSubtitle,
      url: '',
      filePath,
      finalDocumentUri: filePath,
      displayFileName: item.relativePath.split('/').pop(),
      status: 'completed',
      sourceType: 'http',
      isTorrent: false,
      downloadedBytes: item.totalBytes,
      canPause: false,
      canResume: false,
      createdAt: item.completedAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      downloadLocation: location,
    });
    equivalentEntries
      .filter(([id]) => id !== item.id)
      .forEach(([id]) => store.removeDownload(id));
  }
};

const applyRemoteWatchList = (
  watchlist: Record<string, SyncedWatchListItem>,
) => {
  const items = Object.values(watchlist).sort(
    (a, b) => a.updatedAt - b.updatedAt,
  );
  // Write and notify only on a real change; periodic sync usually has none.
  const serialized = JSON.stringify(items);
  if (
    JSON.stringify(mainStorage.getArray(WatchListKeys.WATCH_LIST) || []) !==
    serialized
  ) {
    mainStorage.setArray(WatchListKeys.WATCH_LIST, items);
  }
  if (JSON.stringify(useWatchListStore.getState().watchList) !== serialized) {
    useWatchListStore.setState({watchList: items});
  }
};

const applyRemoteCollections = (
  collections: Record<string, SyncedLibraryCollection>,
) => {
  const items = Object.values(collections).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const serialized = JSON.stringify(items);
  if (JSON.stringify(watchListStorage.getCollections()) !== serialized) {
    watchListStorage.saveCollections(items);
  }
  if (JSON.stringify(useWatchListStore.getState().collections) !== serialized) {
    useWatchListStore.setState({collections: items});
  }
};

const applyTombstones = (tombstones: Record<string, SyncTombstone>) => {
  const store = useDownloadsStore.getState();
  const currentHistory = useContinueWatchingStore.getState().items;
  let history = currentHistory;
  const localHistory = getLocalHistory();
  for (const tombstone of Object.values(tombstones)) {
    if (tombstone.kind === 'download') {
      for (const item of Object.values(store.downloads)) {
        const isItemSub = Boolean(
          item.isSubtitle ||
            item.id.includes('_subtitle_') ||
            isSubtitleDownloadItem(item),
        );
        const matches =
          item.id === tombstone.id ||
          (tombstone.mediaKey &&
            item.status === 'completed' &&
            Boolean(tombstone.mediaKey.includes(':subtitle:')) === isItemSub &&
            getLocalDownloadMediaKey(item) === tombstone.mediaKey);
        if (matches && tombstone.deletedAt >= item.updatedAt) {
          store.removeDownload(item.id);
        }
      }
    } else if (tombstone.kind === 'history') {
      const syncedItem = localHistory[tombstone.id];
      if (syncedItem && tombstone.deletedAt >= syncedItem.updatedAt) {
        delete localHistory[tombstone.id];
      }
      history = history.filter(
        item =>
          getHistoryId(item) !== tombstone.id ||
          item.updatedAt > tombstone.deletedAt,
      );
    }
  }
  saveLocalHistory(localHistory);
  // The filter only removes items, so an unchanged length means no change.
  if (history.length !== currentHistory.length) {
    useContinueWatchingStore.setState({items: history});
  }
};

const runSharedFolderSync = async (): Promise<void> => {
  if (!isSyncActive()) {
    return;
  }
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = undefined;
  }
  const location = settingsStorage.getDownloadLocationConfig();
  if (!location || !isSafDownloadLocation(location)) {
    return;
  }
  const manifests = await readMobileSyncManifests(location);
  const filePaths = await resolveRemoteDownloadPaths(
    mergeSyncManifests(manifests).downloads,
  );
  // Snapshot local state only after all awaits, so edits made while the
  // folder was read are merged instead of overwritten.
  const localManifest = buildManifest();
  const merged = mergeSyncManifests([...manifests, localManifest]);
  applyingRemoteState = true;
  try {
    saveTombstones(merged.tombstones);
    applyTombstones(merged.tombstones);
    applyRemoteDownloads(merged.downloads, filePaths);
    applyRemoteProgressClear(merged.progressClearedAt);
    applyRemoteHistory(merged.history);
    applyRemoteCollections(merged.collections);
    applyRemoteWatchList(merged.watchlist);
  } finally {
    applyingRemoteState = false;
  }
  previousDownloads = useDownloadsStore.getState().downloads;
  previousHistory = useContinueWatchingStore.getState().items;
  previousWatchList = watchListStorage.getWatchList();
  previousCollections = watchListStorage.getCollections();
  await publishSyncManifest();
};

export const syncFromSharedFolder = (): Promise<void> => {
  if (!isSyncActive()) {
    return Promise.resolve();
  }
  if (!syncRequest) {
    syncRequest = runSharedFolderSync().finally(() => {
      syncRequest = undefined;
    });
  }
  return syncRequest;
};

export const initializeSyncService = async (): Promise<void> => {
  if (!initialized) {
    initialized = true;
    previousDownloads = useDownloadsStore.getState().downloads;
    previousHistory = useContinueWatchingStore.getState().items;
    mergeContinueWatchingIntoHistory(previousHistory);
    previousWatchList = watchListStorage.getWatchList();
    previousCollections = watchListStorage.getCollections();
    useDownloadsStore.subscribe(state => {
      if (applyingRemoteState) {
        previousDownloads = state.downloads;
        return;
      }
      for (const [id, item] of Object.entries(previousDownloads)) {
        if (item.status === 'completed' && !state.downloads[id]) {
          addTombstone(
            'download',
            id,
            getLocalDownloadMediaKey(item),
          );
        }
      }
      const shouldPublish = hasCompletedDownloadChanges(
        previousDownloads,
        state.downloads,
      );
      previousDownloads = state.downloads;
      if (shouldPublish && isSyncActive()) {
        schedulePublish();
      }
    });
    useContinueWatchingStore.subscribe(state => {
      if (applyingRemoteState) {
        previousHistory = state.items;
        return;
      }
      mergeContinueWatchingIntoHistory(state.items);
      const currentContentIds = new Set(state.items.map(item => item.id));
      const previousContentIds = new Set(previousHistory.map(item => item.id));
      const trimmedAtCapacity =
        previousHistory.length >= 30 &&
        state.items.length >= 30 &&
        state.items.some(item => !previousContentIds.has(item.id));
      for (const item of previousHistory) {
        if (!currentContentIds.has(item.id) && !trimmedAtCapacity) {
          const history = getLocalHistory();
          for (const [id, historyItem] of Object.entries(history)) {
            if (historyItem.link === item.infoUrl) {
              delete history[id];
              addTombstone('history', id);
            }
          }
          saveLocalHistory(history);
        }
      }
      previousHistory = state.items;
      if (isSyncActive()) {
        schedulePublish();
      }
    });
    useWatchListStore.subscribe(state => {
      if (applyingRemoteState) {
        previousWatchList = watchListStorage.getWatchList();
        previousCollections = state.collections;
        return;
      }
      const currentLinks = new Set(state.watchList.map(item => item.link));
      for (const item of previousWatchList) {
        if (!currentLinks.has(item.link)) {
          addTombstone('watchlist', item.link);
        }
      }
      const currentCollectionIds = new Set(
        state.collections.map(collection => collection.id),
      );
      for (const collection of previousCollections) {
        if (!currentCollectionIds.has(collection.id)) {
          addTombstone('collection', collection.id);
        }
      }
      previousWatchList = watchListStorage.getWatchList();
      previousCollections = state.collections;
      if (isSyncActive()) {
        schedulePublish();
      }
    });
  }
  if (isSyncActive()) {
    await syncFromSharedFolder();
  }
};
