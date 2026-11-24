import {findEpisodeDownload} from '../src/lib/downloadLibrary';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

const createItem = (update: Partial<DownloadItem>): DownloadItem => ({
  schemaVersion: 1,
  id: 'default-id',
  title: 'Default Title',
  type: 'series',
  url: 'https://example.com/video.mp4',
  sourceType: 'http',
  isTorrent: false,
  filePath: '/downloads/default.mp4',
  totalBytes: 1000,
  downloadedBytes: 1000,
  speed: 0,
  status: 'completed',
  canPause: false,
  ...update,
});

describe('findEpisodeDownload', () => {
  it('matches by downloadId (priority a)', () => {
    const itemA = createItem({
      id: 'Series_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/old-link',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 1',
    });
    const itemB = createItem({
      id: 'Series_S1_E2',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/link-2',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 2',
    });

    const result = findEpisodeDownload([itemA, itemB], {
      downloadId: 'Series_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/different-link',
    });

    expect(result).toBe(itemA);
  });

  it('matches by infoUrl and sourceLink (priority b) when downloadId differs', () => {
    const item = createItem({
      id: 'OldTitle_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });

    const result = findEpisodeDownload([item], {
      downloadId: 'NewTitle_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });

    expect(result).toBe(item);
  });

  it('matches by infoUrl, seasonTitle, and episodeName (priority c) when downloadId and link differ', () => {
    const item = createItem({
      id: 'OldTitle_S1_E3',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/link-v1',
      seasonTitle: 'Season 1',
      episodeName: 'The Gathering Storm',
    });

    const result = findEpisodeDownload([item], {
      downloadId: 'NewTitle_S1_E3',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/link-v2',
      seasonTitle: 'Season 1',
      episodeName: 'The Gathering Storm',
    });

    expect(result).toBe(item);
  });

  it('respects priority order (priority a > b > c)', () => {
    const matchA = createItem({
      id: 'target-id',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/a',
      seasonTitle: 'Season 1',
      episodeName: 'Ep A',
    });
    const matchB = createItem({
      id: 'other-id-1',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/target-link',
      seasonTitle: 'Season 1',
      episodeName: 'Ep B',
    });
    const matchC = createItem({
      id: 'other-id-2',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/c',
      seasonTitle: 'Season 1',
      episodeName: 'Target Episode',
    });

    // When both (a) and (b) could match, (a) is selected
    const resultA = findEpisodeDownload([matchB, matchA, matchC], {
      downloadId: 'target-id',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/target-link',
      seasonTitle: 'Season 1',
      episodeName: 'Target Episode',
    });
    expect(resultA).toBe(matchA);

    // When (a) is absent/non-matching, (b) beats (c)
    const resultB = findEpisodeDownload([matchC, matchB], {
      downloadId: 'non-existent-id',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/target-link',
      seasonTitle: 'Season 1',
      episodeName: 'Target Episode',
    });
    expect(resultB).toBe(matchB);
  });

  it('excludes subtitle download items', () => {
    const subtitleItem = createItem({
      id: 'Series_S1_E1',
      isSubtitle: true,
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });
    const subtitleWithId = createItem({
      id: 'Series_S1_E1_subtitle_eng',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });
    const videoItem = createItem({
      id: 'DifferentId',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });

    const result = findEpisodeDownload([subtitleItem, subtitleWithId, videoItem], {
      downloadId: 'Series_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });

    expect(result).toBe(videoItem);

    // If only subtitles exist, return undefined
    const onlySubtitlesResult = findEpisodeDownload([subtitleItem, subtitleWithId], {
      downloadId: 'Series_S1_E1',
      infoUrl: 'https://provider.test/show/1',
      link: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Pilot',
    });
    expect(onlySubtitlesResult).toBeUndefined();
  });

  it('does not match when infoUrl differs', () => {
    const otherShowItem = createItem({
      id: 'OtherShow_S1_E1',
      infoUrl: 'https://provider.test/show/other',
      sourceLink: 'https://provider.test/ep/common-link',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 1',
    });

    // Differing infoUrl with matching sourceLink
    const linkResult = findEpisodeDownload([otherShowItem], {
      downloadId: 'Target_S1_E1',
      infoUrl: 'https://provider.test/show/current',
      link: 'https://provider.test/ep/common-link',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 1',
    });
    expect(linkResult).toBeUndefined();

    // Differing infoUrl with matching seasonTitle & episodeName
    const seasonEpisodeResult = findEpisodeDownload([otherShowItem], {
      downloadId: 'Target_S1_E1',
      infoUrl: 'https://provider.test/show/current',
      link: 'https://provider.test/ep/different-link',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 1',
    });
    expect(seasonEpisodeResult).toBeUndefined();
  });

  it('does not match on episodeName alone without infoUrl or matching season', () => {
    const item = createItem({
      id: 'Movie_A',
      infoUrl: 'https://provider.test/movie/a',
      seasonTitle: 'Season 1',
      episodeName: 'Special Feature',
    });

    // infoUrl undefined in target
    const noInfoUrlResult = findEpisodeDownload([item], {
      downloadId: 'Unmatched_Id',
      episodeName: 'Special Feature',
    });
    expect(noInfoUrlResult).toBeUndefined();

    // seasonTitle differs
    const wrongSeasonResult = findEpisodeDownload([item], {
      downloadId: 'Unmatched_Id',
      infoUrl: 'https://provider.test/movie/a',
      seasonTitle: 'Season 2',
      episodeName: 'Special Feature',
    });
    expect(wrongSeasonResult).toBeUndefined();
  });

  it('returns undefined when downloads list is empty or no match is found', () => {
    expect(
      findEpisodeDownload([], {
        downloadId: 'some-id',
        infoUrl: 'https://provider.test/show/1',
      }),
    ).toBeUndefined();

    const unmatched = createItem({
      id: 'existing-id',
      infoUrl: 'https://provider.test/show/1',
      sourceLink: 'https://provider.test/ep/1',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 1',
    });

    expect(
      findEpisodeDownload([unmatched], {
        downloadId: 'another-id',
        infoUrl: 'https://provider.test/show/1',
        link: 'https://provider.test/ep/2',
        seasonTitle: 'Season 1',
        episodeName: 'Episode 2',
      }),
    ).toBeUndefined();
  });
});
