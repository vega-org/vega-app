import {
  groupCompletedDownloads,
  sortDownloadedEpisodes,
} from '../src/lib/downloadLibrary';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

const createItem = (update: Partial<DownloadItem>): DownloadItem => ({
  schemaVersion: 1,
  id: 'item',
  title: 'Title',
  type: 'series',
  url: 'https://example.com/video',
  sourceType: 'http',
  isTorrent: false,
  filePath: 'content://downloads/item',
  totalBytes: 100,
  downloadedBytes: 100,
  speed: 0,
  status: 'completed',
  canPause: false,
  canResume: false,
  createdAt: 1,
  updatedAt: 1,
  ...update,
});

describe('downloaded library grouping', () => {
  it('groups series by stored media metadata instead of filename', () => {
    const groups = groupCompletedDownloads([
      createItem({
        id: 'Show_SSeason 1_E2',
        showName: 'Show',
        episodeName: 'Second',
      }),
      createItem({
        id: 'Show_SSeason 1_E1',
        showName: 'Show',
        episodeName: 'First',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Show');
    expect(groups[0].items[0]).toMatchObject({
      showName: 'Show',
      episodeName: 'First',
    });
    expect(groups[0].items.map(item => item.episodeName)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('groups the same series when provider and IMDb metadata differ', () => {
    const groups = groupCompletedDownloads([
      createItem({
        id: 'Show_SSeason 7_E1',
        showName: 'Rick and Morty',
        seasonTitle: 'Season 7',
        imdbId: 'tt2861424',
        provider: 'vega',
      }),
      createItem({
        id: 'Show_SSeason 9_E1',
        showName: 'Rick and Morty',
        seasonTitle: 'Season 9',
        imdbId: undefined,
        provider: 'torrentio',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'media:rick-and-morty',
      title: 'Rick and Morty',
    });
    expect(groups[0].items).toHaveLength(2);
  });

  it('groups misclassified movie episodes by their logical title', () => {
    const groups = groupCompletedDownloads([
      createItem({
        id: 'LIAR_GAME_direct_1',
        title: 'LIAR GAME Episode-12',
        showName: 'LIAR GAME',
        seasonTitle: 'Season 1 - English',
        episodeName: 'Episode-12',
        type: 'movie',
        imdbId: undefined,
      }),
      createItem({
        id: 'LIAR_GAME_direct_0',
        title: 'LIAR GAME Episode-11',
        showName: 'LIAR GAME',
        seasonTitle: 'Season 1 - English',
        episodeName: 'Episode-11',
        type: 'movie',
        imdbId: undefined,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'media:liar-game',
      title: 'LIAR GAME',
    });
    expect(groups[0].items.map(item => item.episodeName)).toEqual([
      'Episode-11',
      'Episode-12',
    ]);
  });

  it('keeps quality and language variants inside the same title group', () => {
    const groups = groupCompletedDownloads([
      createItem({
        id: 'Movie_direct_0',
        title: 'Movie 1080p English',
        showName: 'Movie',
        seasonTitle: '1080p - English',
        episodeName: 'English',
        type: 'movie',
      }),
      createItem({
        id: 'Movie_direct_1',
        title: 'Movie 720p Hindi',
        showName: 'Movie',
        seasonTitle: '720p - Hindi',
        episodeName: 'Hindi',
        type: 'movie',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(item => item.seasonTitle).sort()).toEqual([
      '1080p - English',
      '720p - Hindi',
    ]);
  });

  it('keeps unrelated movie titles in separate groups', () => {
    const groups = groupCompletedDownloads([
      createItem({id: 'Movie_A_direct_0', title: 'Movie A', type: 'movie'}),
      createItem({id: 'Movie_B_direct_0', title: 'Movie B', type: 'movie'}),
    ]);

    expect(groups.map(group => group.title).sort()).toEqual([
      'Movie A',
      'Movie B',
    ]);
  });

  it('excludes subtitle download items from groups', () => {
    const groups = groupCompletedDownloads([
      createItem({
        id: 'Show_SSeason 1_E1',
        showName: 'Show',
        episodeName: 'Episode 1',
      }),
      createItem({
        id: 'Show_SSeason 1_E1_subtitle_English',
        showName: 'Show',
        episodeName: 'Episode 1',
        title: 'Show Episode 1 English Subtitle',
        isSubtitle: true,
        videoType: 'vtt',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].id).toBe('Show_SSeason 1_E1');
  });

  it('sorts episodes using the stable download ID', () => {
    const sorted = sortDownloadedEpisodes([
      createItem({id: 'Show_SSeason 2_E1', seasonTitle: 'Season 2'}),
      createItem({id: 'Show_SSeason 1_E3', seasonTitle: 'Season 1'}),
    ]);
    expect(sorted.map(item => item.id)).toEqual([
      'Show_SSeason 1_E3',
      'Show_SSeason 2_E1',
    ]);
  });

  it('sorts legacy index-id episode using its parsed episodeName number', () => {
    const legacyE4 = createItem({
      id: 'Dexter_SSeason 2_E1',
      seasonTitle: 'Season 2',
      episodeName: 'S2 E4 · Live Free and Die',
      episodeIndex: undefined,
    });
    const newE5 = createItem({
      id: 'Dexter_SSeason 2_E5',
      seasonTitle: 'Season 2',
      episodeName: 'S2 E5 · Panick Attack',
      episodeIndex: undefined,
    });
    const sorted = sortDownloadedEpisodes([newE5, legacyE4]);
    expect(sorted.map(item => item.episodeName)).toEqual([
      'S2 E4 · Live Free and Die',
      'S2 E5 · Panick Attack',
    ]);
  });

  it('sorts episodes using explicit provider episodeIndex regardless of completion order', () => {
    const sorted = sortDownloadedEpisodes([
      createItem({
        id: 'Show_custom_b',
        title: 'Special OVA Part Two',
        episodeIndex: 1,
        seasonTitle: 'Season 1',
        createdAt: 100,
      }),
      createItem({
        id: 'Show_custom_a',
        title: 'Special OVA Part One',
        episodeIndex: 0,
        seasonTitle: 'Season 1',
        createdAt: 200,
      }),
    ]);
    expect(sorted.map(item => item.id)).toEqual([
      'Show_custom_a',
      'Show_custom_b',
    ]);
  });
});
