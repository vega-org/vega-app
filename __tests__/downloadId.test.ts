import {describe, expect, it} from '@jest/globals';
import {
  createDirectDownloadId,
  createDownloadFileName,
  createEpisodeDownloadId,
  createSeriesDownloadId,
  createSubtitleFileName,
  extractEpisodeNumberFromName,
  sanitizeDownloadFileName,
} from '../src/lib/downloadId';

describe('download identity and filenames', () => {
  it('matches desktop download IDs', () => {
    expect(createSeriesDownloadId('Show', 'Season 1', 0)).toBe(
      'Show_SSeason 1_E1',
    );
    expect(createDirectDownloadId('Movie', 2)).toBe('Movie_direct_2');
  });

  it('derives stable episode download IDs from episode numbers and link hashes', () => {
    expect(
      extractEpisodeNumberFromName('S2 E5 · Panick Attack', 'Season 2'),
    ).toBe(5);
    expect(extractEpisodeNumberFromName('5. Panick Attack', 'Season 2')).toBe(
      5,
    );
    expect(extractEpisodeNumberFromName('E1-E2 Combined', 'Season 1')).toBeUndefined();
    expect(extractEpisodeNumberFromName('S1 E4.5 Recap', 'Season 1')).toBeUndefined();

    expect(
      createEpisodeDownloadId({
        baseTitle: 'Dexter',
        groupTitle: 'Season 2 • 2160p',
        itemIndex: 0,
        episodeName: 'S2 E5 · Panick Attack',
        link: 'https://example.com/e5',
        isDirect: true,
      }),
    ).toBe('Dexter_SSeason 2 • 2160p_E5');

    const unnumberedId = createEpisodeDownloadId({
      baseTitle: 'Dexter',
      groupTitle: 'Specials',
      itemIndex: 0,
      episodeName: 'Behind the Scenes',
      link: 'https://example.com/bts',
      isDirect: false,
    });
    const unnumberedId2 = createEpisodeDownloadId({
      baseTitle: 'Dexter',
      groupTitle: 'Specials',
      itemIndex: 1,
      episodeName: 'Behind the Scenes',
      link: 'https://example.com/bts',
      isDirect: false,
    });
    expect(unnumberedId).toBe(unnumberedId2);
    expect(unnumberedId.startsWith('Dexter_SSpecials_')).toBe(true);

    expect(
      createEpisodeDownloadId({
        baseTitle: 'Movie',
        groupTitle: '1080p',
        itemIndex: 0,
        episodeName: 'Movie',
        link: 'https://example.com/movie',
        isDirect: true,
        isSingleMovie: true,
      }),
    ).toBe('Movie_S1080p_E1');
  });

  it('keeps identity separate from safe physical filenames', () => {
    const id = createSeriesDownloadId('Pokémon', 'Season 1', 0);
    expect(id).toBe('Pokémon_SSeason 1_E1');
    expect(createDownloadFileName(id)).toBe('Pokemon_SSeason 1_E1');
    expect(sanitizeDownloadFileName('Épisode 1: (A/B) [Dubbed]?')).toBe(
      'Episode 1 (A B) [Dubbed]',
    );
  });

  it('sanitizes subtitle names', () => {
    expect(createSubtitleFileName('Movie Name', 'English (Signs)')).toBe(
      'Movie Name - English (Signs)',
    );
    expect(sanitizeDownloadFileName('***')).toBe('download');
  });
});
