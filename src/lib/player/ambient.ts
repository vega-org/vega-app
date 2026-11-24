export type AmbientColors = [string, string, string, string];
export type AmbientBars = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function getAmbientBars(
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
  resizeMode: string,
): AmbientBars {
  const empty = {top: 0, bottom: 0, left: 0, right: 0};
  if (
    ![width, height, videoWidth, videoHeight].every(
      n => Number.isFinite(n) && n > 0,
    ) ||
    !['contain', 'none'].includes(resizeMode)
  )
    return empty;
  const ratio = Math.min(width / videoWidth, height / videoHeight);
  // Estimate fitted bounds; native sampling confirms the exact surface edges.
  const vertical = Math.max(
    0,
    Math.floor((height - videoHeight * ratio) / 2),
  );
  const horizontal = Math.max(
    0,
    Math.floor((width - videoWidth * ratio) / 2),
  );
  return {top: vertical, bottom: vertical, left: horizontal, right: horizontal};
}

export function validAmbientColors(value: unknown): value is AmbientColors {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color),
    )
  );
}

export function validAmbientBars(value: unknown): value is AmbientBars {
  if (!value || typeof value !== 'object') return false;
  const bars = value as AmbientBars;
  return [bars.top, bars.bottom, bars.left, bars.right].every(
    n => typeof n === 'number' && Number.isFinite(n) && n >= 0,
  );
}

// Keep only two tiny palettes; favor the current frame to avoid trailing cuts.
export function blendAmbientHistory(previous: AmbientColors | null, sampled: AmbientColors): AmbientColors {
  if (!previous) return sampled;
  return sampled.map((color, index) => '#' + [1, 3, 5].map(offset => {
    const before = parseInt(previous[index].slice(offset, offset + 2), 16);
    const current = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(current * 0.8 + before * 0.2).toString(16).padStart(2, '0');
  }).join('')) as AmbientColors;
}

/** Match sampling to smoothing; retain the existing 250ms cadence at the 220ms default. */
export function getAmbientSampleInterval(responseMs: number): number {
  const response = Number.isFinite(responseMs) ? Math.max(16, Math.min(1000, responseMs)) : 220;
  return Math.max(33, Math.min(1000, Math.round(response * 250 / 220)));
}
