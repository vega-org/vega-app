type VideoSize = {height?: number; width?: number};
type VideoTrack = VideoSize & {selected?: boolean};

export function deduplicateVideoTracks<
  T extends VideoTrack & {bitrate?: number},
>(tracks: T[]): T[] {
  const unique = new Map<string, T>();
  for (const track of tracks) {
    const key = `${track.width}x${track.height}:${track.bitrate}`;
    const previous = unique.get(key);
    // Identical formats can appear in multiple groups. Keep the active copy.
    if (!previous || (track.selected && !previous.selected))
      unique.set(key, track);
  }
  return [...unique.values()];
}

const positiveHeight = (height?: number) =>
  typeof height === 'number' && Number.isFinite(height) && height > 0
    ? Math.round(height)
    : 0;

const standardHeight = (size?: VideoSize | null): number => {
  const height = positiveHeight(size?.height);
  if (!height) return 0;
  const width = positiveHeight(size?.width);
  // Classify cropped widescreen frames by their retained width; also handle portrait video.
  const resolution = width
    ? Math.max(Math.min(width, height), Math.max(width, height) * 9 / 16)
    : height;
  const standards = [144, 240, 360, 480, 576, 720, 1080, 1440, 2160, 4320];
  return standards.reduce((nearest, candidate) =>
    Math.abs(candidate - resolution) < Math.abs(nearest - resolution) ? candidate : nearest,
  );
};

/** Actual playback wins over source metadata and the user's requested quality. */
export function getPlaybackQuality(
  tracks: VideoTrack[],
  decodedSize: VideoSize | null,
  sourceQuality?: string,
): {height: number; label: string} {
  const active = tracks.find(
    track => track.selected && positiveHeight(track.height),
  );
  const height =
    standardHeight(active) ||
    standardHeight(decodedSize) ||
    (tracks.length === 1 ? standardHeight(tracks[0]) : 0);
  if (height) return {height, label: `${height}p`};

  // Only use a source's explicit resolution before the decoder has reported one.
  // Labels such as HLS, HD, Local or Auto do not identify a resolution.
  const quality = sourceQuality?.trim() || '';
  const dimensions = quality.match(/\b(\d{2,5})\s*[x×]\s*(\d{2,5})\b/i);
  const pixels = quality.match(/^(\d{3,4})p?$/i);
  const k = quality.match(/^(2|4|8)k$/i);
  const fallback = dimensions
    ? standardHeight({width: Number(dimensions[1]), height: Number(dimensions[2])})
    : pixels
      ? Number(pixels[1])
      : k
        ? {2: 1440, 4: 2160, 8: 4320}[Number(k[1]) as 2 | 4 | 8]
        : 0;
  const fallbackHeight = standardHeight({height: fallback});
  return fallbackHeight
    ? {height: fallbackHeight, label: `${fallbackHeight}p`}
    : {height: 0, label: 'Auto'};
}
