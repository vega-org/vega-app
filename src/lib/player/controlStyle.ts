export type PlayerControlLabels = 'full' | 'short' | 'hidden';
const LABEL_OPTIONS: PlayerControlLabels[] = ['full', 'short', 'hidden'];

export type PlayerControlStyle = {
  labels: PlayerControlLabels;
  /** Labels for the bottom-right group when the bottom row is split. */
  rightLabels: PlayerControlLabels;
  alignment: 'distributed' | 'center' | 'left' | 'right';
  backgroundOpacity: number;
  titleBackground: boolean;
  seekbarScale: number;
  scale: number;
};
export const defaultPlayerControlStyle = (): PlayerControlStyle => ({
  labels: 'full',
  rightLabels: 'full',
  alignment: 'distributed',
  backgroundOpacity: 0,
  titleBackground: false,
  seekbarScale: 1,
  scale: 1,
});
export function normalizePlayerControlStyle(
  value: unknown,
): PlayerControlStyle {
  const defaults = defaultPlayerControlStyle();
  if (!value || typeof value !== 'object') return defaults;
  const saved = value as Partial<PlayerControlStyle>;
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  const labels = LABEL_OPTIONS.includes(saved.labels as PlayerControlLabels)
    ? saved.labels!
    : defaults.labels;
  return {
    labels,
    // Older saves had one label style, so the right group starts matching it.
    rightLabels: LABEL_OPTIONS.includes(saved.rightLabels as PlayerControlLabels)
      ? saved.rightLabels!
      : labels,
    alignment: ['distributed', 'center', 'left', 'right'].includes(
      saved.alignment ?? '',
    )
      ? saved.alignment!
      : defaults.alignment,
    backgroundOpacity: clamp(saved.backgroundOpacity, 0, 1, 0),
    titleBackground: saved.titleBackground === true,
    seekbarScale: clamp(saved.seekbarScale, 0.75, 2, 1),
    scale: clamp(saved.scale, 0.75, 1.4, 1),
  };
}
