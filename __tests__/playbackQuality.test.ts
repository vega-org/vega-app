import {
  deduplicateVideoTracks,
  getPlaybackQuality,
} from '../src/lib/player/playbackQuality';

it('shows the active HLS rendition instead of the requested or advertised resolution', () => {
  const tracks = [{height: 2160}, {height: 720, selected: true}];
  expect(getPlaybackQuality(tracks, {height: 1080}, '4K')).toEqual({
    height: 720,
    label: '720p',
  });
  expect(
    getPlaybackQuality(
      [{height: 2160, selected: true}, {height: 720}],
      {height: 720},
      '720p',
    ).label,
  ).toBe('2160p');
});

it('uses decoded dimensions for local files and sources with no declared resolution', () => {
  expect(getPlaybackQuality([], {width: 2560, height: 1440}).label).toBe(
    '1440p',
  );
  expect(getPlaybackQuality([], {height: 804}, 'Auto').label).toBe('720p');
  expect(getPlaybackQuality([{width: 1920, height: 1080}], null).label).toBe(
    '1080p',
  );
});

it('does not guess which rendition is active from an unselected list', () => {
  expect(getPlaybackQuality([{height: 2160}, {height: 720}], null).label).toBe(
    'Auto',
  );
  expect(
    getPlaybackQuality([{height: 2160}, {height: 720}], {height: 480}).label,
  ).toBe('480p');
});

it('falls back only to explicit source resolution and uses Auto for genuinely unknown resolution', () => {
  for (const value of [undefined, '', 'Auto', 'HLS', 'HD', 'Local']) {
    expect(getPlaybackQuality([], null, value)).toEqual({
      height: 0,
      label: 'Auto',
    });
  }
  for (const value of ['1080', '1080p', '1920x1080']) {
    expect(getPlaybackQuality([], null, value).label).toBe('1080p');
  }
  expect(getPlaybackQuality([], {height: NaN}, '4K').label).toBe('2160p');
  expect(getPlaybackQuality([{height: -1}], {height: 0}).label).toBe('Auto');
});

it('preserves the active copy of duplicated formats', () => {
  const tracks = deduplicateVideoTracks([
    {index: 0, width: 1920, height: 1080, bitrate: 3000000, selected: false},
    {index: 2, width: 1920, height: 1080, bitrate: 3000000, selected: true},
    {index: 1, width: 1280, height: 720, bitrate: 1500000, selected: false},
  ]);
  expect(tracks).toHaveLength(2);
  expect(tracks[0].index).toBe(2);
  expect(getPlaybackQuality(tracks, null).label).toBe('1080p');
});

it('uses standard tiers for cropped and slightly uneven active dimensions', () => {
  expect(getPlaybackQuality([], null, '1920x804').label).toBe('1080p');
  expect(getPlaybackQuality([], {width: 1920, height: 804}).label).toBe('1080p');
  expect(getPlaybackQuality([], {width: 3840, height: 1608}).label).toBe('2160p');
  expect(getPlaybackQuality([], {width: 1920, height: 1072}).label).toBe('1080p');
  expect(getPlaybackQuality([], {width: 1080, height: 1920}).label).toBe('1080p');
  expect(getPlaybackQuality([{selected: true, width: 1280, height: 536}], {width: 3840, height: 2160}, '4K').label).toBe('720p');
});
