import {describe, expect, it} from '@jest/globals';
import {
  getContinueWatchingAfterMark,
  getContinueWatchingRow,
  getNextEpisode,
  getUpNextItem,
  isWatched,
  type ManualWatchContext,
} from '../src/lib/player/upNext';
import type {ContinueWatchingItem} from '../src/lib/zustand/continueWatchingStore';

const episode = (number: number) => ({
  title: `Episode ${number}`,
  link: `https://example.com/show/${number}`,
});

const entry = (
  overrides: Partial<ContinueWatchingItem> = {},
): ContinueWatchingItem => ({
  id: 'show',
  title: 'Show',
  episodeTitle: 'Episode 4',
  seasonTitle: 'Season 1',
  episode: episode(4),
  type: 'series',
  providerValue: 'vega',
  infoUrl: 'show',
  position: 1100,
  duration: 1200,
  updatedAt: 1000,
  ...overrides,
});

describe('isWatched', () => {
  it('counts an episode as watched past 85%, like the episode list', () => {
    expect(isWatched(850, 1000)).toBe(false);
    expect(isWatched(851, 1000)).toBe(true);
    expect(isWatched(1, 1)).toBe(true);
    expect(isWatched(0, 1)).toBe(false);
  });

  it('is false without a usable duration', () => {
    expect(isWatched(100, 0)).toBe(false);
    expect(isWatched(NaN, 100)).toBe(false);
    expect(isWatched(100, Infinity)).toBe(false);
  });
});

describe('getNextEpisode', () => {
  const list = [episode(1), episode(2), episode(3)];

  it('returns the episode after the current one', () => {
    expect(getNextEpisode(list, list[1])).toBe(list[2]);
    expect(getNextEpisode(list, {...episode(1)})).toBe(list[1]);
  });

  it('returns nothing at the end of the list or for an unknown episode', () => {
    expect(getNextEpisode(list, list[2])).toBeUndefined();
    expect(getNextEpisode(list, episode(9))).toBeUndefined();
    expect(getNextEpisode(undefined, list[0])).toBeUndefined();
    expect(getNextEpisode(list, undefined)).toBeUndefined();
  });
});

describe('getUpNextItem', () => {
  it('moves a watched episode on to the next one from the start', () => {
    expect(
      getUpNextItem(entry(), episode(4), episode(5), undefined, 2000),
    ).toEqual(
      entry({
        episode: episode(5),
        episodeTitle: 'Episode 5',
        position: 0,
        duration: 0,
        updatedAt: 2000,
      }),
    );
  });

  it('keeps the saved progress of a partly watched next episode', () => {
    const next = getUpNextItem(
      entry(),
      episode(4),
      episode(5),
      {position: 600, duration: 1300},
      2000,
    );
    expect(next).toMatchObject({position: 600, duration: 1300});
  });

  it('stays put when the next episode is already watched', () => {
    const item = entry();
    expect(
      getUpNextItem(
        item,
        episode(4),
        episode(5),
        {position: 1, duration: 1},
        2000,
      ),
    ).toBe(item);
  });

  it('changes nothing below the watched threshold', () => {
    const item = entry({position: 1000});
    expect(getUpNextItem(item, episode(4), episode(5), undefined, 2000)).toBe(
      item,
    );
  });

  it('leaves movies and the last episode in place', () => {
    const movie = entry({type: 'movie'});
    expect(getUpNextItem(movie, episode(4), episode(5), undefined, 2000)).toBe(
      movie,
    );
    const last = entry();
    expect(getUpNextItem(last, episode(4), undefined, undefined, 2000)).toBe(
      last,
    );
  });

  it('does nothing once the entry has moved on', () => {
    const next = getUpNextItem(
      entry(),
      episode(4),
      episode(5),
      undefined,
      2000,
    );
    expect(getUpNextItem(next, episode(4), episode(5), undefined, 3000)).toBe(
      next,
    );
  });

  it('is newer than the last save even when the clock is behind', () => {
    const next = getUpNextItem(entry(), episode(4), episode(5), undefined, 500);
    expect(next.updatedAt).toBe(1001);
  });
});

describe('getContinueWatchingRow', () => {
  it('hides watched movies and sorts the rest by last update', () => {
    const upNext = entry({
      id: 'up-next',
      position: 0,
      duration: 0,
      updatedAt: 3,
    });
    const halfway = entry({id: 'halfway', position: 600, updatedAt: 2});
    const watchedMovie = entry({id: 'movie', type: 'movie', updatedAt: 4});
    const noProvider = entry({id: 'old', providerValue: '', position: 0});
    const seasonEnd = entry({id: 'season-end', updatedAt: 1});

    expect(
      getContinueWatchingRow([
        halfway,
        watchedMovie,
        upNext,
        noProvider,
        seasonEnd,
      ]).map(item => item.id),
    ).toEqual(['up-next', 'halfway', 'season-end']);
  });
});

describe('getContinueWatchingAfterMark', () => {
  const season = [1, 2, 3, 4, 5].map(episode);

  const context = (
    overrides: Partial<ManualWatchContext> = {},
  ): ManualWatchContext => ({
    id: 'show',
    title: 'Show',
    providerValue: 'vega',
    infoUrl: 'show',
    type: 'series',
    seasonTitle: 'Season 1',
    seasonEpisodes: season,
    markedEpisodes: [episode(4)],
    watched: true,
    readProgress: () => null,
    now: 2000,
    ...overrides,
  });

  it('advances an existing series entry to the next unwatched episode', () => {
    const current = entry({position: 300, duration: 1200});
    expect(getContinueWatchingAfterMark(current, context())).toEqual(
      entry({
        episode: episode(5),
        episodeTitle: 'Episode 5',
        position: 0,
        duration: 0,
        updatedAt: 2000,
      }),
    );
  });

  it('skips already-watched episodes and keeps partial resume progress on the next', () => {
    const current = entry({
      episode: episode(2),
      episodeTitle: 'Episode 2',
      position: 100,
      duration: 1200,
    });
    const progress = new Map([
      [episode(3).link, {position: 1, duration: 1}],
      [episode(4).link, {position: 450, duration: 1200}],
    ]);
    const updated = getContinueWatchingAfterMark(
      current,
      context({
        markedEpisodes: [episode(2)],
        readProgress: link => progress.get(link),
      }),
    );
    expect(updated).toMatchObject({
      episode: episode(4),
      episodeTitle: 'Episode 4',
      position: 450,
      duration: 1200,
      updatedAt: 2000,
    });
  });

  it('advances after marking previous episodes as watched', () => {
    const current = entry({
      episode: episode(1),
      episodeTitle: 'Episode 1',
      position: 200,
      duration: 1200,
    });
    const updated = getContinueWatchingAfterMark(
      current,
      context({markedEpisodes: season.slice(0, 3)}),
    );
    expect(updated).toMatchObject({
      episode: episode(4),
      episodeTitle: 'Episode 4',
      position: 0,
      duration: 0,
    });
  });

  it('creates an entry for a new series when a next unwatched episode exists', () => {
    const updated = getContinueWatchingAfterMark(
      undefined,
      context({markedEpisodes: [episode(1)]}),
    );
    expect(updated).toMatchObject({
      id: 'show',
      episode: episode(2),
      episodeTitle: 'Episode 2',
      position: 0,
      duration: 0,
      updatedAt: 2000,
    });
  });

  it('does not add a new series when all episodes or the last episode are marked watched', () => {
    expect(
      getContinueWatchingAfterMark(
        undefined,
        context({markedEpisodes: season}),
      ),
    ).toBeUndefined();
    expect(
      getContinueWatchingAfterMark(
        undefined,
        context({markedEpisodes: [episode(5)]}),
      ),
    ).toBeUndefined();
  });

  it('updates an existing series to the last episode when all episodes are marked watched', () => {
    const current = entry({
      episode: episode(2),
      episodeTitle: 'Episode 2',
      position: 300,
      duration: 1200,
    });
    expect(
      getContinueWatchingAfterMark(current, context({markedEpisodes: season})),
    ).toMatchObject({
      episode: episode(5),
      episodeTitle: 'Episode 5',
      position: 1,
      duration: 1,
    });
  });

  it('does not move Continue Watching backward when an earlier episode is marked watched', () => {
    const current = entry({
      episode: episode(4),
      position: 300,
      duration: 1200,
    });
    expect(
      getContinueWatchingAfterMark(
        current,
        context({markedEpisodes: [episode(1)]}),
      ),
    ).toBe(current);
  });

  it('marks a movie watched so Continue Watching hides it, and resets on unwatched', () => {
    const movie = entry({
      type: 'movie',
      episode: episode(1),
      episodeTitle: 'Show',
      position: 600,
      duration: 7200,
    });
    const watchedMovie = getContinueWatchingAfterMark(
      movie,
      context({
        type: 'movie',
        seasonEpisodes: [episode(1)],
        markedEpisodes: [episode(1)],
        watched: true,
      }),
    );
    expect(watchedMovie).toMatchObject({position: 7200, duration: 7200});
    expect(getContinueWatchingRow([watchedMovie!])).toEqual([]);

    const unwatchedMovie = getContinueWatchingAfterMark(
      watchedMovie,
      context({
        type: 'movie',
        seasonEpisodes: [episode(1)],
        markedEpisodes: [episode(1)],
        watched: false,
        now: 3000,
      }),
    );
    expect(unwatchedMovie).toMatchObject({position: 0, duration: 0});
    expect(getContinueWatchingRow([unwatchedMovie!])).toEqual([unwatchedMovie]);
  });

  it('rewinds to an earlier unwatched episode when the current entry has no active progress', () => {
    const upNext = entry({
      episode: episode(5),
      episodeTitle: 'Episode 5',
      position: 0,
      duration: 0,
    });
    const rewound = getContinueWatchingAfterMark(
      upNext,
      context({markedEpisodes: [episode(4)], watched: false}),
    );
    expect(rewound).toMatchObject({
      episode: episode(4),
      episodeTitle: 'Episode 4',
      position: 0,
      duration: 0,
    });
  });

  it('keeps active mid-episode progress when an earlier episode is marked unwatched', () => {
    const active = entry({
      episode: episode(5),
      episodeTitle: 'Episode 5',
      position: 600,
      duration: 1200,
    });
    expect(
      getContinueWatchingAfterMark(
        active,
        context({markedEpisodes: [episode(1)], watched: false}),
      ),
    ).toBe(active);
  });

  it('resets to the first episode when all episodes are marked unwatched', () => {
    const current = entry({
      episode: episode(4),
      position: 600,
      duration: 1200,
    });
    expect(
      getContinueWatchingAfterMark(
        current,
        context({markedEpisodes: season, watched: false}),
      ),
    ).toMatchObject({
      episode: episode(1),
      episodeTitle: 'Episode 1',
      position: 0,
      duration: 0,
    });
  });

  it('does not add a show when marking unwatched', () => {
    expect(
      getContinueWatchingAfterMark(
        undefined,
        context({markedEpisodes: [episode(1)], watched: false}),
      ),
    ).toBeUndefined();
  });
});
