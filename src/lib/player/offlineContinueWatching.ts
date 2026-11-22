import type {RootStackParamList} from '../../App';
import {downloadOutputExists} from '../downloadDestination';
import {sortDownloadedEpisodes} from '../downloadLibrary';
import {hasCachedContentInfo} from '../hooks/useContentInfo';
import {getCompletedDownloadPathSync} from '../hooks/useStream';
import type {ContinueWatchingItem} from '../zustand/continueWatchingStore';
import {
  isSubtitleDownloadItem,
  type DownloadItem,
} from '../zustand/downloadsStore';

type PlayerParams = RootStackParamList['Player'];

const isCompletedVideoDownload = (item: DownloadItem): boolean =>
  item.status === 'completed' &&
  Boolean(item.filePath) &&
  !item.isSubtitle &&
  !isSubtitleDownloadItem(item);

const getSeasonDownloadItems = (
  downloads: Record<string, DownloadItem>,
  target: DownloadItem,
): DownloadItem[] => {
  const siblings = Object.values(downloads).filter(item => {
    if (!isCompletedVideoDownload(item)) {
      return false;
    }
    const sameShow =
      (target.infoUrl && item.infoUrl === target.infoUrl) ||
      ((target.showName || target.title) &&
        (item.showName || item.title) === (target.showName || target.title));
    if (!sameShow) {
      return false;
    }
    if (target.seasonTitle && item.seasonTitle) {
      return item.seasonTitle === target.seasonTitle;
    }
    return true;
  });

  const sorted = sortDownloadedEpisodes(siblings);
  if (!sorted.some(item => item.id === target.id)) {
    return [target, ...sorted];
  }
  return sorted;
};

export const buildOfflinePlayerParamsForDownload = (
  target: DownloadItem,
  downloads: Record<string, DownloadItem>,
  options: {
    alwaysCast?: boolean;
    fallbackTitle?: string;
    fallbackPoster?: string;
    fallbackBackground?: string;
    fallbackProvider?: string;
    fallbackInfoUrl?: string;
    fallbackType?: string;
  } = {},
): PlayerParams => {
  const playableItems = getSeasonDownloadItems(downloads, target);
  const linkIndex = Math.max(
    0,
    playableItems.findIndex(item => item.id === target.id),
  );
  const metadata = playableItems[0] || target;

  return {
    episodeList: playableItems.map(candidate => ({
      id: candidate.id,
      title: candidate.episodeName || candidate.title,
      link: candidate.filePath,
      sourceLink: candidate.sourceLink,
      skip: candidate.skip,
    })),
    linkIndex,
    type:
      target.type ||
      options.fallbackType ||
      (playableItems.length > 1 ? 'series' : 'movie'),
    directUrl: target.filePath,
    primaryTitle:
      target.showName ||
      metadata.showName ||
      options.fallbackTitle ||
      target.title,
    secondaryTitle: target.seasonTitle,
    poster: {
      poster: metadata.poster || target.poster || options.fallbackPoster,
      background:
        metadata.background || target.background || options.fallbackBackground,
    },
    providerValue:
      target.provider ||
      metadata.provider ||
      options.fallbackProvider ||
      'vega',
    infoUrl: target.infoUrl || metadata.infoUrl || options.fallbackInfoUrl,
    alwaysCast: Boolean(options.alwaysCast),
  };
};

export const findCompletedDownloadForInfo = (
  downloads: Record<string, DownloadItem>,
  infoUrl: string,
  providerValue?: string,
): DownloadItem | undefined => {
  if (!infoUrl) return undefined;
  const matching = Object.values(downloads).filter(
    item =>
      isCompletedVideoDownload(item) &&
      item.infoUrl === infoUrl &&
      (!providerValue || !item.provider || item.provider === providerValue),
  );
  return sortDownloadedEpisodes(matching)[0];
};

export const resolveContinueWatchingOfflinePlayback = async (
  item: ContinueWatchingItem,
  downloads: Record<string, DownloadItem>,
  options: {
    alwaysCast?: boolean;
    hasInfoCache?: boolean;
    fileExists?: (filePath: string) => Promise<boolean>;
  } = {},
): Promise<PlayerParams | null> => {
  if (!item || item.providerValue === 'local') {
    return null;
  }

  const infoCached =
    options.hasInfoCache ??
    hasCachedContentInfo(item.infoUrl, item.providerValue);
  if (infoCached) {
    return null;
  }

  const completedPath = getCompletedDownloadPathSync(item.episode, {
    primaryTitle: item.title,
    secondaryTitle: item.seasonTitle,
    infoUrl: item.infoUrl,
  });
  if (!completedPath) {
    return null;
  }

  const checkExists = options.fileExists ?? downloadOutputExists;
  const exists = await checkExists(completedPath).catch(() => false);
  if (!exists) {
    return null;
  }

  const matchedDownload = Object.values(downloads).find(
    candidate =>
      isCompletedVideoDownload(candidate) &&
      candidate.filePath === completedPath,
  );

  if (matchedDownload) {
    return buildOfflinePlayerParamsForDownload(matchedDownload, downloads, {
      alwaysCast: options.alwaysCast,
      fallbackTitle: item.title,
      fallbackPoster: item.poster,
      fallbackBackground: item.background,
      fallbackProvider: item.providerValue,
      fallbackInfoUrl: item.infoUrl,
      fallbackType: item.type,
    });
  }

  return {
    episodeList: [
      {
        id: item.episode.id,
        title: item.episodeTitle || item.episode.title || item.title,
        link: completedPath,
        sourceLink: item.episode.sourceLink || item.episode.link,
        skip: item.episode.skip,
      },
    ],
    linkIndex: 0,
    type: item.type || 'movie',
    directUrl: completedPath,
    primaryTitle: item.title,
    secondaryTitle: item.seasonTitle,
    poster: {
      poster: item.poster,
      background: item.background,
    },
    providerValue: item.providerValue || 'vega',
    infoUrl: item.infoUrl,
    alwaysCast: Boolean(options.alwaysCast),
  };
};
