import type {DownloadItem} from './zustand/downloadsStore';
import {
  extractEpisodeNumberFromName,
  hashDownloadId,
  isSubtitleDownloadItem,
} from './downloadId';

export interface DownloadedMediaGroup {
  id: string;
  title: string;
  poster?: string;
  items: DownloadItem[];
}

const getMediaGroupId = (item: DownloadItem): string =>
  `media:${(item.showName || item.title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

const getLegacyEpisodeNumber = (item: DownloadItem): number => {
  const source = item.episodeName || item.displayFileName || item.title;
  const match = source.match(/(?:episode|ep|e)[\s_.-]*(\d+)/i);
  return match ? Number(match[1]) : 0;
};

const getSeasonNumber = (item: DownloadItem): number => {
  const match = item.seasonTitle?.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

const getEpisodeNumber = (item: DownloadItem): number => {
  const parsedNumber = extractEpisodeNumberFromName(
    item.episodeName,
    item.seasonTitle,
  );
  if (parsedNumber !== undefined) {
    return parsedNumber;
  }
  const idMatch = item.id.match(/_E(\d+)$/);
  if (idMatch) {
    return Number(idMatch[1]);
  }
  const titleNumber = getLegacyEpisodeNumber(item);
  if (titleNumber) {
    return titleNumber;
  }
  const directMatch = item.id.match(/_direct_(\d+)$/);
  return directMatch ? Number(directMatch[1]) + 1 : 0;
};

export const sortDownloadedEpisodes = (items: DownloadItem[]): DownloadItem[] =>
  [...items].sort((a, b) => {
    const seasonDifference = getSeasonNumber(a) - getSeasonNumber(b);
    if (seasonDifference !== 0) {
      return seasonDifference;
    }
    if (a.episodeIndex !== undefined && b.episodeIndex !== undefined) {
      return a.episodeIndex - b.episodeIndex;
    }
    const episodeDifference = getEpisodeNumber(a) - getEpisodeNumber(b);
    return episodeDifference || a.createdAt - b.createdAt;
  });

export const groupCompletedDownloads = (
  items: DownloadItem[],
): DownloadedMediaGroup[] => {
  const groups = new Map<string, DownloadedMediaGroup>();

  items
    .filter(item => !isSubtitleDownloadItem(item))
    .forEach(item => {
    const groupId = getMediaGroupId(item);
    const existing = groups.get(groupId);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groups.set(groupId, {
      id: groupId,
      title: item.showName || item.title,
      poster: item.poster,
      items: [item],
    });
  });

  return [...groups.values()]
    .map(group => ({
      ...group,
      items: sortDownloadedEpisodes(group.items),
    }))
    .sort((a, b) => {
      const aCompleted = Math.max(
        ...a.items.map(item => item.completedAt || 0),
      );
      const bCompleted = Math.max(
        ...b.items.map(item => item.completedAt || 0),
      );
      return bCompleted - aCompleted;
    });
};

export interface FindEpisodeDownloadTarget {
  downloadId: string;
  infoUrl?: string;
  link?: string;
  seasonTitle?: string;
  episodeName?: string;
}

const normalizeEpisodeLabel = (value?: string): string =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const episodeNamesMatch = (
  a?: string,
  b?: string,
  seasonTitle?: string,
): boolean => {
  const normalizedA = normalizeEpisodeLabel(a);
  const normalizedB = normalizeEpisodeLabel(b);
  if (normalizedA && normalizedB && normalizedA === normalizedB) {
    return true;
  }
  const numA = extractEpisodeNumberFromName(a, seasonTitle);
  const numB = extractEpisodeNumberFromName(b, seasonTitle);
  return numA !== undefined && numB !== undefined && numA === numB;
};

export const isConflictingEpisodeDownload = (
  item: DownloadItem,
  target: FindEpisodeDownloadTarget,
): boolean => {
  if (target.infoUrl && item.infoUrl && item.infoUrl !== target.infoUrl) {
    return true;
  }
  if (
    target.seasonTitle &&
    item.seasonTitle &&
    item.seasonTitle !== target.seasonTitle
  ) {
    return true;
  }
  if (target.episodeName && item.episodeName) {
    return !episodeNamesMatch(
      item.episodeName,
      target.episodeName,
      target.seasonTitle || item.seasonTitle,
    );
  }
  if (
    target.link &&
    item.sourceLink &&
    item.sourceLink !== target.link &&
    target.episodeName &&
    !item.episodeName
  ) {
    return true;
  }
  return false;
};

export const findEpisodeDownload = (
  downloads: DownloadItem[],
  target: FindEpisodeDownloadTarget,
): DownloadItem | undefined => {
  const items = downloads.filter(item => !isSubtitleDownloadItem(item));

  if (target.infoUrl && target.link) {
    const linkMatches = items.filter(
      item =>
        item.infoUrl === target.infoUrl && item.sourceLink === target.link,
    );
    if (linkMatches.length > 0) {
      return (
        linkMatches.find(
          item =>
            (!target.seasonTitle || item.seasonTitle === target.seasonTitle) &&
            (!target.episodeName ||
              episodeNamesMatch(
                item.episodeName,
                target.episodeName,
                target.seasonTitle,
              )),
        ) ||
        linkMatches.find(
          item => !target.seasonTitle || item.seasonTitle === target.seasonTitle,
        ) ||
        linkMatches[0]
      );
    }
  }

  if (target.infoUrl && target.seasonTitle && target.episodeName) {
    const normalizedTargetName = normalizeEpisodeLabel(target.episodeName);
    const matchBySeasonEpisode = items.find(
      item =>
        item.infoUrl === target.infoUrl &&
        item.seasonTitle === target.seasonTitle &&
        normalizeEpisodeLabel(item.episodeName) === normalizedTargetName,
    );
    if (matchBySeasonEpisode) {
      return matchBySeasonEpisode;
    }
  }

  if (target.downloadId) {
    const matchById = items.find(
      item =>
        item.id === target.downloadId &&
        !isConflictingEpisodeDownload(item, target),
    );
    if (matchById) {
      return matchById;
    }
  }

  return undefined;
};

export const findEpisodeSubtitleDownloads = (
  downloads: DownloadItem[],
  target: FindEpisodeDownloadTarget & {videoDownloadId?: string},
): DownloadItem[] =>
  downloads.filter(item => {
    if (!isSubtitleDownloadItem(item)) {
      return false;
    }
    if (
      target.infoUrl &&
      target.link &&
      item.infoUrl === target.infoUrl &&
      item.sourceLink === target.link
    ) {
      return true;
    }
    if (
      target.videoDownloadId &&
      item.id.startsWith(`${target.videoDownloadId}_subtitle_`)
    ) {
      return true;
    }
    return Boolean(
      target.downloadId &&
        item.id.startsWith(`${target.downloadId}_subtitle_`) &&
        !isConflictingEpisodeDownload(item, target),
    );
  });

export const resolveEpisodeDownloadId = (
  baseId: string,
  downloads: Record<string, DownloadItem>,
  target: FindEpisodeDownloadTarget,
): string => {
  const existing = downloads[baseId];
  if (!existing || !isConflictingEpisodeDownload(existing, target)) {
    return baseId;
  }
  return `${baseId}_${hashDownloadId(target.link || target.episodeName || baseId)}`;
};
