import {describe, expect, it, jest} from '@jest/globals';

import {
  isDummyTorrentLink,
  isTorrentStream,
  pickVideoFileIndex,
  resolveTorrentStream,
} from '../src/lib/torrentStream';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return {promise, resolve};
};

const makeOptions = (cancelled: {current: boolean}) => ({
  addTorrent: jest.fn(async () => ({infoHash: 'abc'})),
  deleteTorrent: jest.fn(async () => {}),
  findVideoFileIndex: jest.fn(async () => 0),
  prepareVideoFile: jest.fn(async () => {}),
  getStreamUrl: jest.fn(async () => 'http://127.0.0.1:8090/stream/abc/0'),
  onAdded: jest.fn(),
  isCancelled: () => cancelled.current,
});

describe('resolveTorrentStream', () => {
  it('returns the stream url when nothing changed', async () => {
    const options = makeOptions({current: false});

    const result = await resolveTorrentStream('magnet:?xt=abc', options);

    expect(result?.streamUrl).toBe('http://127.0.0.1:8090/stream/abc/0');
    expect(options.onAdded).toHaveBeenCalledWith('abc');
  });

  it('drops the url when the stream changed while metadata was loading', async () => {
    const cancelled = {current: false};
    const files = deferred<number>();
    const options = makeOptions(cancelled);
    options.findVideoFileIndex.mockReturnValue(files.promise);

    const pending = resolveTorrentStream('magnet:?xt=abc', options);
    await Promise.resolve();
    cancelled.current = true;
    files.resolve(0);

    await expect(pending).resolves.toBeNull();
    expect(options.getStreamUrl).not.toHaveBeenCalled();
  });

  it('drops the url when the stream changed while it was being fetched', async () => {
    const cancelled = {current: false};
    const url = deferred<string>();
    const options = makeOptions(cancelled);
    options.getStreamUrl.mockReturnValue(url.promise);

    const pending = resolveTorrentStream('magnet:?xt=abc', options);
    await new Promise(r => setTimeout(r, 0));
    cancelled.current = true;
    url.resolve('http://127.0.0.1:8090/stream/abc/0');

    await expect(pending).resolves.toBeNull();
  });

  it('deletes a torrent added after the stream changed', async () => {
    const cancelled = {current: false};
    const added = deferred<{infoHash: string}>();
    const options = makeOptions(cancelled);
    options.addTorrent.mockReturnValue(added.promise);

    const pending = resolveTorrentStream('magnet:?xt=abc', options);
    cancelled.current = true;
    added.resolve({infoHash: 'abc'});

    await expect(pending).resolves.toBeNull();
    expect(options.deleteTorrent).toHaveBeenCalledWith('abc');
    expect(options.onAdded).not.toHaveBeenCalled();
  });
});

describe('torrent stream helpers', () => {
  it('treats torrent typed links as torrents, not only magnets', () => {
    expect(
      isTorrentStream({type: 'torrent', link: 'https://x/a.torrent'}),
    ).toBe(true);
    expect(isTorrentStream({type: 'mp4', link: 'magnet:?xt=abc'})).toBe(true);
    expect(isTorrentStream({type: 'mp4', link: 'https://x/a.mp4'})).toBe(false);
  });

  it('detects empty and dummy hashes', () => {
    expect(isDummyTorrentLink('')).toBe(true);
    expect(
      isDummyTorrentLink(
        'magnet:?xt=urn:btih:d41d8cd98f00b204e9800998ecf8427e',
      ),
    ).toBe(true);
    expect(isDummyTorrentLink('magnet:?xt=urn:btih:abc')).toBe(false);
  });
});

describe('pickVideoFileIndex', () => {
  it('picks the largest video file', () => {
    expect(
      pickVideoFileIndex([
        {index: 0, name: 'sample.mkv', size: 10},
        {index: 1, name: 'Movie.MKV', size: 900},
        {index: 2, name: 'extras.iso', size: 5000},
      ]),
    ).toBe(1);
  });

  it('falls back to the first file when none is a video', () => {
    expect(pickVideoFileIndex([{index: 0, name: 'readme.txt', size: 1}])).toBe(
      0,
    );
  });

  it('throws when the torrent has no files', () => {
    expect(() => pickVideoFileIndex([])).toThrow('No files found in torrent');
  });
});
