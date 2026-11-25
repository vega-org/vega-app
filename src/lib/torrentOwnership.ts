import {remotePlaybackManager} from './remote/remotePlaybackManager';
import {torrentManager} from './torrentManager';
import useDownloadsStore, {CURRENT_DOWNLOAD_STATUSES} from './zustand/downloadsStore';

/**
 * A torrent added for streaming can outlive the screen that started it: a cast
 * session or a download may still be using the same info hash, and the native
 * engine reuses existing torrents instead of adding a second copy.
 */
export const isTorrentInUse = (infoHash: string): boolean => {
  // Adopting hands the torrent to the cast session, which deletes it when the
  // receiver stops streaming.
  if (remotePlaybackManager.adoptTorrent(infoHash)) return true;
  const downloads = useDownloadsStore.getState().downloads;
  // The torrent backend stores the info hash as the download's backend job id.
  return Object.values(downloads).some(
    item =>
      item.sourceType === 'torrent' &&
      (item.backendJobId === infoHash || item.torrentInfoHash === infoHash) &&
      CURRENT_DOWNLOAD_STATUSES.has(item.status),
  );
};

/** Deletes a torrent only when no cast session or download still needs it. */
export const releaseTorrent = async (infoHash: string): Promise<void> => {
  if (isTorrentInUse(infoHash)) return;
  await torrentManager.deleteTorrent(infoHash, true);
};
