import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  downloadOutputExists,
  finalizeDownloadOutput,
  getDownloadOutputSize,
  getDownloadStagingDirectory,
  getDownloadStagingPath,
} from './downloadDestination';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
} from './downloadId';
import {isSafDownloadLocation} from './downloadLocation';
import {notificationService} from './services/Notification';
import {torrentManager} from './torrentManager';
import useDownloadsStore, {
  type DownloadItem,
  type DownloadStatus,
} from './zustand/downloadsStore';

const STALE_RUNTIME_STATUSES: ReadonlySet<DownloadStatus> = new Set([
  'starting',
  'downloading',
  'pausing',
  'canceling',
]);

const RESUMABLE_HTTP_STATUSES: ReadonlySet<DownloadStatus> = new Set([
  'starting',
  'downloading',
  'pausing',
]);

const shouldResumeHttpDownload = (record: DownloadItem): boolean =>
  RESUMABLE_HTTP_STATUSES.has(record.status) ||
  (record.status === 'paused' && record.errorCode === 'NETWORK_INTERRUPTED');

const getOutputName = (record: DownloadItem): string =>
  record.displayFileName?.replace(/\.[^.]+$/, '') || record.title;

const getStagingPath = (record: DownloadItem): string =>
  record.stagingPath ||
  getDownloadStagingPath(
    record.id,
    getOutputName(record),
    record.videoType || 'mp4',
  );

const reconcileFinalizing = async (record: DownloadItem): Promise<void> => {
  const store = useDownloadsStore.getState();
  if (
    !record.downloadLocation ||
    !isSafDownloadLocation(record.downloadLocation)
  ) {
    store.markInterrupted(
      record.id,
      'Download destination must be selected again',
    );
    return;
  }

  const finalPath =
    record.finalDocumentUri ||
    (record.filePath.startsWith('content://') ? record.filePath : undefined);
  if (finalPath && (await downloadOutputExists(finalPath))) {
    store.markCompleted(record.id, {
      filePath: finalPath,
      finalDocumentUri: finalPath,
      totalBytes: record.totalBytes,
    });
    return;
  }

  const stagingPath = getStagingPath(record);
  if (!(await RNFS.exists(stagingPath))) {
    store.markInterrupted(record.id, 'Finalization was interrupted');
    return;
  }

  try {
    const output = await finalizeDownloadOutput({
      downloadId: record.id,
      location: record.downloadLocation,
      stagingPath,
      fileName: getOutputName(record),
      fileType: record.videoType || 'mp4',
      outputDirectoryNames: [
        createDownloadDirectoryName(record.showName || record.title),
        ...[createDownloadSeasonDirectoryName(record.seasonTitle)].filter(
          (name): name is string => Boolean(name),
        ),
      ],
    });
    store.markCompleted(record.id, {
      filePath: output.filePath,
      finalDocumentUri: output.finalDocumentUri,
      totalBytes: output.size,
    });
  } catch (error) {
    store.markError(record.id, {
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }
};

const reconcileRecord = async (record: DownloadItem): Promise<void> => {
  const store = useDownloadsStore.getState();
  await notificationService
    .cancelNotification(record.id)
    .catch(() => undefined);

  if (record.status === 'completed') {
    await downloadOutputExists(record.filePath).then(exists => {
      if (!exists) store.markMissing(record.id);
    }).catch(error => console.warn('Download file could not be checked:', error));
    return;
  }

  if (record.status === 'finalizing') {
    await reconcileFinalizing(record);
    return;
  }

  if (
    record.sourceType === 'http' &&
    record.finalDocumentUri &&
    shouldResumeHttpDownload(record) &&
    (await downloadOutputExists(record.finalDocumentUri))
  ) {
    // Parallel downloads write ranges out of order, so the file size can be
    // near the total while gaps remain. Prefer the last reported progress.
    const downloadedBytes =
      record.downloadedBytes > 0
        ? record.downloadedBytes
        : await getDownloadOutputSize(record.finalDocumentUri).catch(
            () => record.downloadedBytes,
          );
    store.updateDownload(record.id, {
      status: 'queued',
      downloadedBytes,
      speed: 0,
      canPause: false,
      canResume: false,
      errorCode: undefined,
      errorMessage: undefined,
      retryable: undefined,
    });
    return;
  }

  if (STALE_RUNTIME_STATUSES.has(record.status)) {
    const stagingPath = getStagingPath(record);
    const stagingExists = await RNFS.exists(stagingPath);
    store.markInterrupted(
      record.id,
      stagingExists
        ? 'Download was interrupted and can be retried'
        : 'Download stopped before completion',
    );
  }
};

export const reconcileCompletedDownloadOutputs = async (
  signal?: AbortSignal,
  recordIds?: ReadonlySet<string>,
): Promise<void> => {
  const allRecords = Object.values(useDownloadsStore.getState().downloads).filter(
    record =>
      (!recordIds || recordIds.has(record.id)) &&
      (record.status === 'completed' || record.status === 'missing'),
  );
  let nextIndex = 0;
  // SAF checks cross a native/content-provider boundary. A large library must
  // not enqueue one native request per file in a single navigation turn.
  const worker = async () => {
    while (!signal?.aborted) {
      const record = allRecords[nextIndex++];
      if (!record) return;
      const targetPath = record.filePath || record.finalDocumentUri;
      const exists = targetPath
        ? await downloadOutputExists(targetPath).catch(() => undefined)
        : false;
      if (exists === undefined) continue;
      if (signal?.aborted) return;
      // A deleted/replaced/retried record must not be changed by an old check.
      if (useDownloadsStore.getState().downloads[record.id] !== record) continue;
      if (record.status === 'completed') {
        if (!exists) {
          useDownloadsStore.getState().markMissing(record.id);
        }
      } else if (record.status === 'missing') {
        if (targetPath && exists) {
          useDownloadsStore.getState().markCompleted(record.id, {
            filePath: targetPath,
            finalDocumentUri: record.finalDocumentUri || targetPath,
            totalBytes: record.totalBytes,
          });
        }
      }
    }
  };
  await Promise.all(
    Array.from({length: Math.min(4, allRecords.length)}, () => worker()),
  );
};

const cleanupOrphanStaging = async (records: DownloadItem[]): Promise<void> => {
  const root = `${RNFS.CachesDirectoryPath}/downloads`;
  if (!(await RNFS.exists(root))) {
    return;
  }
  const knownDirectories = new Set(
    records.map(record => getDownloadStagingDirectory(record.id)),
  );
  const entries = await RNFS.readDir(root);
  await Promise.all(
    entries
      .filter(entry => entry.isDirectory() && !knownDirectories.has(entry.path))
      .map(entry => RNFS.unlink(entry.path).catch(() => undefined)),
  );
};

const cleanupOrphanTorrentStreams = async (): Promise<void> => {
  if (await torrentManager.clearStreamCache()) {
    return;
  }
  const dirs = [
    RNFS.DocumentDirectoryPath ? `${RNFS.DocumentDirectoryPath}/torrents` : '',
    RNFS.CachesDirectoryPath ? `${RNFS.CachesDirectoryPath}/torrents` : '',
  ].filter(Boolean);
  await Promise.all(
    dirs.map(async dir => {
      if (await RNFS.exists(dir).catch(() => false)) {
        await RNFS.unlink(dir).catch(() => undefined);
      }
    }),
  );
};

export const reconcileDownloadState = async (): Promise<void> => {
  const records = Object.values(useDownloadsStore.getState().downloads);
  await notificationService
    .resetDownloadForegroundState()
    .catch(() => undefined);
  await Promise.all(records.map(reconcileRecord));
  await cleanupOrphanStaging(records);
  await cleanupOrphanTorrentStreams();
  const {scheduleQueuedDownloads} =
    require('./downloadManager') as typeof import('./downloadManager');
  await scheduleQueuedDownloads();
};
