export const PLAYER_CONTROL_IDS = [
  'sleep',
  'lock',
  'cast',
  'audio',
  'subtitle',
  'speed',
  'pip',
  'server',
  'resize',
  'rotate',
  'episodes',
  'next',
  'settings',
  'decoder',
] as const;
export type PlayerControlId = (typeof PLAYER_CONTROL_IDS)[number];
const PLAYER_CONTROL_BARS = ['top', 'bottom', 'bottomRight', 'more'] as const;
export type PlayerControlBar = (typeof PLAYER_CONTROL_BARS)[number];
export type PlayerControlLayout = Record<PlayerControlBar, PlayerControlId[]>;
export const DEFAULT_HIDDEN_PLAYER_CONTROLS: readonly PlayerControlId[] = ['rotate'];
export const MAX_TOP_CONTROLS = 5;

export const defaultPlayerControlLayout = (): PlayerControlLayout => ({
  top: ['sleep', 'lock', 'cast', 'decoder'],
  bottom: [
    'audio',
    'subtitle',
    'speed',
    'pip',
    'server',
    'resize',
    'episodes',
    'next',
    'rotate',
    'settings',
  ],
  bottomRight: [],
  more: [],
});

export const getTopControlLimit = (width: number) =>
  Math.max(1, Math.min(MAX_TOP_CONTROLS, Math.floor((width * 0.45 - 20) / 48)));

export function normalizePlayerControlLayout(
  value: unknown,
  limit = MAX_TOP_CONTROLS,
): PlayerControlLayout {
  const defaults = defaultPlayerControlLayout();
  const candidate =
    value && typeof value === 'object'
      ? (value as Partial<PlayerControlLayout>)
      : defaults;
  const result: PlayerControlLayout = {top: [], bottom: [], bottomRight: [], more: []};
  const overflowBar = candidate.bottom?.length === 0 && candidate.bottomRight?.length
    ? 'bottomRight'
    : 'bottom';
  const seen = new Set<PlayerControlId>();
  const append = (id: unknown, bar: PlayerControlBar) => {
    if (
      !PLAYER_CONTROL_IDS.includes(id as PlayerControlId) ||
      seen.has(id as PlayerControlId)
    )
      return;
    seen.add(id as PlayerControlId);
    result[bar === 'top' && result.top.length >= limit ? overflowBar : bar].push(
      id as PlayerControlId,
    );
  };
  for (const bar of PLAYER_CONTROL_BARS) {
    for (const id of Array.isArray(candidate[bar])
      ? candidate[bar]!
      : defaults[bar])
      append(id, bar);
  }
  for (const bar of PLAYER_CONTROL_BARS)
    for (const id of defaults[bar]) append(id, bar === 'bottom' ? overflowBar : bar);
  return pinSettingsControl(result);
}

export function movePlayerControl(
  layout: PlayerControlLayout,
  id: PlayerControlId,
  bar: PlayerControlBar,
  index: number,
  limit = MAX_TOP_CONTROLS,
): PlayerControlLayout {
  if (!PLAYER_CONTROL_IDS.includes(id) || (id === 'settings' && bar === 'more'))
    return layout;
  if (bar === 'top' && !layout.top.includes(id) && layout.top.length >= limit)
    return layout;
  const result = {
    top: layout.top.filter(item => item !== id),
    bottom: layout.bottom.filter(item => item !== id),
    bottomRight: layout.bottomRight.filter(item => item !== id),
    more: layout.more.filter(item => item !== id),
  };
  result[bar].splice(Math.max(0, Math.min(result[bar].length, index)), 0, id);
  return pinSettingsControl(result);
}

/** The menu launcher always occupies the final slot of its chosen row. */
function pinSettingsControl(layout: PlayerControlLayout): PlayerControlLayout {
  const bar = PLAYER_CONTROL_BARS.find(
    row => row !== 'more' && layout[row].includes('settings'),
  ) ?? 'bottom';
  for (const row of PLAYER_CONTROL_BARS) {
    layout[row] = layout[row].filter(id => id !== 'settings');
  }
  layout[bar].push('settings');
  return layout;
}
