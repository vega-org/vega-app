import {isSubtitleDownloadItem} from './downloadId';
import type {Stream} from './providers/types';
import type {DownloadItem} from './zustand/downloadsStore';

// Stream links and the cookies in their headers expire. A download queued
// behind others, or retried later, can then fail with one of these statuses.
const EXPIRED_LINK_ERROR =
  /\b(?:HTTP(?: status)?|status:?)\s*(?:401|403|404|410)\b/i;

const REFRESH_TIMEOUT_MS = 45_000;

export const isExpiredLinkError = (message?: string): boolean =>
  Boolean(message && EXPIRED_LINK_ERROR.test(message));

/** Whether the provider can be asked again for this download's link. */
export const canRefreshDownloadSource = (record: DownloadItem): boolean =>
  record.sourceType !== 'torrent' &&
  !isSubtitleDownloadItem(record) &&
  Boolean(record.provider) &&
  /^https?:/i.test(record.sourceLink ?? '');

// Same rule as downloader.ts uses to pick the backend.
const streamSourceType = (stream: Stream): DownloadItem['sourceType'] => {
  if (stream.type === 'torrent' || stream.link?.startsWith('magnet:')) {
    return 'torrent';
  }
  return stream.type === 'm3u8' ? 'hls' : 'http';
};

/**
 * The fresh stream for this download: the same server with the same kind of
 * stream. Never another server, as that may be a different file.
 */
export const pickRefreshedStream = (
  streams: Stream[],
  record: DownloadItem,
): Stream | undefined => {
  if (!record.server) {
    return undefined;
  }
  const matches = streams.filter(
    stream =>
      stream?.link &&
      !stream.drm &&
      stream.server === record.server &&
      streamSourceType(stream) === record.sourceType &&
      (record.sourceType === 'hls' ||
        Boolean(record.videoType && stream.type?.trim().toLowerCase() === record.videoType.trim().toLowerCase())),
  );
  // The unchanged URL identifies the file even when only cookies changed.
  const exact = matches.find(stream => stream.link === record.url);
  if (exact) return exact;
  const quality = (value?: string) => value?.trim().toLowerCase().replace(/p$/, '');
  const candidates = matches.filter(stream =>
    quality(stream.quality) === quality(record.quality),
  );
  const unique = new Map(candidates.map(stream => [stream.link, stream]));
  return unique.size === 1 ? unique.values().next().value : undefined;
};

/**
 * Loads a bounded, cancellable server list for link refresh or server fallback.
 * Returns undefined when the request fails or is cancelled.
 */
export const fetchDownloadSourceStreams = async (
  record: DownloadItem,
  signal?: AbortSignal,
): Promise<Stream[] | undefined> => {
  if (!canRefreshDownloadSource(record) || signal?.aborted) return undefined;
  const {providerManager} =
    require('./services/ProviderManager') as typeof import('./services/ProviderManager');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Download source refresh aborted'));
    controller.signal.addEventListener('abort', onAbort, {once: true});
  });
  const timer = setTimeout(abort, REFRESH_TIMEOUT_MS);
  if (signal?.aborted) abort();
  try {
    const streams = await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Aborted');
        return providerManager.getStream({
          link: record.sourceLink!,
          type: record.type,
          providerValue: record.provider!,
          signal: controller.signal,
          isDownload: true,
        });
      }),
      aborted,
    ]);
    if (controller.signal.aborted) return undefined;
    return streams || [];
  } catch (error) {
    if (!controller.signal.aborted) {
      console.warn(`Unable to refresh the link of download ${record.id}:`, error);
    }
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
};

export const refreshDownloadSource = async (
  record: DownloadItem,
  signal?: AbortSignal,
  onStreams?: (streams: Stream[] | undefined) => void,
): Promise<Pick<DownloadItem, 'url' | 'headers'> | undefined> => {
  const streams = await fetchDownloadSourceStreams(record, signal);
  onStreams?.(streams);
  if (!streams || signal?.aborted) return undefined;
  const stream = pickRefreshedStream(streams, record);
  return stream ? {url: stream.link, headers: stream.headers} : undefined;
};
