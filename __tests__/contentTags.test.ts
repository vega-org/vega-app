import {normalizeContentTags} from '../src/lib/contentTags';

it('removes trailing spaces and line breaks before sizing tags', () => {
  expect(normalizeContentTags(['Live TV', 'Sports By Premium   ', 'Jiotvstb+ By Premium\n\t']))
    .toEqual(['Live TV', 'Sports By Premium', 'Jiotvstb+ By Premium']);
});

it('trims Unicode spaces, removes empty tags and deduplicates cleaned labels', () => {
  expect(normalizeContentTags(['\u00a0Sports\u00a0', 'Sports', '\t', '', null, undefined]))
    .toEqual(['Sports']);
});

it('preserves internal label spacing and numeric metadata without mutating input', () => {
  const labels = [' Dolby  Vision ', 2026];
  expect(normalizeContentTags(labels)).toEqual(['Dolby  Vision', '2026']);
  expect(labels).toEqual([' Dolby  Vision ', 2026]);
});
