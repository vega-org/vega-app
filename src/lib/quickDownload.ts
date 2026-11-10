import {downloadManager} from './downloader';
import {createSubtitleFileName} from './downloadId';
import {Stream} from './providers/types';
import {runWithDownloadAd} from './ads/unityAds';

type DownloadRequest = Parameters<typeof downloadManager>[0];

// Batch selection deliberately uses provider order, regardless of quickDownload.
export const queueQuickDownload = async (
  request: Omit<DownloadRequest, 'url' | 'fileType'>,
  stream: Stream,
  signal?: AbortSignal,
) => {
  if (signal?.aborted) return;
  await runWithDownloadAd(() =>
    downloadManager({
    ...request,
    url: stream.link,
    fileType: stream.type,
    server: stream.server,
    quality: stream.quality,
    headers: stream.headers,
    skip: stream.skip?.length
      ? stream.skip
      : (stream as Stream & {skips?: Stream['skip']}).skips?.length
        ? (stream as Stream & {skips?: Stream['skip']}).skips
        : request.skip,
    subtitles: stream.subtitles?.map(sub => ({
      url: sub.uri,
      language: sub.language || 'Unknown',
      format: sub.type === 'text/vtt' ? 'vtt' : 'srt',
    })),
    }),
  );
  const sub = stream.subtitles?.[0];
  if (!sub || signal?.aborted) return;
  await downloadManager({
    ...request,
    downloadId: `${request.downloadId}_subtitle_${sub.title}`,
    title: `${request.title} ${sub.title} Subtitle `,
    isSubtitle: true,
    url: sub.uri,
    fileName: createSubtitleFileName(request.fileName, sub.title),
    fileType: sub.type === 'text/vtt' ? 'vtt' : 'srt',
  });
};
