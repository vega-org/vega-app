const mockCacheValues = new Map<string, string>();
const mockClearMMKVCache = jest.fn(() => mockCacheValues.clear());
const mockClearQueries = jest.fn();
const mockClearImageColors = jest.fn();
const mockClearImageAccents = jest.fn();
const mockClearHero = jest.fn();
const mockUnlink = jest.fn(() => Promise.resolve());

jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  readDir: jest.fn(() =>
    Promise.resolve([
      {name: 'downloads', path: '/cache/downloads'},
      {name: 'hls_segments', path: '/cache/hls_segments'},
      {name: 'temporary-update.apk', path: '/cache/temporary-update.apk'},
      {name: 'images', path: '/cache/images'},
    ]),
  ),
  unlink: (path: string) => mockUnlink(path),
}));

jest.mock('react-native-image-colors', () => ({
  cache: {clear: () => mockClearImageColors()},
}));

jest.mock('../src/lib/client', () => ({
  queryClient: {clear: () => mockClearQueries()},
}));

jest.mock('../src/lib/hooks/useHomePageData', () => ({
  clearHeroCache: () => mockClearHero(),
}));

jest.mock('../src/lib/imageAccent', () => ({
  clearImageAccentCache: () => mockClearImageAccents(),
}));

jest.mock('../src/lib/downloadThumbnailCache', () => ({
  clearDownloadedVideoThumbnailMemoryCache: jest.fn(),
}));

jest.mock('../src/lib/storage/StorageService', () => ({
  cacheStorage: {
    getKeys: async () => Array.from(mockCacheValues.keys()),
    getString: (key: string) => mockCacheValues.get(key),
    setString: (key: string, value: string) => mockCacheValues.set(key, value),
    clearAll: () => mockClearMMKVCache(),
  },
}));

import {clearAppCache} from '../src/lib/clearAppCache';

describe('clearAppCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheValues.clear();
  });

  it('clears cache layers while preserving download staging', async () => {
    await clearAppCache();

    expect(mockClearMMKVCache).toHaveBeenCalledTimes(1);
    expect(mockClearQueries).toHaveBeenCalledTimes(1);
    expect(mockClearImageColors).toHaveBeenCalledTimes(1);
    expect(mockClearImageAccents).toHaveBeenCalledTimes(1);
    expect(mockClearHero).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(2);
    expect(mockUnlink).toHaveBeenCalledWith('/cache/temporary-update.apk');
    expect(mockUnlink).toHaveBeenCalledWith('/cache/images');
    expect(mockUnlink).not.toHaveBeenCalledWith('/cache/downloads');
    expect(mockUnlink).not.toHaveBeenCalledWith('/cache/hls_segments');
  });

  it('keeps player choices while clearing cache and episode progress', async () => {
    const preserved = {
      'skips_vega:show:s1e1': '[{"start":0,"end":90}]',
      'LastPlayed:vega:https://example.com/show': '{"link":"s1e1"}',
      'ActiveSeason:Showvega': '{"title":"Season 1"}',
      'EpisodeRange:vega:show:Season 1': '25',
      lastTextTrack: 'English',
      lastAudioTrack: 'Hindi',
    };
    const cleared = {
      'https://example.com/s1e1': '{"position":754,"duration":1420}',
      'https://example.com/s1e2': '{"position":1,"duration":1}',
      'contentInfo:vega:https://example.com/show': '{"title":"Show"}',
      'accent:https://example.com/poster.jpg': '#123456',
      episodes: '[{"position":1,"title":"Episode"}]',
      partial: '{"position":1,"duration":1,"title":"Not progress"}',
    };
    Object.entries({...preserved, ...cleared}).forEach(([key, value]) =>
      mockCacheValues.set(key, value),
    );

    await clearAppCache();

    expect(mockClearMMKVCache).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(mockCacheValues)).toEqual(preserved);
  });
});
