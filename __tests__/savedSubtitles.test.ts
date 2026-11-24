const mockStorage = new Map<string, any>();
const mockFiles = new Map<string, {size: number}>();
const mockDownload = jest.fn(async (_from: string, to: string) => {
  mockFiles.set(to, {size: 120});
  return {status: 200, uri: to};
});
const mockDelete = jest.fn(async (uri: string) => {mockFiles.delete(uri);});
jest.mock('../src/lib/storage/StorageService', () => ({cacheStorage: {
  getObject: (key: string) => mockStorage.get(key),
  setObject: (key: string, value: any) => mockStorage.set(key, JSON.parse(JSON.stringify(value))),
  delete: (key: string) => mockStorage.delete(key),
}}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async (dir: string) => [...mockFiles.keys()].filter(uri => uri.startsWith(dir)).map(uri => uri.slice(dir.length)),
  getInfoAsync: async (uri: string) => mockFiles.has(uri) ? {exists: true, isDirectory: false, ...mockFiles.get(uri)} : {exists: false},
  downloadAsync: (...args: [string, string]) => mockDownload(...args),
  copyAsync: async ({from, to}: {from: string; to: string}) => {
    if (!mockFiles.has(from)) throw new Error('Missing original');
    mockFiles.set(to, {...mockFiles.get(from)!});
  },
  deleteAsync: (uri: string) => mockDelete(uri),
}));

import {
  findSavedSubtitle, loadSavedSubtitles, removeSavedSubtitle, savedSubtitleTrack,
  saveSubtitle, subtitleVideoKey,
} from '../src/lib/subtitles/savedSubtitles';

const track = {uri: 'https://subtitles.test/english.srt', title: 'English release', language: 'en'};
beforeEach(() => {
  mockStorage.clear(); mockFiles.clear(); jest.clearAllMocks();
  mockDownload.mockImplementation(async (_from, to) => {mockFiles.set(to, {size: 120}); return {status: 200, uri: to};});
});

it('downloads only the selected subtitle once, and restores it for that video', async () => {
  const saved = await saveSubtitle('episode-1', track, 'search');
  expect(saved.uri).toMatch(/^file:\/\/\/cache\/saved-subtitles\//);
  expect(saved.originalUri).toBe(track.uri);
  expect(await loadSavedSubtitles('episode-1')).toEqual([saved]);
  expect(await saveSubtitle('episode-1', track, 'search')).toEqual(saved);
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(await loadSavedSubtitles('episode-2')).toEqual([]);
});

it('copies picked files into cache and removes only its own copy', async () => {
  const original = 'file:///documents/English.vtt'; mockFiles.set(original, {size: 200});
  const saved = await saveSubtitle('movie', {uri: original, title: 'English.vtt'}, 'file');
  expect(saved.type).toBe('text/vtt');
  expect(saved.uri).not.toBe(original);
  await removeSavedSubtitle('different-video', saved.id);
  expect((await loadSavedSubtitles('movie'))).toHaveLength(1);
  await removeSavedSubtitle('movie', saved.id);
  expect(await loadSavedSubtitles('movie')).toEqual([]);
  expect(mockFiles.has(saved.uri)).toBe(false);
  expect(mockFiles.has(original)).toBe(true);
  expect(mockDelete).not.toHaveBeenCalledWith(original);
});

it('isolates episodes and providers while keeping an identity across server URLs', () => {
  const a = subtitleVideoKey({sourceLink: 'episode/1', link: 'https://server-a/video'}, {infoUrl: 'show'}, 'provider');
  const b = subtitleVideoKey({sourceLink: 'episode/1', link: 'https://server-b/video'}, {infoUrl: 'show'}, 'provider');
  expect(a).toBe(b);
  expect(a).not.toBe(subtitleVideoKey({sourceLink: 'episode/2'}, {infoUrl: 'show'}, 'provider'));
  expect(a).not.toBe(subtitleVideoKey({sourceLink: 'episode/1'}, {infoUrl: 'show'}, 'other-provider'));
  expect(subtitleVideoKey({link: 'file:///movies/one.mkv'}, {localContent: true}, '')).not.toBe('');
  expect(subtitleVideoKey(undefined, {}, '')).toBe('');
});

it('prunes files deleted by Android cache cleanup', async () => {
  const saved = await saveSubtitle('movie', track, 'search');
  mockFiles.delete(saved.uri);
  expect(await loadSavedSubtitles('movie')).toEqual([]);
  expect(mockStorage.has('savedSubtitles:v1')).toBe(false);
});

it('rejects failed downloads without leaving metadata or a partial file', async () => {
  mockDownload.mockImplementation(async (_from, to) => {mockFiles.set(to, {size: 500}); return {status: 403, uri: to};});
  await expect(saveSubtitle('movie', track, 'search')).rejects.toThrow('403');
  expect(mockFiles.size).toBe(0);
  expect(await loadSavedSubtitles('movie')).toEqual([]);
});

it('rejects oversized subtitles and cleans their partial copy', async () => {
  mockDownload.mockImplementation(async (_from, to) => {mockFiles.set(to, {size: 3 * 1024 * 1024}); return {status: 200, uri: to};});
  await expect(saveSubtitle('movie', track, 'search')).rejects.toThrow('2 MB');
  expect(mockFiles.size).toBe(0);
});

it('serializes concurrent additions and prevents duplicate downloads', async () => {
  const [a, b, c] = await Promise.all([
    saveSubtitle('movie', track, 'search'), saveSubtitle('movie', track, 'search'),
    saveSubtitle('movie', {...track, uri: 'https://subtitles.test/french.srt'}, 'search'),
  ]);
  expect(a.id).toBe(b.id); expect(c.id).not.toBe(a.id);
  expect(await loadSavedSubtitles('movie')).toHaveLength(2);
  expect(mockDownload).toHaveBeenCalledTimes(2);
});

it('bounds per-video storage and deletes the evicted copies', async () => {
  const first = await saveSubtitle('movie', track, 'search');
  for (let n = 0; n < 21; n++) await saveSubtitle('movie', {...track, uri: `https://subtitles.test/${n}.srt`}, 'search');
  expect(await loadSavedSubtitles('movie')).toHaveLength(20);
  expect(mockFiles.has(first.uri)).toBe(false);
});

it('cleans orphan cache copies after the app cache metadata is cleared', async () => {
  const old = await saveSubtitle('movie', track, 'search');
  mockStorage.clear();
  const next = await saveSubtitle('next', {...track, uri: 'https://subtitles.test/next.srt'}, 'search');
  expect(mockFiles.has(old.uri)).toBe(false);
  expect(mockFiles.has(next.uri)).toBe(true);
});

it('uses a unique native label to identify added files without confusing embedded language titles', async () => {
  const saved = await saveSubtitle('movie', {...track, title: 'English'}, 'search');
  const native = savedSubtitleTrack(saved);
  expect(findSavedSubtitle({title: native.title}, [saved])).toEqual(saved);
  expect(findSavedSubtitle({title: 'English', language: 'en'}, [saved])).toBeUndefined();
});

it('ignores tampered cache paths and never deletes outside its own files', async () => {
  mockStorage.set('savedSubtitles:v1', [{id: 'bad', videoKey: 'movie', uri: 'file:///cache/saved-subtitles/..'}]);
  await removeSavedSubtitle('movie', 'bad');
  expect(mockDelete).not.toHaveBeenCalled();
});
