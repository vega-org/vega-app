import {sanitizeSearchQuery} from '../utils/helpers';

const toWords = (text: string) =>
  sanitizeSearchQuery(text || '').toLowerCase().split(' ').filter(Boolean);

/**
 * How closely a result title matches the search, from 4 (same title) down to 0
 * (no query word in it). Providers often add the year, language or quality
 * after the name, so a title that starts with the query still ranks high.
 */
export const titleMatchScore = (title: string, query: string): number => {
  const queryWords = toWords(query);
  const titleWords = toWords(title);
  if (!queryWords.length || !titleWords.length) return 0;

  const queryText = queryWords.join(' ');
  const titleText = titleWords.join(' ');
  if (titleText === queryText) return 4;
  if (`${titleText} `.startsWith(`${queryText} `)) return 3;
  if (` ${titleText} `.includes(` ${queryText} `)) return 2;

  const titleSet = new Set(titleWords);
  const found = queryWords.filter(word => titleSet.has(word)).length;
  return found === queryWords.length ? 1 : (found / queryWords.length) * 0.9;
};

/** Best matches first; ties keep the provider's own order. */
export const rankPostsByTitle = <T extends {title: string}>(
  posts: T[],
  query: string,
): {posts: T[]; tier: number} => {
  const scored = posts.map((post, index) => ({
    post,
    index,
    score: titleMatchScore(post.title, query),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0]?.score ?? 0;
  // Coarse tiers, so rows that all have the title keep their arrival order
  // instead of moving around over small title differences.
  const tier = best >= 2 ? 2 : best >= 1 ? 1 : 0;
  return {posts: scored.map(item => item.post), tier};
};

/** Puts a provider row after every row with the same or a better tier. */
export const insertRowByTier = <R extends {tier: number}>(
  rows: R[],
  row: R,
): R[] => {
  const at = rows.findIndex(existing => existing.tier < row.tier);
  return at === -1
    ? [...rows, row]
    : [...rows.slice(0, at), row, ...rows.slice(at)];
};
