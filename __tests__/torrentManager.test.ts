const mockAddTorrent = jest.fn();
const mockClearStreamCache = jest.fn();

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    TorrentModule: {
      initEngine: jest.fn(() => Promise.resolve({streamPort: 8080})),
      addTorrent: (...args: unknown[]) => mockAddTorrent(...args),
      clearStreamCache: (...args: unknown[]) => mockClearStreamCache(...args),
    },
  },
}));

import {
  base32ToHex,
  normalizeMagnetLink,
  torrentManager,
} from '../src/lib/torrentManager';

const HEX = '0123456789abcdef0123456789abcdef01234567';
const BASE32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';

describe('base32ToHex', () => {
  it('decodes 20-byte info hashes', () => {
    expect(base32ToHex(BASE32)).toBe(HEX);
    expect(base32ToHex('AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQT')).toBe(
      '000102030405060708090a0b0c0d0e0f10111213',
    );
  });

  it('is case-insensitive', () => {
    expect(base32ToHex(BASE32.toLowerCase())).toBe(HEX);
  });
});

describe('normalizeMagnetLink', () => {
  it('rewrites a base32 btih to hex', () => {
    expect(
      normalizeMagnetLink(`magnet:?xt=urn:btih:${BASE32}&dn=Movie&tr=udp%3A`),
    ).toBe(`magnet:?xt=urn:btih:${HEX}&dn=Movie&tr=udp%3A`);
    expect(
      normalizeMagnetLink(
        `magnet:?dn=Movie&xt=urn:btih:${BASE32.toLowerCase()}`,
      ),
    ).toBe(`magnet:?dn=Movie&xt=urn:btih:${HEX}`);
  });

  it('leaves hex magnets and other inputs unchanged', () => {
    const hexMagnet = `magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Movie`;
    expect(normalizeMagnetLink(hexMagnet)).toBe(hexMagnet);
    expect(normalizeMagnetLink('https://example.com/a.torrent')).toBe(
      'https://example.com/a.torrent',
    );
    expect(normalizeMagnetLink('/data/file.torrent')).toBe(
      '/data/file.torrent',
    );
  });
});

describe('torrentManager.addTorrent', () => {
  it('passes a hex btih to the native module for base32 magnets', async () => {
    mockAddTorrent.mockResolvedValue({infoHash: HEX});
    await torrentManager.addTorrent(`magnet:?xt=urn:btih:${BASE32}&dn=Movie`);
    expect(mockAddTorrent).toHaveBeenCalledWith(
      `magnet:?xt=urn:btih:${HEX}&dn=Movie`,
      null,
      null,
    );
  });
});

describe('torrentManager.clearStreamCache', () => {
  it('delegates to native TorrentModule.clearStreamCache', async () => {
    mockClearStreamCache.mockResolvedValueOnce(true);
    await expect(torrentManager.clearStreamCache()).resolves.toBe(true);
    expect(mockClearStreamCache).toHaveBeenCalledTimes(1);
  });

  it('returns false when native cleanup fails', async () => {
    mockClearStreamCache.mockRejectedValueOnce(new Error('disk error'));
    await expect(torrentManager.clearStreamCache()).resolves.toBe(false);
  });
});
