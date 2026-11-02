import {
  getDownloadMediaKey,
  getTombstoneKey,
  MAX_SYNC_HISTORY_ITEMS,
  mergeSyncManifests,
  parseSyncManifest,
  type VegaSyncManifest,
} from '../src/lib/sync/manifest';

const manifest = (
  deviceId: string,
  overrides: Partial<VegaSyncManifest> = {},
): VegaSyncManifest => ({
  schemaVersion: 1,
  deviceId,
  revision: 1,
  generatedAt: 1,
  downloads: {},
  history: {},
  watchlist: {},
  tombstones: {},
  ...overrides,
});

describe('Vega sync manifest', () => {
  it('merges watchlist items from different devices', () => {
    const merged = mergeSyncManifests([
      manifest('mobile', {
        watchlist: {
          'mobile-link': {
            title: 'Mobile title',
            poster: 'mobile.jpg',
            link: 'mobile-link',
            provider: 'mobile-provider',
            updatedAt: 10,
          },
        },
      }),
      manifest('desktop', {
        watchlist: {
          'desktop-link': {
            title: 'Desktop title',
            poster: 'desktop.jpg',
            link: 'desktop-link',
            provider: 'desktop-provider',
            updatedAt: 20,
          },
        },
      }),
    ]);

    expect(Object.keys(merged.watchlist).sort()).toEqual([
      'desktop-link',
      'mobile-link',
    ]);
  });

  it('keeps a watchlist tombstone from resurrecting an older item', () => {
    const added = manifest('mobile', {
      watchlist: {
        movie: {
          title: 'Movie',
          poster: 'movie.jpg',
          link: 'movie',
          provider: 'provider',
          updatedAt: 10,
        },
      },
    });
    const removed = manifest('desktop', {
      tombstones: {
        [getTombstoneKey('watchlist', 'movie')]: {
          kind: 'watchlist',
          id: 'movie',
          deletedAt: 20,
        },
      },
    });

    expect(mergeSyncManifests([added, removed]).watchlist).toEqual({});
  });

  it('allows a newer watchlist add to replace an older removal', () => {
    const removed = manifest('mobile', {
      tombstones: {
        [getTombstoneKey('watchlist', 'movie')]: {
          kind: 'watchlist',
          id: 'movie',
          deletedAt: 10,
        },
      },
    });
    const readded = manifest('desktop', {
      watchlist: {
        movie: {
          title: 'Movie',
          poster: 'movie.jpg',
          link: 'movie',
          provider: 'provider',
          updatedAt: 20,
        },
      },
    });

    expect(mergeSyncManifests([removed, readded]).watchlist.movie).toEqual(
      readded.watchlist.movie,
    );
  });

  it('uses the newest saved playback position for an episode', () => {
    const older = manifest('mobile', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          link: '/show',
          progress: 120,
          duration: 1800,
          updatedAt: 10,
        },
      },
    });
    const newer = manifest('desktop', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          link: '/show',
          progress: 360,
          duration: 1800,
          updatedAt: 20,
        },
      },
    });

    expect(mergeSyncManifests([older, newer]).history.episode.progress).toBe(
      360,
    );
  });

  it('does not erase episode metadata when newer progress omits it', () => {
    const metadata = manifest('mobile', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          episodeTitle: 'Episode 4',
          episode: {
            id: 'episode',
            title: 'Episode 4',
            link: '/episode-4',
          },
          link: '/show',
          poster: 'poster.jpg',
          provider: 'provider',
          progress: 120,
          duration: 1800,
          updatedAt: 10,
        },
      },
    });
    const progressOnly = manifest('desktop', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          link: '/show',
          progress: 360,
          updatedAt: 20,
        },
      },
    });

    const merged = mergeSyncManifests([metadata, progressOnly]).history.episode;

    expect(merged.progress).toBe(360);
    expect(merged.episodeTitle).toBe('Episode 4');
    expect(merged.episode?.title).toBe('Episode 4');
    expect(merged.poster).toBe('poster.jpg');
    expect(merged.provider).toBe('provider');
    expect(merged.duration).toBe(1800);
  });

  it('keeps a history tombstone from resurrecting older playback', () => {
    const played = manifest('mobile', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          link: '/show',
          progress: 120,
          updatedAt: 10,
        },
      },
    });
    const removed = manifest('desktop', {
      tombstones: {
        [getTombstoneKey('history', 'episode')]: {
          kind: 'history',
          id: 'episode',
          deletedAt: 20,
        },
      },
    });

    expect(mergeSyncManifests([played, removed]).history).toEqual({});
  });

  it('allows playback saved after a history removal to win again', () => {
    const removed = manifest('mobile', {
      tombstones: {
        [getTombstoneKey('history', 'episode')]: {
          kind: 'history',
          id: 'episode',
          deletedAt: 10,
        },
      },
    });
    const replayed = manifest('desktop', {
      history: {
        episode: {
          id: 'episode',
          title: 'Show',
          link: '/show',
          progress: 45,
          updatedAt: 20,
        },
      },
    });

    expect(
      mergeSyncManifests([removed, replayed]).history.episode.progress,
    ).toBe(45);
  });

  it('syncs only the 50 most recently played episodes', () => {
    const history = Object.fromEntries(
      Array.from({length: 105}, (_, index) => [
        `episode-${index}`,
        {
          id: `episode-${index}`,
          title: `Episode ${index}`,
          link: '/show',
          progress: index,
          updatedAt: index,
        },
      ]),
    );

    const merged = mergeSyncManifests([manifest('mobile', {history})]);

    expect(Object.keys(merged.history)).toHaveLength(MAX_SYNC_HISTORY_ITEMS);
    expect(merged.history['episode-104']).toBeDefined();
    expect(merged.history['episode-0']).toBeUndefined();
  });

  it('deduplicates different platform ids for the same episode', () => {
    const mobileEpisode = {
      id: 'Show_SSeason 1_E1',
      title: 'Show Season 1 Episode 1',
      showName: 'Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 1',
      type: 'series' as const,
      imdbId: 'tt1234',
      provider: 'mobile-provider',
      relativePath: 'Episode_1.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
    };
    const desktopEpisode = {
      ...mobileEpisode,
      id: 'Show_SSeason 1_E01',
      seasonTitle: '1',
      provider: 'desktop-provider',
      relativePath: 'show/Episode_1.mp4',
      updatedAt: 20,
    };

    const merged = mergeSyncManifests([
      manifest('mobile', {downloads: {mobile: mobileEpisode}}),
      manifest('desktop', {downloads: {desktop: desktopEpisode}}),
    ]);

    expect(Object.values(merged.downloads)).toEqual([
      {...desktopEpisode, mediaKey: getDownloadMediaKey(desktopEpisode)},
    ]);
  });

  it('keeps distinct direct-link series episodes separate', () => {
    const baseEpisode = {
      title: 'Show episode',
      showName: 'Show',
      episodeName: 'Pilot',
      seasonTitle: 'Season 1',
      type: 'series' as const,
      imdbId: 'tt1234',
      relativePath: 'show/episode.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
    };

    expect(getDownloadMediaKey({...baseEpisode, id: 'Show_direct_0'})).not.toBe(
      getDownloadMediaKey({...baseEpisode, id: 'Show_direct_1'}),
    );
  });

  it('keeps subtitles separate from videos for the same episode', () => {
    const video = {
      id: 'Show_SSeason 1_E1',
      title: 'Show Episode 1',
      showName: 'Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 1',
      type: 'series' as const,
      imdbId: 'tt1234',
      relativePath: 'show/episode_1.mp4',
      totalBytes: 1000,
      completedAt: 10,
      updatedAt: 10,
    };
    const subtitle = {
      id: 'Show_SSeason 1_E1_subtitle_English',
      title: 'Show Episode 1 English Subtitle',
      showName: 'Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 1',
      type: 'series' as const,
      isSubtitle: true,
      imdbId: 'tt1234',
      relativePath: 'show/episode_1-english.srt',
      totalBytes: 20,
      completedAt: 20,
      updatedAt: 20,
    };

    expect(getDownloadMediaKey(video)).not.toBe(getDownloadMediaKey(subtitle));

    const merged = mergeSyncManifests([
      manifest('mobile', {
        downloads: {
          [video.id]: video,
          [subtitle.id]: subtitle,
        },
      }),
    ]);

    expect(Object.keys(merged.downloads).length).toBe(2);
    expect(Object.values(merged.downloads).some(d => d.id === video.id)).toBe(
      true,
    );
    expect(
      Object.values(merged.downloads).some(d => d.id === subtitle.id),
    ).toBe(true);
  });

  it('keeps a newer tombstone from resurrecting a download', () => {
    const episode = {
      id: 'mobile-id',
      title: 'Episode',
      type: 'series' as const,
      relativePath: 'show/episode.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
    };
    const completed = manifest('desktop', {
      downloads: {
        [episode.id]: episode,
      },
    });
    const deleted = manifest('mobile', {
      tombstones: {
        [getTombstoneKey('download', 'mobile-id')]: {
          kind: 'download',
          id: 'mobile-id',
          mediaKey: getDownloadMediaKey(episode),
          deletedAt: 20,
        },
      },
    });

    expect(mergeSyncManifests([completed, deleted]).downloads).toEqual({});
  });

  it('applies a canonical tombstone to a different platform id', () => {
    const episode = {
      id: 'desktop-id',
      title: 'Episode 1',
      showName: 'Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 1',
      type: 'series' as const,
      imdbId: 'tt1234',
      relativePath: 'show/episode.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
    };
    const mediaKey = getDownloadMediaKey(episode);
    const deleted = manifest('mobile', {
      tombstones: {
        'download:mobile-id': {
          kind: 'download',
          id: 'mobile-id',
          mediaKey,
          deletedAt: 20,
        },
      },
    });

    expect(
      mergeSyncManifests([manifest('desktop', {downloads: {episode}}), deleted])
        .downloads,
    ).toEqual({});
  });

  it('allows a newer completed event to replace an older deletion', () => {
    const deleted = manifest('mobile', {
      tombstones: {
        [getTombstoneKey('download', 'movie')]: {
          kind: 'download',
          id: 'movie',
          deletedAt: 10,
        },
      },
    });
    const completed = manifest('desktop', {
      downloads: {
        movie: {
          id: 'movie',
          title: 'Movie',
          type: 'movie',
          relativePath: 'movie.mp4',
          totalBytes: 100,
          completedAt: 20,
          updatedAt: 20,
        },
      },
    });

    expect(
      Object.values(mergeSyncManifests([deleted, completed]).downloads),
    ).toEqual([
      {
        ...completed.downloads.movie,
        mediaKey: getDownloadMediaKey(completed.downloads.movie),
      },
    ]);
  });

  it('merges library categories and keeps the newest edit', () => {
    const category = {
      id: 'c1',
      name: 'Horror',
      icon: 'ghost',
      createdAt: 5,
      updatedAt: 5,
    };
    const merged = mergeSyncManifests([
      manifest('mobile', {collections: {c1: category}}),
      manifest('desktop', {
        collections: {
          c1: {...category, name: 'Scary', icon: '👻', updatedAt: 9},
          c2: {...category, id: 'c2', name: 'Anime', createdAt: 7},
        },
      }),
    ]);

    expect(merged.collections.c1.name).toBe('Scary');
    expect(merged.collections.c1.icon).toBe('👻');
    expect(Object.keys(merged.collections).sort()).toEqual(['c1', 'c2']);
  });

  it('keeps a deleted library category from coming back', () => {
    const merged = mergeSyncManifests([
      manifest('mobile', {
        collections: {
          c1: {id: 'c1', name: 'Horror', icon: 'ghost', createdAt: 5, updatedAt: 5},
        },
      }),
      manifest('desktop', {
        tombstones: {
          [getTombstoneKey('collection', 'c1')]: {
            kind: 'collection',
            id: 'c1',
            deletedAt: 8,
          },
        },
      }),
    ]);

    expect(merged.collections).toEqual({});
  });

  it('syncs the categories of a saved title with the newest change', () => {
    const item = {
      title: 'Title',
      poster: '',
      link: 'movie',
      provider: 'provider',
    };
    const merged = mergeSyncManifests([
      manifest('mobile', {
        watchlist: {movie: {...item, collections: ['watchlist'], updatedAt: 5}},
      }),
      manifest('desktop', {
        watchlist: {movie: {...item, collections: ['c1', 'c2'], updatedAt: 9}},
      }),
    ]);

    expect(merged.watchlist.movie.collections).toEqual(['c1', 'c2']);
  });

  it('does not let a category tombstone remove a saved title', () => {
    const merged = mergeSyncManifests([
      manifest('mobile', {
        watchlist: {
          c1: {title: 'T', poster: '', link: 'c1', provider: 'p', updatedAt: 1},
        },
        tombstones: {
          [getTombstoneKey('collection', 'c1')]: {
            kind: 'collection',
            id: 'c1',
            deletedAt: 8,
          },
        },
      }),
    ]);

    expect(Object.keys(merged.watchlist)).toEqual(['c1']);
  });

  it('ignores malformed or unsupported manifests', () => {
    expect(parseSyncManifest('{bad json')).toBeNull();
    expect(parseSyncManifest('{"schemaVersion":2}')).toBeNull();
  });

  it('skips malformed records instead of failing the whole merge', () => {
    const movie = {
      id: 'movie',
      title: 'Movie',
      type: 'movie' as const,
      relativePath: 'movie.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
    };
    const broken = JSON.parse(
      JSON.stringify(
        manifest('desktop', {
          downloads: {movie},
          watchlist: {
            movie: {
              title: 'Movie',
              poster: '',
              link: 'movie',
              provider: 'p',
              updatedAt: 5,
            },
          },
        }),
      ),
    );
    broken.downloads.noId = {...movie, id: undefined};
    broken.downloads.nullItem = null;
    broken.watchlist.nullItem = null;
    broken.history.nullItem = null;
    broken.history.noTime = {id: 'noTime', title: 'T', link: '/t'};
    broken.collections = {nullItem: null};
    broken.tombstones.nullItem = null;
    broken.tombstones.noTime = {kind: 'watchlist', id: 'movie'};
    const parsed = parseSyncManifest(JSON.stringify(broken));
    expect(parsed).not.toBeNull();

    const merged = mergeSyncManifests([parsed!]);

    expect(Object.values(merged.downloads)).toEqual([
      {...movie, mediaKey: getDownloadMediaKey(movie)},
    ]);
    expect(Object.keys(merged.watchlist)).toEqual(['movie']);
    expect(merged.history).toEqual({});
    expect(merged.collections).toEqual({});
    expect(merged.tombstones).toEqual({});
  });

  it('accepts older manifests without a watchlist field', () => {
    const legacyManifest = manifest('legacy');
    delete legacyManifest.watchlist;

    expect(parseSyncManifest(JSON.stringify(legacyManifest))).toEqual(
      legacyManifest,
    );
    expect(mergeSyncManifests([legacyManifest]).watchlist).toEqual({});
  });

  it('recovers the first complete manifest from appended stale bytes', () => {
    const valid = JSON.stringify(manifest('mobile', {revision: 20}));
    expect(
      parseSyncManifest(`${valid}stale old json fragments}}}`)?.revision,
    ).toBe(20);
  });

  it('recomputes stale stored media keys while merging', () => {
    const episode = {
      id: 'Show_SSeason 7_E1',
      title: 'Episode 1',
      showName: 'Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 7',
      type: 'series' as const,
      imdbId: 'tt1234',
      relativePath: 'show/episode.mp4',
      totalBytes: 100,
      completedAt: 10,
      updatedAt: 10,
      mediaKey: 'series:tt1234:7:1',
    };
    const merged = mergeSyncManifests([
      manifest('mobile', {downloads: {episode}}),
    ]);

    expect(Object.keys(merged.downloads)).toEqual(['series:tt1234:7:i0']);
  });

  it('keeps the newest watch progress clear from any device', () => {
    expect(
      mergeSyncManifests([
        manifest('phone', {progressClearedAt: 200}),
        manifest('tv', {progressClearedAt: 500}),
        manifest('old-version'),
      ]).progressClearedAt,
    ).toBe(500);
    expect(mergeSyncManifests([manifest('phone')]).progressClearedAt).toBe(0);
  });
});
