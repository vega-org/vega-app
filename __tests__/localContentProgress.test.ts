import {
  markLocalEpisodesWatched,
  readLocalProgress,
} from '../src/lib/localContent/progress';
import {getLocalResume} from '../src/lib/localContent/playback';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
import type {LocalTitle} from '../src/lib/localContent/model';
const mockCache = new Map<string, string>();
jest.mock('../src/lib/storage', () => ({
  cacheStorage: {
    getString: (key: string) => mockCache.get(key),
    setString: (key: string, value: string) => mockCache.set(key, value),
  },
}));
jest.mock('../src/lib/storage/StorageService', () => ({
  createZustandStorage: () => ({
    getItem: () => null,
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }),
}));
const title: LocalTitle = {
  id: 'show',
  name: 'Show',
  rootUri: 'root',
  folderUri: 'folder',
  useMetadataTitles: false,
  episodes: [1, 2, 3].map(index => ({
    uri: `content://episode/${index}`,
    name: `Episode ${index}`,
    folder: 'Season 1',
  })),
};
beforeEach(() => {
  mockCache.clear();
  useLocalContentStore.setState({titles: [title]});
});
it('marks selected local episodes and moves resume forward without changing the files', () => {
  markLocalEpisodesWatched(
    title,
    title.episodes.slice(0, 2).map(episode => episode.uri),
    true,
  );
  const saved = useLocalContentStore.getState().titles[0];
  expect(readLocalProgress(title.episodes[0].uri)).toEqual({
    position: 1,
    duration: 1,
  });
  expect(getLocalResume(saved, readLocalProgress)?.episode.uri).toBe(
    title.episodes[2].uri,
  );
  expect(saved.episodes).toEqual(title.episodes);
});
it('marking unwatched replaces the old resume record as well as cached progress', () => {
  useLocalContentStore
    .getState()
    .savePlayback(title.id, title.episodes[0].uri, 99, 100);
  markLocalEpisodesWatched(
    useLocalContentStore.getState().titles[0],
    [title.episodes[0].uri],
    false,
  );
  expect(
    getLocalResume(
      useLocalContentStore.getState().titles[0],
      readLocalProgress,
    ),
  ).toMatchObject({episode: {uri: title.episodes[0].uri}, position: 0});
});
it('does not write unknown URIs or crash on malformed stored progress', () => {
  markLocalEpisodesWatched(title, ['content://other'], true);
  expect(mockCache.size).toBe(0);
  expect(useLocalContentStore.getState().titles[0].playback).toBeUndefined();
  mockCache.set(title.episodes[0].uri, '{broken');
  expect(readLocalProgress(title.episodes[0].uri)).toEqual({
    position: 0,
    duration: 0,
  });
});
