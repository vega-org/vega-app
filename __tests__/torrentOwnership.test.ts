import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('../src/lib/torrentManager', () => ({
  torrentManager: {deleteTorrent: jest.fn(async () => {})},
}));
jest.mock('../src/lib/remote/remotePlaybackManager', () => ({
  remotePlaybackManager: {adoptTorrent: jest.fn(() => false)},
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: (global as any).__downloads ?? {}})},
  CURRENT_DOWNLOAD_STATUSES: new Set([
    'queued',
    'starting',
    'downloading',
    'pausing',
    'paused',
    'finalizing',
    'interrupted',
    'error',
    'canceling',
  ]),
}));

import {remotePlaybackManager} from '../src/lib/remote/remotePlaybackManager';
import {torrentManager} from '../src/lib/torrentManager';
import {isTorrentInUse, releaseTorrent} from '../src/lib/torrentOwnership';

const adoptTorrent = remotePlaybackManager.adoptTorrent as jest.Mock<
  (hash: string) => boolean
>;
const deleteTorrent = torrentManager.deleteTorrent as jest.Mock<
  (hash: string, deleteFiles: boolean) => Promise<void>
>;

const setDownloads = (
  downloads: Record<string, {sourceType: string; backendJobId?: string; status: string}>,
) => {
  (global as any).__downloads = downloads;
};

describe('torrent ownership', () => {
  beforeEach(() => {
    deleteTorrent.mockClear();
    adoptTorrent.mockReset();
    adoptTorrent.mockImplementation(() => false);
    setDownloads({});
  });

  it('releases a torrent nobody else uses', async () => {
    await releaseTorrent('abc');

    expect(deleteTorrent).toHaveBeenCalledWith('abc', true);
  });

  it('keeps a torrent the cast session adopted', async () => {
    adoptTorrent.mockImplementation(hash => hash === 'abc');

    expect(isTorrentInUse('abc')).toBe(true);
    await releaseTorrent('abc');

    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it('keeps a torrent an active download is using', async () => {
    setDownloads({d1: {sourceType: 'torrent', backendJobId: 'abc', status: 'downloading'}});

    expect(isTorrentInUse('abc')).toBe(true);
    await releaseTorrent('abc');

    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it('releases a torrent whose download already finished', async () => {
    setDownloads({d1: {sourceType: 'torrent', backendJobId: 'abc', status: 'completed'}});

    expect(isTorrentInUse('abc')).toBe(false);
    await releaseTorrent('abc');

    expect(deleteTorrent).toHaveBeenCalledWith('abc', true);
  });

  it('ignores http downloads that share an id value', async () => {
    setDownloads({d1: {sourceType: 'http', backendJobId: 'abc', status: 'downloading'}});

    await releaseTorrent('abc');

    expect(deleteTorrent).toHaveBeenCalledWith('abc', true);
  });

  it('ignores downloads of other torrents', async () => {
    setDownloads({d1: {sourceType: 'torrent', backendJobId: 'def', status: 'downloading'}});

    await releaseTorrent('abc');

    expect(deleteTorrent).toHaveBeenCalledWith('abc', true);
  });
});
