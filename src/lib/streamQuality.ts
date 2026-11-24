export function normalizeStreamQuality(quality: string): string {
  const label = quality.trim().toLowerCase();
  if (label === '4k' || label === 'uhd' || label === '4k uhd') {
    return '2160p';
  }
  return /^\d+$/.test(label) ? `${label}p` : label;
}

export function isExcludedQuality(
  quality: string | undefined,
  excluded: readonly string[],
): boolean {
  if (!quality?.trim()) return false;
  const normalized = normalizeStreamQuality(quality);
  return excluded.some(value => normalizeStreamQuality(value) === normalized);
}
