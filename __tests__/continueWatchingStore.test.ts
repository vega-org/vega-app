jest.mock('../src/lib/storage/StorageService', () => ({createZustandStorage: () => ({getItem: () => null, setItem: jest.fn(), removeItem: jest.fn()})}));
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }

    initialize() {
      return {
        getString: () => undefined,
        setString: () => undefined,
        getBool: () => undefined,
        setBool: () => undefined,
        getInt: () => undefined,
        setInt: () => undefined,
        removeItem: () => undefined,
        clearStore: () => undefined,
      };
    }
  },
}));

import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../src/lib/zustand/continueWatchingStore';

const createItem = (id: string, updatedAt: number): ContinueWatchingItem => ({
  id,
  title: id,
  episode: {title: 'Episode 1', link: `https://example.com/${id}`},
  type: 'series',
  providerValue: 'vega',
  infoUrl: id,
  position: 0,
  duration: 0,
  updatedAt,
});

describe('continue watching store', () => {
  beforeEach(() => {
    useContinueWatchingStore.setState({items: []});
  });

  it('keeps a new show when the list is already full', () => {
    useContinueWatchingStore.setState({
      items: Array.from({length: 30}, (_, index) =>
        createItem(`old-${index}`, 1000 - index),
      ),
    });

    const {upsertItem, updateProgress} = useContinueWatchingStore.getState();
    upsertItem(createItem('new-show', 0));
    updateProgress('new-show', 60, 1200);

    const items = useContinueWatchingStore.getState().items;
    expect(items).toHaveLength(30);
    expect(items[0]).toMatchObject({id: 'new-show', position: 60});
    expect(items.some(item => item.id === 'old-29')).toBe(false);
  });

  it('replaces an existing entry for the same show', () => {
    const {upsertItem} = useContinueWatchingStore.getState();
    upsertItem(createItem('show', 10));
    upsertItem(createItem('show', 20));

    expect(useContinueWatchingStore.getState().items).toEqual([
      createItem('show', 20),
    ]);
  });

  it('does not write progress onto a different episode', () => {
    const {upsertItem, updateProgress} = useContinueWatchingStore.getState();
    upsertItem({
      ...createItem('show', 10),
      episode: {title: 'Episode 3', link: 'https://example.com/e3'},
      position: 1200,
      duration: 2400,
    });

    updateProgress('show', 900, 2400, {
      title: 'Episode 4',
      link: 'https://example.com/e4',
    });

    expect(useContinueWatchingStore.getState().items[0]).toMatchObject({
      episode: {link: 'https://example.com/e3'},
      position: 1200,
      updatedAt: 10,
    });

    updateProgress('show', 1300, 2400, {
      title: 'Episode 3',
      link: 'https://example.com/e3',
    });

    expect(useContinueWatchingStore.getState().items[0]).toMatchObject({
      position: 1300,
    });
  });

  describe('finishing an episode', () => {
    const episode4 = {title: 'Episode 4', link: 'https://example.com/e4'};
    const episode5 = {title: 'Episode 5', link: 'https://example.com/e5'};
    const watchedEpisode4 = (): ContinueWatchingItem => ({
      ...createItem('show', 10),
      seasonTitle: 'Season 1',
      episode: episode4,
      position: 2300,
      duration: 2400,
    });

    it('moves the show on to the next episode', () => {
      const {upsertItem, finishEpisode} = useContinueWatchingStore.getState();
      upsertItem(watchedEpisode4());
      upsertItem(createItem('other', 20));
      const before = Date.now();

      expect(finishEpisode('show', episode4, episode5)).toBe(true);

      const [first, second] = useContinueWatchingStore.getState().items;
      expect(first).toMatchObject({
        id: 'show',
        episode: episode5,
        episodeTitle: 'Episode 5',
        seasonTitle: 'Season 1',
        position: 0,
        duration: 0,
      });
      expect(first.updatedAt).toBeGreaterThanOrEqual(before);
      expect(second.id).toBe('other');
    });

    it('changes nothing before the episode counts as watched', () => {
      const {upsertItem, finishEpisode} = useContinueWatchingStore.getState();
      upsertItem({...watchedEpisode4(), position: 2000});

      expect(finishEpisode('show', episode4, episode5)).toBe(false);
      expect(useContinueWatchingStore.getState().items).toEqual([
        {...watchedEpisode4(), position: 2000},
      ]);
    });

    it('keeps a watched movie or last episode where it is', () => {
      const {upsertItem, finishEpisode} = useContinueWatchingStore.getState();
      const movie = {...watchedEpisode4(), id: 'movie', type: 'movie'};
      upsertItem(movie);
      upsertItem(watchedEpisode4());

      expect(finishEpisode('movie', episode4, episode5)).toBe(false);
      expect(finishEpisode('show', episode4)).toBe(false);
      expect(finishEpisode('missing', episode4, episode5)).toBe(false);
      expect(useContinueWatchingStore.getState().items).toEqual([
        watchedEpisode4(),
        movie,
      ]);
    });

    it('moves on only once', () => {
      const {upsertItem, updateProgress, finishEpisode} =
        useContinueWatchingStore.getState();
      upsertItem(watchedEpisode4());
      finishEpisode('show', episode4, episode5);
      const items = useContinueWatchingStore.getState().items;

      expect(finishEpisode('show', episode4, episode5)).toBe(false);
      expect(useContinueWatchingStore.getState().items).toBe(items);

      // The credits of the watched episode keep reporting progress.
      updateProgress('show', 2390, 2400, episode4);
      expect(useContinueWatchingStore.getState().items).toEqual(items);
    });
  });
});

describe('live channel recency', () => {
  beforeEach(() => useContinueWatchingStore.setState({items: []}));
  it('moves a live channel ahead of previously watched titles without resume progress', () => {
    const channel = createItem('live', 0);
    useContinueWatchingStore.setState({items: [createItem('movie', 100), channel]});
    useContinueWatchingStore.getState().recordLivePlayback('live', channel.episode);
    const first = useContinueWatchingStore.getState().items[0];
    expect(first).toMatchObject({id: 'live', position: 0, duration: 0});
    expect(first.updatedAt).toBeGreaterThan(100);
  });
  it('clears obsolete DVR progress and throttles repeated activity writes', () => {
    const channel = {...createItem('live', 0), position: 90, duration: 100};
    useContinueWatchingStore.setState({items: [channel]});
    const store = useContinueWatchingStore.getState();
    store.recordLivePlayback('live', channel.episode);
    const recorded = useContinueWatchingStore.getState().items;
    expect(recorded[0]).toMatchObject({position: 0, duration: 0});
    store.recordLivePlayback('live', channel.episode);
    expect(useContinueWatchingStore.getState().items).toBe(recorded);
  });
  it('ignores stale episode callbacks and removed channels', () => {
    const channel = createItem('live', 0);
    useContinueWatchingStore.setState({items: [channel]});
    const before = useContinueWatchingStore.getState().items;
    useContinueWatchingStore.getState().recordLivePlayback('live', {title: 'other', link: 'other'});
    useContinueWatchingStore.getState().recordLivePlayback('removed', channel.episode);
    expect(useContinueWatchingStore.getState().items).toBe(before);
  });
});

it('immediately promotes a recently revisited channel even within the write throttle', () => {
  const now = Date.now();
  const channel = createItem('live', now - 500);
  useContinueWatchingStore.setState({items: [createItem('movie', now - 100), channel]});
  useContinueWatchingStore.getState().recordLivePlayback('live', channel.episode);
  expect(useContinueWatchingStore.getState().items[0].id).toBe('live');
});
