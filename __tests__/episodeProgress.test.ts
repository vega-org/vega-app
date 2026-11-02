import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockSetProgress = jest.fn();
const mockSync = jest.fn();

jest.mock('../src/lib/storage', () => ({
  watchProgressStorage: {
    setProgress: (...args: unknown[]) => mockSetProgress(...args),
  },
}));
jest.mock('../src/lib/sync/syncService', () => ({
  setSyncedEpisodeProgress: (...args: unknown[]) => mockSync(...args),
}));

import {
  episodesUpTo,
  markEpisodesWatched,
} from '../src/lib/utils/episodeProgress';

const episodes = [1, 2, 3, 4, 5].map(n => ({
  title: `Episode ${n}`,
  link: `https://example.com/e${n}`,
}));

const sync = {
  title: 'Show',
  provider: 'vega',
  infoUrl: 'https://example.com/show',
  type: 'series',
  seasonTitle: 'Season 1',
};

const writtenLinks = () => mockSetProgress.mock.calls.map(call => call[0]);

describe('episodesUpTo', () => {
  it('includes every episode up to and including the link', () => {
    expect(episodesUpTo(episodes, episodes[2].link)).toEqual(
      episodes.slice(0, 3),
    );
  });

  it('handles the first and last episode', () => {
    expect(episodesUpTo(episodes, episodes[0].link)).toEqual([episodes[0]]);
    expect(episodesUpTo(episodes, episodes[4].link)).toEqual(episodes);
  });

  it('returns nothing for an unknown link', () => {
    expect(episodesUpTo(episodes, 'missing')).toEqual([]);
  });

  it('follows the list it is given, not a descending display order', () => {
    const descending = [...episodes].reverse();
    // The caller passes episode order; a reversed list would pick the wrong side.
    expect(episodesUpTo(episodes, episodes[1].link)).toEqual(
      episodes.slice(0, 2),
    );
    expect(episodesUpTo(descending, episodes[1].link)).toEqual(
      descending.slice(0, 4),
    );
  });
});

describe('markEpisodesWatched', () => {
  beforeEach(() => {
    mockSetProgress.mockClear();
    mockSync.mockClear();
  });

  it('writes watched progress for each episode and syncs only the last', () => {
    markEpisodesWatched(episodesUpTo(episodes, episodes[2].link), true, {
      sync,
    });

    expect(writtenLinks()).toEqual(episodes.slice(0, 3).map(e => e.link));
    mockSetProgress.mock.calls.forEach(call =>
      expect({position: call[1], duration: call[2]}).toEqual({
        position: 1,
        duration: 1,
      }),
    );
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith({
      ...sync,
      episode: episodes[2],
      position: 1,
      duration: 1,
    });
  });

  it('marks unwatched and syncs the chosen episode', () => {
    markEpisodesWatched(episodes, false, {sync, syncEpisode: episodes[1]});

    expect(writtenLinks()).toEqual(episodes.map(e => e.link));
    mockSetProgress.mock.calls.forEach(call =>
      expect({position: call[1], duration: call[2]}).toEqual({
        position: 0,
        duration: 1,
      }),
    );
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(
      expect.objectContaining({episode: episodes[1], position: 0}),
    );
  });

  it('does nothing for an empty list', () => {
    markEpisodesWatched([], true, {sync});

    expect(mockSetProgress).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});
