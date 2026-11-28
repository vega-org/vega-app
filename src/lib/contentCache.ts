import type {EpisodeLink, Info} from './providers/types';

export interface StringCacheStore {
  getString?: (key: string) => string | undefined;
  setString?: (key: string, value: string) => void;
}

export const getContentInfoCacheKey = (
  link: string,
  providerValue: string,
): string => `contentInfo:${providerValue}:${link}`;

export const getContentInfoUpdatedAtKey = (
  link: string,
  providerValue: string,
): string => `contentInfo:updatedAt:${providerValue}:${link}`;

export const getEpisodesCacheKey = (
  episodesLink: string,
  providerValue: string,
): string => `episodes:${providerValue}:${episodesLink}`;

export const readCachedContentInfo = (
  storage: StringCacheStore | undefined,
  link: string,
  providerValue: string,
): Info | undefined => {
  if (!storage?.getString || !link || !providerValue) {
    return undefined;
  }
  const cached = storage.getString(getContentInfoCacheKey(link, providerValue));
  if (!cached) {
    return undefined;
  }
  try {
    const info = JSON.parse(cached);
    // Older builds could cache hero metadata here, which has no links.
    return Array.isArray(info?.linkList) ? (info as Info) : undefined;
  } catch {
    return undefined;
  }
};

export const readCachedContentInfoUpdatedAt = (
  storage: StringCacheStore | undefined,
  link: string,
  providerValue: string,
): number => {
  if (!storage?.getString || !link || !providerValue) {
    return 0;
  }
  const raw = storage.getString(
    getContentInfoUpdatedAtKey(link, providerValue),
  );
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const writeCachedContentInfo = (
  storage: StringCacheStore | undefined,
  link: string,
  providerValue: string,
  info: Info,
  updatedAt = Date.now(),
): void => {
  if (
    !storage?.setString ||
    !link ||
    !providerValue ||
    !Array.isArray(info?.linkList)
  ) {
    return;
  }
  storage.setString(
    getContentInfoCacheKey(link, providerValue),
    JSON.stringify(info),
  );
  storage.setString(
    getContentInfoUpdatedAtKey(link, providerValue),
    String(updatedAt),
  );
};

export const invalidateContentInfoTimestamp = (
  storage: StringCacheStore | undefined,
  link: string,
  providerValue: string,
): void => {
  if (!storage?.setString || !link || !providerValue) {
    return;
  }
  storage.setString(getContentInfoUpdatedAtKey(link, providerValue), '0');
};

export const writeCachedEpisodes = (
  storage: StringCacheStore | undefined,
  episodesLink: string | undefined,
  providerValue: string,
  episodes: EpisodeLink[],
): void => {
  if (
    !storage?.setString ||
    !episodesLink ||
    !providerValue ||
    !Array.isArray(episodes) ||
    episodes.length === 0
  ) {
    return;
  }
  storage.setString(
    getEpisodesCacheKey(episodesLink, providerValue),
    JSON.stringify(episodes),
  );
};
