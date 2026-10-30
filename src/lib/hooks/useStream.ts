import {useSavedSubtitles} from './useSavedSubtitles';
import {savedSubtitleTrack, subtitleVideoKey} from '../subtitles/savedSubtitles';
import {deduplicateVideoTracks} from '../player/playbackQuality';
import {externalVideoStream} from '../services/videoIntent';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ToastAndroid } from 'react-native';
import { providerManager } from '../services/ProviderManager';
import { settingsStorage } from '../storage';
import { ifExists } from '../file/ifExists';
import { Stream } from '../providers/types';
import { getEpisodeIdentity } from '../utils/episodeIdentity';
import useDownloadsStore, {
  isSubtitleDownloadItem,
} from '../zustand/downloadsStore';
import { TextTrackType } from 'react-native-video';
import { downloadOutputExists } from '../downloadDestination';
import {guardWafPrompts} from '../services/wafSession';

interface UseStreamOptions {
  activeEpisode: any;
  routeParams: any;
  provider: string;
  enabled?: boolean;
  localPlaybackReady?: boolean;
}

export const isLocalPath = (path?: string): boolean => {
  if (!path || typeof path !== 'string') return false;
  return (
    path.startsWith('content://') ||
    path.startsWith('file://') ||
    path.startsWith('/')
  );
};

export const findDownloadedFileForMedia = async (
  activeEpisode: any,
  routeParams: any,
): Promise<string | null> => {
  if (!activeEpisode) return null;

  // 1. Direct local file path in activeEpisode.link
  if (isLocalPath(activeEpisode.link)) {
    if (await downloadOutputExists(activeEpisode.link)) {
      return activeEpisode.link;
    }
  }

  // 2. Direct local file path in activeEpisode.filePath
  if (isLocalPath(activeEpisode.filePath)) {
    if (await downloadOutputExists(activeEpisode.filePath)) {
      return activeEpisode.filePath;
    }
  }

  // 3. directUrl passed in routeParams when activeEpisode matches initial selection or there is only one episode
  if (routeParams?.directUrl && isLocalPath(routeParams.directUrl)) {
    const isSingleEpisode =
      !routeParams.episodeList || routeParams.episodeList.length <= 1;
    const initialEpisode =
      typeof routeParams.linkIndex === 'number' &&
      routeParams.episodeList?.[routeParams.linkIndex];
    const isInitialEpisode =
      initialEpisode &&
      ((initialEpisode.id &&
        activeEpisode.id &&
        initialEpisode.id === activeEpisode.id) ||
        (initialEpisode.link &&
          activeEpisode.link &&
          initialEpisode.link === activeEpisode.link) ||
        (initialEpisode.sourceLink &&
          activeEpisode.sourceLink &&
          initialEpisode.sourceLink === activeEpisode.sourceLink) ||
        initialEpisode.title === activeEpisode.title);

    if (
      isSingleEpisode ||
      isInitialEpisode ||
      activeEpisode.link === routeParams.directUrl
    ) {
      if (await downloadOutputExists(routeParams.directUrl)) {
        return routeParams.directUrl;
      }
    }
  }

  // 4. Match against completed records in downloadsStore
  const allDownloads = Object.values(useDownloadsStore.getState().downloads);
  const completedDownloads = allDownloads.filter(
    item =>
      item.status === 'completed' &&
      Boolean(item.filePath) &&
      !item.isSubtitle &&
      !isSubtitleDownloadItem(item),
  );

  const episodeId = activeEpisode.id;
  const episodeSourceLink = activeEpisode.sourceLink || activeEpisode.link;
  const episodeTitle = activeEpisode.title || activeEpisode.episodeName;
  const primaryTitle = routeParams?.primaryTitle || routeParams?.title;
  const secondaryTitle =
    routeParams?.secondaryTitle || routeParams?.seasonTitle;
  const infoUrl = routeParams?.infoUrl || routeParams?.link;

  for (const d of completedDownloads) {
    // A) ID match
    if (episodeId && (d.id === episodeId || d.id.includes(episodeId))) {
      if (await downloadOutputExists(d.filePath)) {
        return d.filePath;
      }
    }

    // B) Source link match
    if (
      episodeSourceLink &&
      (d.sourceLink === episodeSourceLink ||
        d.url === episodeSourceLink ||
        d.filePath === episodeSourceLink)
    ) {
      if (await downloadOutputExists(d.filePath)) {
        return d.filePath;
      }
    }

    // C) Media title + Season + Episode title match
    const showMatch =
      (infoUrl && d.infoUrl === infoUrl) ||
      (primaryTitle &&
        (d.showName === primaryTitle ||
          d.title === primaryTitle ||
          d.title?.startsWith(primaryTitle)));

    if (showMatch) {
      const seasonMatch =
        !secondaryTitle ||
        !d.seasonTitle ||
        d.seasonTitle === secondaryTitle ||
        secondaryTitle.toLowerCase().includes(d.seasonTitle.toLowerCase()) ||
        d.seasonTitle.toLowerCase().includes(secondaryTitle.toLowerCase());

      const episodeMatch =
        episodeTitle &&
        (d.episodeName === episodeTitle ||
          d.title === episodeTitle ||
          d.title?.includes(episodeTitle) ||
          d.episodeName?.includes(episodeTitle) ||
          episodeTitle.includes(d.episodeName || '___never___'));

      if (seasonMatch && episodeMatch) {
        if (await downloadOutputExists(d.filePath)) {
          return d.filePath;
        }
      }
    }
  }

  // 5. Legacy sanitized local file
  if (primaryTitle) {
    const file = (
      primaryTitle +
      (secondaryTitle || '') +
      (episodeTitle || '')
    ).replaceAll(/[^a-zA-Z0-9]/g, '_');

    const exists = await ifExists(file);
    if (exists) {
      return exists;
    }
  }

  return null;
};

export const getDownloadedSubtitlesForMedia = (
  activeEpisode: any,
  routeParams: any,
) => {
  const allDownloads = Object.values(useDownloadsStore.getState().downloads);

  const downloadedSubs = allDownloads.filter(item => {
    if (item.status !== 'completed' || !item.filePath) {
      return false;
    }
    const isSub =
      item.isSubtitle ||
      isSubtitleDownloadItem(item) ||
      item.displayFileName?.endsWith('.vtt') ||
      item.displayFileName?.endsWith('.srt') ||
      item.filePath?.endsWith('.vtt') ||
      item.filePath?.endsWith('.srt');

    if (!isSub) {
      return false;
    }

    const episodeSourceLink = activeEpisode?.sourceLink || activeEpisode?.link;
    if (episodeSourceLink && item.sourceLink === episodeSourceLink) {
      return true;
    }

    const infoUrl = routeParams?.infoUrl || routeParams?.link;
    if (infoUrl && item.infoUrl === infoUrl) {
      if (
        !activeEpisode?.title ||
        item.episodeName === activeEpisode.title ||
        item.title?.includes(activeEpisode.title)
      ) {
        return true;
      }
    }

    const primaryTitle = routeParams?.primaryTitle || routeParams?.title;
    if (
      primaryTitle &&
      (item.showName === primaryTitle || item.title?.startsWith(primaryTitle))
    ) {
      if (
        !activeEpisode?.title ||
        item.episodeName === activeEpisode.title ||
        item.title?.includes(activeEpisode.title)
      ) {
        return true;
      }
    }

    if (routeParams?.directUrl) {
      const videoBase = routeParams.directUrl.substring(
        0,
        routeParams.directUrl.lastIndexOf('.'),
      );
      if (videoBase && item.filePath.startsWith(videoBase)) {
        return true;
      }
    }

    return false;
  });

  return downloadedSubs.map(sub => {
    const isVtt =
      sub.videoType === 'vtt' ||
      sub.filePath?.endsWith('.vtt') ||
      sub.displayFileName?.endsWith('.vtt');
    const uri =
      sub.filePath.startsWith('file://') ||
        sub.filePath.startsWith('content://')
        ? sub.filePath
        : `file://${sub.filePath}`;

    let title = sub.episodeName || sub.title;
    let language = 'en';
    const match =
      sub.title.match(/subtitle\s+([a-zA-Z]+)/i) ||
      sub.id.match(/_subtitle_(.+)$/);
    if (match) {
      title = match[1];
      language = match[1];
    }

    return {
      type: isVtt ? TextTrackType.VTT : TextTrackType.SUBRIP,
      language,
      title: `${title} (Downloaded)`,
      uri,
    };
  });
};

export const getCompletedDownloadPathSync = (
  episode: any,
  params: any,
): string | null => {
  if (!episode) return null;
  if (isLocalPath(episode.link)) return episode.link;
  if (isLocalPath(episode.filePath)) return episode.filePath;
  if (params?.directUrl && isLocalPath(params.directUrl)) {
    const isSingleEpisode =
      !params.episodeList || params.episodeList.length <= 1;
    const initialEpisode =
      typeof params.linkIndex === 'number' &&
      params.episodeList?.[params.linkIndex];
    const isInitialEpisode =
      initialEpisode &&
      ((initialEpisode.id &&
        episode.id &&
        initialEpisode.id === episode.id) ||
        (initialEpisode.link &&
          episode.link &&
          initialEpisode.link === episode.link) ||
        (initialEpisode.sourceLink &&
          episode.sourceLink &&
          initialEpisode.sourceLink === episode.sourceLink) ||
        initialEpisode.title === episode.title);
    if (
      isSingleEpisode ||
      isInitialEpisode ||
      episode.link === params.directUrl
    ) {
      return params.directUrl;
    }
  }
  const allDownloads = Object.values(useDownloadsStore.getState().downloads);
  const completed = allDownloads.find(
    d =>
      d.status === 'completed' &&
      Boolean(d.filePath) &&
      !d.isSubtitle &&
      !isSubtitleDownloadItem(d) &&
      ((episode.id && (d.id === episode.id || d.id.includes(episode.id))) ||
        (episode.link &&
          (d.sourceLink === episode.link ||
            d.url === episode.link ||
            d.filePath === episode.link)) ||
        (episode.sourceLink &&
          (d.sourceLink === episode.sourceLink ||
            d.url === episode.sourceLink ||
            d.filePath === episode.sourceLink))),
  );
  if (completed?.filePath) {
    return completed.filePath;
  }

  // Fallback: title + season + episode matching
  const episodeTitle = episode.title || episode.episodeName;
  const primaryTitle = params?.primaryTitle || params?.title;
  const secondaryTitle = params?.secondaryTitle || params?.seasonTitle;
  const infoUrl = params?.infoUrl || params?.link;

  const titleMatched = allDownloads.find(d => {
    if (
      d.status !== 'completed' ||
      !d.filePath ||
      d.isSubtitle ||
      isSubtitleDownloadItem(d)
    ) {
      return false;
    }
    const showMatch =
      (infoUrl && d.infoUrl === infoUrl) ||
      (primaryTitle &&
        (d.showName === primaryTitle ||
          d.title === primaryTitle ||
          d.title?.startsWith(primaryTitle)));

    if (!showMatch) {
      return false;
    }

    const seasonMatch =
      !secondaryTitle ||
      !d.seasonTitle ||
      d.seasonTitle === secondaryTitle ||
      secondaryTitle.toLowerCase().includes(d.seasonTitle.toLowerCase()) ||
      d.seasonTitle.toLowerCase().includes(secondaryTitle.toLowerCase());

    const episodeMatch =
      episodeTitle &&
      (d.episodeName === episodeTitle ||
        d.title === episodeTitle ||
        d.title?.includes(episodeTitle) ||
        d.episodeName?.includes(episodeTitle) ||
        episodeTitle.includes(d.episodeName || '___never___'));

    return seasonMatch && episodeMatch;
  });

  return titleMatched?.filePath || null;
};

// Streams are matched by link because the selected stream is not always the
// same object as its entry in the list (downloaded file, refetch).
export const getNextStream = (
  streams: Stream[],
  current: Stream,
): Stream | undefined => {
  const currentIndex = streams.findIndex(
    stream => stream.link === current.link,
  );
  return streams[currentIndex + 1];
};

// A refetch gives the same servers new links. Match the server, then its
// quality and tag when it has several, so playback stays on the one the user
// had.
export const findSameServer = (
  streams: Stream[],
  current: Stream,
): Stream | undefined => {
  if (!current?.server) return undefined;
  let best: Stream | undefined;
  let bestScore = -1;
  for (const stream of streams) {
    if (stream.server !== current.server) continue;
    const score =
      (stream.quality === current.quality ? 2 : 0) +
      (stream.tag === current.tag ? 1 : 0);
    if (score > bestScore) {
      best = stream;
      bestScore = score;
    }
  }
  return best;
};

// A stream handed to the player for its first episode, such as the one an
// unfinished download reads. It plays before online servers load.
export const getInitialStream = (
  activeEpisode: any,
  routeParams: any,
): Stream | undefined => {
  const initialEpisode = routeParams?.episodeList?.[routeParams?.linkIndex];
  return routeParams?.initialStream?.link &&
    getEpisodeIdentity(activeEpisode) === getEpisodeIdentity(initialEpisode)
    ? routeParams.initialStream
    : undefined;
};

export const getStreamQueryKey = (
  episode: any,
  routeParams: any,
  provider: string,
) => [
  'stream',
  episode?.id || episode?.link || episode?.title,
  routeParams?.type,
  provider,
  // Keep the initial download stream separate from a normal cached list.
  ...(getInitialStream(episode, routeParams)
    ? [getInitialStream(episode, routeParams)!.link]
    : []),
];

// Shared by the player's query and the next-episode prefetch, so a prefetched
// list stays fresh and retries exactly like one the player loaded itself.
export const streamQueryOptions = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes
  retry: (failureCount: number, streamFailure: Error) => {
    if (streamFailure.message?.includes('WAF')) return false;
    if (failureCount >= 2) {
      return false;
    }
    return true;
  },
  retryDelay: (attemptIndex: number) =>
    Math.min(1000 * 2 ** attemptIndex, 10000),
};

export interface StreamListRequest {
  episode: any;
  routeParams: any;
  provider: string;
  /** True once the episode's downloaded file failed to play. */
  isLocalFailed?: () => boolean;
  /** Receives a downloaded file as soon as it is found, before the servers. */
  onLocalStream?: (stream: Stream) => void;
  /** Cancels the provider request. */
  signal?: AbortSignal;
  /** Whether the provider may open a WAF challenge now. Always when omitted. */
  canPromptWaf?: () => boolean;
}

// The stream query function. The next-episode prefetch runs it as well, so it
// reaches player state only through the request callbacks.
export const fetchStreamList = async ({
  episode,
  routeParams,
  provider,
  isLocalFailed = () => false,
  onLocalStream,
  signal,
  canPromptWaf,
}: StreamListRequest): Promise<Stream[]> => {
  if (!episode?.link && !episode?.id && !episode?.title) {
    return [];
  }

  if (routeParams?.externalVideo) return [externalVideoStream(routeParams)!];
  if (routeParams?.localContent) {
    return isLocalPath(episode?.link)
      ? [{server: 'Local file', link: episode.link, type: 'local'}]
      : [];
  }

  console.log('Fetching stream for:', episode);

  // 1. Check for downloaded content first
  const downloadedPath = await findDownloadedFileForMedia(episode, routeParams);
  const localStream: Stream | null = downloadedPath
    ? {server: 'Downloaded', link: downloadedPath, type: 'mp4'}
    : getInitialStream(episode, routeParams) || null;

  // Start a discovered download before waiting for optional online servers.
  if (localStream && !isLocalFailed()) {
    onLocalStream?.(localStream);
  }

  let remoteLink =
    (!isLocalPath(episode?.link) && episode?.link) || episode?.sourceLink;

  if (!remoteLink && downloadedPath) {
    const allDownloads = Object.values(useDownloadsStore.getState().downloads);
    const match = allDownloads.find(d => d.filePath === downloadedPath);
    if (match?.sourceLink && !isLocalPath(match.sourceLink)) {
      remoteLink = match.sourceLink;
    }
  }

  if (!remoteLink) {
    if (localStream && !isLocalFailed()) {
      return [localStream];
    }
    if (localStream || isLocalPath(episode?.link)) {
      throw new Error('Downloaded file not found on device');
    }
    return [];
  }

  // 2. Fetch streams from provider online (in background if localStream exists)
  let remoteStreams: Stream[] = [];
  try {
    const controller = new AbortController();
    const timeoutMs = 45000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    if (canPromptWaf) guardWafPrompts(controller.signal, canPromptWaf);
    try {
      const data = await providerManager.getStream({
        link: remoteLink,
        type: routeParams?.type,
        signal: controller.signal,
        providerValue: routeParams?.providerValue || provider,
      });

      // Filter out excluded qualities
      const excludedQualities = settingsStorage.getExcludedQualities() || [];
      const filteredQualities = data?.filter(
        streamItem => !excludedQualities.includes(streamItem?.quality + 'p'),
      );

      remoteStreams =
        filteredQualities?.length > 0 ? filteredQualities : data || [];
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
    }
  } catch (err) {
    if (localStream && !isLocalFailed()) {
      console.warn(
        'Remote stream refresh failed; using local downloaded file:',
        err,
      );
      return [localStream];
    }
    throw err;
  }

  // A provider may return the very URL that just failed. Do not offer it
  // again as an online fallback, or reinsert a failed download on empty data.
  const onlineStreams = remoteStreams.filter(
    stream => !localStream || stream.link !== localStream.link,
  );
  const finalStreams = localStream && !isLocalFailed()
    ? [localStream, ...onlineStreams]
    : onlineStreams;

  if (finalStreams.length === 0) {
    throw new Error('No streams available');
  }

  return finalStreams;
};

export const useStream = ({
  activeEpisode,
  routeParams,
  provider,
  enabled = true,
  localPlaybackReady = true,
}: UseStreamOptions) => {
  const [selectedStream, setSelectedStream] = useState<Stream>(() => {
    const path = getCompletedDownloadPathSync(activeEpisode, routeParams);
    return externalVideoStream(routeParams) || (path
      ? { server: routeParams?.localContent ? 'Local file' : 'Downloaded', link: path, type: routeParams?.localContent ? 'local' : 'mp4' }
      : getInitialStream(activeEpisode, routeParams) || { server: '', link: '', type: '' });
  });
  const [externalSubs, setExternalSubs] = useState<any[]>([]);

  const activeEpisodeKey = getEpisodeIdentity(activeEpisode);
  const subtitleCacheKey = subtitleVideoKey(activeEpisode, routeParams, provider);
  const {savedSubtitles, saveSubtitle, removeSavedSubtitle} = useSavedSubtitles(subtitleCacheKey);
  const subtitleSourcesRef = useRef({episodeKey: activeEpisodeKey, uris: new Set<string>()});
  const activeEpisodeKeyRef = useRef(activeEpisodeKey);
  activeEpisodeKeyRef.current = activeEpisodeKey;
  const previousEpisodeKeyRef = useRef(activeEpisodeKey);
  // Set when the downloaded file fails to play; online servers replace it.
  const [failedLocalEpisodeKey, setFailedLocalEpisodeKey] = useState<string>();
  const localFailed = failedLocalEpisodeKey === activeEpisodeKey;
  const localFailedRef = useRef(localFailed);
  localFailedRef.current = localFailed;

  useEffect(() => {
    if (previousEpisodeKeyRef.current === activeEpisodeKey) {
      return;
    }
    previousEpisodeKeyRef.current = activeEpisodeKey;
    const path = getCompletedDownloadPathSync(activeEpisode, routeParams);
    setSelectedStream(
      externalVideoStream(routeParams) || (path
        ? { server: routeParams?.localContent ? 'Local file' : 'Downloaded', link: path, type: routeParams?.localContent ? 'local' : 'mp4' }
        : getInitialStream(activeEpisode, routeParams) || { server: '', link: '', type: '' }),
    );
  }, [activeEpisode, activeEpisodeKey, routeParams]);

  const localPlaceholder = useMemo(() => {
    const openedStream = externalVideoStream(routeParams);
    if (openedStream) return [openedStream];
    const path = getCompletedDownloadPathSync(activeEpisode, routeParams);
    return path
      ? [{ server: routeParams?.localContent ? 'Local file' : 'Downloaded', link: path, type: routeParams?.localContent ? 'local' : 'mp4' }]
      : undefined;
  }, [activeEpisode, routeParams]);

  const initialStream = getInitialStream(activeEpisode, routeParams);
  const initialStreams = useMemo(
    () => localPlaceholder || (initialStream ? [initialStream] : undefined),
    [localPlaceholder, initialStream],
  );

  const {
    data: fetchedStreams = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Stream[], Error>({
    queryKey: getStreamQueryKey(activeEpisode, routeParams, provider),
    // Reading signal lets React Query cancel the provider call once nothing
    // needs it (player closed, episode changed), so it frees its sandbox slot.
    queryFn: ({signal}) =>
      fetchStreamList({
        episode: activeEpisode,
        routeParams,
        provider,
        signal,
        isLocalFailed: () => localFailedRef.current,
        // A fetch from a previous episode must not replace the current selection.
        onLocalStream: localStream => {
          if (activeEpisodeKeyRef.current === activeEpisodeKey) {
            setSelectedStream(current =>
              current.link || localFailedRef.current ? current : localStream,
            );
          }
        },
      }),
    enabled:
      enabled &&
      !routeParams?.localContent &&
      (!localPlaceholder || localPlaybackReady || localFailed) &&
      Boolean(
        activeEpisode?.link || activeEpisode?.id || activeEpisode?.title,
      ),
    initialData: () => initialStreams,
    initialDataUpdatedAt: initialStreams ? 0 : undefined,
    placeholderData: initialStreams,
    ...streamQueryOptions,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  // Filter cached/placeholder data as soon as playback fails, even while
  // the provider refresh is still pending or has failed itself.
  const initialStreamLink = initialStream?.link;
  const streamData = useMemo(
    () => localFailed
      ? fetchedStreams.filter(stream =>
          !isLocalPath(stream.link) && stream.link !== initialStreamLink,
        )
      : fetchedStreams,
    [fetchedStreams, initialStreamLink, localFailed],
  );

  useEffect(() => {
    setSelectedStream(current => {
      const failedDownload = localFailed && (
        isLocalPath(current?.link) || current?.link === initialStreamLink
      );
      if (!current?.link) return streamData[0] || current;
      if (failedDownload) {
        return streamData[0] || (error
          ? {server: '', link: '', type: ''}
          : current);
      }
      // A user-picked local file is independent of the online server list.
      if (current.type === 'local' || isLocalPath(current.link)) return current;
      if (!streamData.length) return current;
      return streamData.some(stream => stream.link === current.link)
        ? current
        : findSameServer(streamData, current) || streamData[0];
    });
  }, [streamData, localFailed, initialStreamLink, error]);

  const isPlayingLocal = isLocalPath(selectedStream?.link);

  // Keep fetched subtitles available for selection during local playback too.
  useEffect(() => {
    const downloadedSubs = getDownloadedSubtitlesForMedia(
      activeEpisode,
      routeParams,
    );

    const onlineSubs: any[] = [];
    if (streamData && streamData.length > 0) {
      streamData.forEach(track => {
        if (track?.subtitles?.length && track.subtitles.length > 0) {
          onlineSubs.push(...track.subtitles);
        }
      });
    }

    const mergedSubs = [...downloadedSubs];
    onlineSubs.forEach(online => {
      const trimmedUri = typeof online?.uri === 'string' ? online.uri.trim() : '';
      if (
        trimmedUri &&
        (trimmedUri.startsWith('http://') ||
          trimmedUri.startsWith('https://') ||
          trimmedUri.startsWith('file://') ||
          trimmedUri.startsWith('content://')) &&
        !mergedSubs.some(existing => existing.uri === trimmedUri)
      ) {
        mergedSubs.push({
          ...online,
          uri: trimmedUri,
        });
      }
    });

    const savedTracks = [...savedSubtitles].reverse().map(savedSubtitleTrack).filter(sub =>
      !mergedSubs.some((managed: any) => managed.uri === sub.uri),
    );
    const previousSources = subtitleSourcesRef.current;
    subtitleSourcesRef.current = {
      episodeKey: activeEpisodeKey,
      uris: new Set(mergedSubs.map((sub: any) => sub.uri)),
    };
    setExternalSubs(prev => {
      // Refetching provider streams must not discard subtitles added by the user.
      // Their lifetime is the episode; managed provider/download tracks can refresh.
      const imported = previousSources.episodeKey === activeEpisodeKey
        ? prev.filter((sub: any) => !sub.savedSubtitleId && !previousSources.uris.has(sub.uri)
          && !mergedSubs.some((managed: any) => managed.uri === sub.uri))
        : [];
      const next = [...mergedSubs, ...savedTracks, ...imported];
      const prevKey = prev.map((s: any) => s.uri || '').join('|');
      const nextKey = next.map((s: any) => s.uri || '').join('|');
      return prevKey === nextKey ? prev : next;
    });
  }, [streamData, activeEpisodeKey, subtitleCacheKey, savedSubtitles]);

  // Handle errors
  useEffect(() => {
    if (error && !isPlayingLocal) {
      console.error('Stream fetch error:', error);
      const errorMessage = error?.message || 'No stream found, try again later';
      ToastAndroid.show(errorMessage, ToastAndroid.SHORT);
    }
  }, [error, isPlayingLocal]);

  const switchToNextStream = () => {
    if (routeParams?.localContent) return false;
    const failedDownload = isLocalPath(selectedStream?.link) ||
      selectedStream?.link === initialStreamLink;
    if (failedDownload && !localFailedRef.current) {
      // Mark failure before reusing cached data or beginning another request.
      localFailedRef.current = true;
      setFailedLocalEpisodeKey(activeEpisodeKey);
      const online = streamData.find(stream =>
        !isLocalPath(stream.link) && stream.link !== initialStreamLink,
      );
      if (online) {
        setSelectedStream(online);
      } else {
        setSelectedStream({server: '', link: '', type: ''});
        refetch();
      }
      ToastAndroid.show(
        'Download stream could not be played, Trying online servers',
        ToastAndroid.SHORT,
      );
      return true;
    }
    const nextStream = getNextStream(streamData, selectedStream);
    if (nextStream) {
      setSelectedStream(nextStream);
      ToastAndroid.show(
        'Video could not be played, Trying next server',
        ToastAndroid.SHORT,
      );
      return true;
    }
    return false;
  };

  // Asks the provider for new links, for when the selected one has expired.
  // Resolves true when the failed link is gone from the new list; the effect
  // above then moves to the same server's new link.
  const refreshLinks = async () => {
    const failedLink = selectedStream.link;
    const {data} = await refetch();
    return (
      Boolean(data?.length) &&
      !data!.some(stream => stream.link === failedLink)
    );
  };

  // Failed downloads are excluded from automatic fallback, not from manual choices.
  const selectableStreams = useMemo(() => {
    const downloaded = localPlaceholder?.[0];
    return downloaded && !streamData.some(stream => stream.link === downloaded.link)
      ? [downloaded, ...streamData]
      : streamData;
  }, [localPlaceholder, streamData]);
  const selectStream: typeof setSelectedStream = useCallback(next => {
    if (typeof next !== 'function' && isLocalPath(next.link)) {
      localFailedRef.current = false;
      setFailedLocalEpisodeKey(undefined);
    }
    setSelectedStream(next);
  }, []);

  return {
    streamData: selectableStreams,
    selectedStream,
    setSelectedStream: selectStream,
    externalSubs,
    setExternalSubs,
    savedSubtitles,
    saveSubtitle,
    removeSavedSubtitle,
    isLoading: isLoading && !isPlayingLocal,
    error: isPlayingLocal ? null : error,
    refetch,
    refreshLinks,
    switchToNextStream,
  };
};

const audioTrackListKey = (tracks: any[]): string =>
  tracks
    .map(
      track =>
        `${track.index}-${track.title}-${track.language}-${track.selected}`,
    )
    .join('|');

const textTrackListKey = (tracks: any[]): string =>
  tracks
    .map(
      track =>
        `${track.index}-${track.title}-${track.language}-${track.uri}-${track.selected}`,
    )
    .join('|');

const videoTrackListKey = (tracks: any[]): string =>
  tracks
    .map(
      track =>
        `${track.index}-${track.trackId}-${track.width}x${track.height}-${track.bitrate}-${track.selected}`,
    )
    .join('|');

// Hook for managing video tracks and settings
export const useVideoSettings = () => {
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [textTracks, _setTextTracks] = useState<any[]>([]);
  const [videoTracks, setVideoTracks] = useState<any[]>([]);

  const setTextTracks = useCallback((tracksOrFn: any) => {
    _setTextTracks(previous => {
      const next =
        typeof tracksOrFn === 'function' ? tracksOrFn(previous) : tracksOrFn;
      if (!Array.isArray(next)) return next;
      return textTrackListKey(previous) === textTrackListKey(next)
        ? previous
        : next;
    });
  }, []);

  const [loadedVideoSize, setLoadedVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [selectedAudioTrackIndex, setSelectedAudioTrackIndex] = useState(0);
  const [selectedTextTrackIndex, setSelectedTextTrackIndex] = useState(1000);
  const [selectedQualityIndex, setSelectedQualityIndex] = useState(1000);

  const processAudioTracks = useCallback((tracks: any[]) => {
    const uniqueMap = new Map();
    tracks.forEach(track => {
      const key = `${track.type}-${track.title}-${track.language}`;
      const existingTrack = uniqueMap.get(key);

      if (!existingTrack) {
        uniqueMap.set(key, track);
        return;
      }

      if (track.selected && !existingTrack.selected) {
        uniqueMap.set(key, { ...existingTrack, ...track, selected: true });
      }
    });

    const uniqueTracks = Array.from(uniqueMap.values());
    const selectedIndex = uniqueTracks.findIndex(track => track.selected);

    setAudioTracks(previous =>
      audioTrackListKey(previous) === audioTrackListKey(uniqueTracks)
        ? previous
        : uniqueTracks,
    );
    if (selectedIndex !== -1) {
      setSelectedAudioTrackIndex(selectedIndex);
    }
  }, []);

  const processVideoTracks = useCallback((tracks: any[]) => {
    if (!tracks || tracks.length === 0) {
      return;
    }
    const uniqueTracks = deduplicateVideoTracks(tracks);
    uniqueTracks.sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.bitrate || 0) - (a.bitrate || 0),
    );

    const activeTrack = uniqueTracks.find((t: any) => t.selected);
    if (activeTrack && activeTrack.height) {
      setLoadedVideoSize(prev =>
        prev?.height === activeTrack.height && prev?.width === activeTrack.width
          ? prev
          : { width: activeTrack.width || 0, height: activeTrack.height },
      );
    }

    setVideoTracks(previous =>
      videoTrackListKey(previous) === videoTrackListKey(uniqueTracks)
        ? previous
        : uniqueTracks,
    );
  }, []);

  const handleVideoLoad = useCallback(
    (naturalSize?: { width?: number; height?: number }) => {
      if (!naturalSize?.height) {
        return;
      }
      setLoadedVideoSize({
        width: naturalSize.width ?? 0,
        height: naturalSize.height ?? 0,
      });
    },
    [],
  );

  // Clear everything when switching to a new stream/episode.
  const resetVideoTracks = useCallback(() => {
    setVideoTracks([]);
    setLoadedVideoSize(null);
  }, []);

  return {
    audioTracks,
    textTracks,
    videoTracks,
    loadedVideoSize,
    selectedAudioTrackIndex,
    selectedTextTrackIndex,
    selectedQualityIndex,
    setAudioTracks,
    setTextTracks,
    setVideoTracks,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    processAudioTracks,
    processVideoTracks,
    handleVideoLoad,
    resetVideoTracks,
  };
};
