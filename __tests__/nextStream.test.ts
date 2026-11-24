jest.mock('../src/lib/hooks/useSavedSubtitles', () => {
  const savedSubtitles: any[] = [];
  return {useSavedSubtitles: () => ({savedSubtitles, saveSubtitle: jest.fn(), removeSavedSubtitle: jest.fn()})};
});
jest.mock('../src/lib/subtitles/savedSubtitles', () => ({
  subtitleVideoKey: (episode: any) => episode?.sourceLink || episode?.id || episode?.link || '',
  savedSubtitleTrack: (track: any) => track,
}));
import {describe, expect, it, jest} from '@jest/globals';

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {},
}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {}}));
jest.mock('../src/lib/file/ifExists', () => ({ifExists: jest.fn()}));
jest.mock('../src/lib/downloadDestination', () => ({
  downloadOutputExists: jest.fn(),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: {getState: () => ({downloads: {}})},
}));
jest.mock('react-native-video', () => ({TextTrackType: {}}));

import {getNextStream} from '../src/lib/hooks/useStream';

const streams = [
  {server: 'Downloaded', link: '/files/movie.mp4', type: 'mp4'},
  {server: 'Server 1', link: 'https://example.com/1.m3u8', type: 'm3u8'},
  {server: 'Server 2', link: 'https://example.com/2.m3u8', type: 'm3u8'},
];

describe('getNextStream', () => {
  it('finds the current stream by link, not by object', () => {
    const current = {...streams[0]};

    expect(getNextStream(streams, current)).toBe(streams[1]);
  });

  it('moves forward after a refetch returns new objects', () => {
    const refetched = streams.map(stream => ({...stream}));

    expect(getNextStream(refetched, streams[1])).toBe(refetched[2]);
  });

  it('returns nothing after the last stream', () => {
    expect(getNextStream(streams, streams[2])).toBeUndefined();
  });
});
