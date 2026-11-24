jest.mock('../src/lib/hooks/useSavedSubtitles', () => {
  const savedSubtitles: any[] = [];
  return {useSavedSubtitles: () => ({savedSubtitles, saveSubtitle: jest.fn(), removeSavedSubtitle: jest.fn()})};
});
jest.mock('../src/lib/subtitles/savedSubtitles', () => ({
  subtitleVideoKey: (episode: any) => episode?.sourceLink || episode?.id || episode?.link || '',
  savedSubtitleTrack: (track: any) => track,
}));
const mockGetStream = jest.fn();
let mockExcludedQualities = ['480p'];
const mockDownloads: Record<string, any> = {};

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (args: object) => mockGetStream(args)},
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getExcludedQualities: () => mockExcludedQualities},
}));
jest.mock('../src/lib/file/ifExists', () => ({ifExists: async () => null}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: async () => true,
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: mockDownloads})},
  isSubtitleDownloadItem: () => false,
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));

import {fetchStreamList} from '../src/lib/hooks/useStream';
import {canPromptWaf} from '../src/lib/services/wafSession';

const params = {primaryTitle: 'Show', type: 'series', providerValue: 'source'};
const episode = {link: 'https://provider.test/e1', title: 'Episode 1'};
const request = {episode, routeParams: params, provider: 'fallback'};
const hd = {
  server: 'HD',
  link: 'https://cdn.test/1080.mp4',
  type: 'mp4',
  quality: '1080',
};
const sd = {
  server: 'SD',
  link: 'https://cdn.test/480.mp4',
  type: 'mp4',
  quality: '480',
};
const local = {server: 'Downloaded', link: '/downloads/e1.mkv', type: 'mp4'};

beforeEach(() => {
  mockExcludedQualities = ['480p'];
  for (const key of Object.keys(mockDownloads)) delete mockDownloads[key];
  mockGetStream.mockReset().mockResolvedValue([hd, sd]);
});
afterEach(() => jest.restoreAllMocks());

const download = () => {
  mockDownloads.e1 = {
    id: 'e1',
    status: 'completed',
    filePath: local.link,
    sourceLink: episode.link,
  };
};

it('loads the provider servers without excluded qualities', async () => {
  await expect(fetchStreamList(request)).resolves.toEqual([hd]);
  expect(mockGetStream).toHaveBeenCalledWith({
    link: episode.link,
    type: 'series',
    signal: expect.any(AbortSignal),
    providerValue: 'source',
  });
});

it('excludes 1080p and 4K across provider quality labels', async () => {
  mockExcludedQualities = ['1080p', '4K'];
  const excluded = ['1080', '1080p', '4k', '2160', '2160p'].map(quality => ({
    server: quality,
    link: `https://cdn.test/${quality}.mp4`,
    type: 'mp4',
    quality,
  }));
  mockGetStream.mockResolvedValue([...excluded, sd]);
  await expect(fetchStreamList(request)).resolves.toEqual([sd]);
});

it('lists a download first and reports it before the servers load', async () => {
  download();
  const onLocalStream = jest.fn();
  mockGetStream.mockImplementation(async () => {
    expect(onLocalStream).toHaveBeenCalledWith(local);
    return [hd];
  });
  await expect(fetchStreamList({...request, onLocalStream})).resolves.toEqual([
    local,
    hd,
  ]);
});

it('keeps a download when the servers fail and drops it once it failed to play', async () => {
  download();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockGetStream.mockRejectedValue(new Error('Provider offline'));
  await expect(fetchStreamList(request)).resolves.toEqual([local]);
  mockGetStream.mockResolvedValue([hd]);
  await expect(
    fetchStreamList({...request, isLocalFailed: () => true}),
  ).resolves.toEqual([hd]);
});

it('plays imported local content without provider work', async () => {
  const file = {link: 'content://tree/document/e1.mkv', title: 'Episode 1'};
  await expect(
    fetchStreamList({
      ...request,
      episode: file,
      routeParams: {...params, localContent: true},
    }),
  ).resolves.toEqual([{server: 'Local file', link: file.link, type: 'local'}]);
  expect(mockGetStream).not.toHaveBeenCalled();
});

it('plays a video opened from another app without provider work', async () => {
  const uri = 'https://cdn.test/opened.mp4';
  await expect(
    fetchStreamList({
      ...request,
      episode: {link: uri},
      routeParams: {
        ...params,
        localContent: true,
        directUrl: uri,
        externalVideo: {mimeType: 'video/mp4'},
      },
    }),
  ).resolves.toEqual([{server: 'Opened video', link: uri, type: ''}]);
  expect(mockGetStream).not.toHaveBeenCalled();
});

it("cancels the provider request with the caller's signal", async () => {
  const caller = new AbortController();
  mockGetStream.mockImplementation(
    ({signal}: {signal: AbortSignal}) =>
      new Promise((_, reject) => {
        const fail = () => reject(new Error('Aborted'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail);
      }),
  );
  const result = fetchStreamList({...request, signal: caller.signal});
  caller.abort();
  await expect(result).rejects.toThrow('Aborted');
});

it('keeps only guarded requests from prompting a WAF challenge', async () => {
  let allowed = false;
  const signals: AbortSignal[] = [];
  mockGetStream.mockImplementation(async ({signal}: {signal: AbortSignal}) => {
    signals.push(signal);
    return [hd];
  });
  await fetchStreamList(request);
  await fetchStreamList({...request, canPromptWaf: () => allowed});
  expect(canPromptWaf(signals[0])).toBe(true);
  expect(canPromptWaf(signals[1])).toBe(false);
  allowed = true;
  expect(canPromptWaf(signals[1])).toBe(true);
});
