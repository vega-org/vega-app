import {
  insertRowByTier,
  rankPostsByTitle,
  titleMatchScore,
} from '../src/lib/search/rankSearchResults';

describe('titleMatchScore', () => {
  it('ranks the same title above titles with extra words', () => {
    expect(titleMatchScore('Paradha', 'paradha')).toBe(4);
    expect(titleMatchScore('Paradha (2025) Hindi 1080p', 'Paradha')).toBe(3);
    expect(titleMatchScore('Watch Paradha Online', 'paradha')).toBe(2);
    expect(titleMatchScore('Lights Out at the Lake', 'the lake lights')).toBe(1);
    expect(titleMatchScore('Param Sundari', 'paradha')).toBe(0);
  });

  it('ignores case, accents and punctuation', () => {
    expect(titleMatchScore('Amélie', 'amelie')).toBe(4);
    expect(titleMatchScore('Spider-Man: No Way Home', 'spider man no way home')).toBe(4);
  });

  it('matches whole words only', () => {
    expect(titleMatchScore('Sawdust', 'saw')).toBe(0);
    expect(titleMatchScore('Saw X', 'saw')).toBe(3);
  });

  it('gives partial word matches a score below one', () => {
    const score = titleMatchScore('Batman Begins', 'the batman');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('handles empty titles and queries', () => {
    expect(titleMatchScore('', 'paradha')).toBe(0);
    expect(titleMatchScore('Paradha', '  ')).toBe(0);
    expect(titleMatchScore(undefined as unknown as string, 'paradha')).toBe(0);
  });
});

describe('rankPostsByTitle', () => {
  it('moves the best match first and keeps provider order for ties', () => {
    const posts = [
      {title: 'Saw II'},
      {title: 'Sawdust'},
      {title: 'Saw'},
      {title: 'Saw III'},
    ];
    const ranked = rankPostsByTitle(posts, 'saw');
    expect(ranked.posts.map(p => p.title)).toEqual([
      'Saw',
      'Saw II',
      'Saw III',
      'Sawdust',
    ]);
    expect(ranked.tier).toBe(2);
  });

  it('puts rows without the title in a lower tier', () => {
    expect(rankPostsByTitle([{title: 'Other Movie'}], 'paradha').tier).toBe(0);
    expect(rankPostsByTitle([{title: 'Lake Lights'}], 'lights lake').tier).toBe(1);
    expect(rankPostsByTitle([], 'paradha').tier).toBe(0);
  });
});

describe('insertRowByTier', () => {
  it('places rows by tier and keeps arrival order within a tier', () => {
    let rows: {name: string; tier: number}[] = [];
    rows = insertRowByTier(rows, {name: 'weak', tier: 0});
    rows = insertRowByTier(rows, {name: 'first match', tier: 2});
    rows = insertRowByTier(rows, {name: 'words', tier: 1});
    rows = insertRowByTier(rows, {name: 'second match', tier: 2});
    rows = insertRowByTier(rows, {name: 'weak 2', tier: 0});
    expect(rows.map(r => r.name)).toEqual([
      'first match',
      'second match',
      'words',
      'weak',
      'weak 2',
    ]);
  });
});
