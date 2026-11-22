import {
  defaultPlayerControlLayout,
  getTopControlLimit,
  movePlayerControl,
  normalizePlayerControlLayout,
  PLAYER_CONTROL_IDS,
} from '../src/lib/player/controlLayout';

it('moves controls between bars and reorders them without duplicates or mutating the saved layout', () => {
  const original = defaultPlayerControlLayout();
  const moved = movePlayerControl(original, 'speed', 'top', 1);
  expect(moved.top).toEqual(['sleep', 'speed', 'lock', 'cast', 'decoder']);
  expect(moved.bottom).not.toContain('speed');
  expect(original).toEqual(defaultPlayerControlLayout());
  const reordered = movePlayerControl(moved, 'speed', 'top', 3);
  expect(reordered.top).toEqual(['sleep', 'lock', 'cast', 'speed', 'decoder']);
  const bottom = movePlayerControl(reordered, 'lock', 'bottom', 0);
  expect(bottom.bottom[0]).toBe('lock');
  expect([...bottom.top, ...bottom.bottom].sort()).toEqual(
    [...PLAYER_CONTROL_IDS].sort(),
  );
});

it('allows five top controls and rejects a sixth while allowing reordering within a full bar', () => {
  const four = movePlayerControl(
    defaultPlayerControlLayout(),
    'speed',
    'top',
    0,
  );
  const full = movePlayerControl(four, 'audio', 'top', 0);
  expect(full.top).toHaveLength(5);
  expect(movePlayerControl(full, 'subtitle', 'top', 0)).toBe(full);
  expect(movePlayerControl(full, 'sleep', 'top', 3).top).toHaveLength(5);
});

it('repairs corrupt, duplicate, unknown and oversized saved layouts without losing valid controls', () => {
  const repaired = normalizePlayerControlLayout({
    top: ['sleep', 'sleep', 'invalid', 'audio', 'speed', 'pip', 'server', 'resize'],
    bottom: ['server', 'cast', 'cast'],
  });
  expect(repaired.top).toEqual(['sleep', 'audio', 'speed', 'pip', 'server']);
  expect(repaired.bottom).toContain('resize');
  expect([...repaired.top, ...repaired.bottom].sort()).toEqual(
    [...PLAYER_CONTROL_IDS].sort(),
  );
  expect(normalizePlayerControlLayout(null)).toEqual(
    defaultPlayerControlLayout(),
  );
});

it('reduces top capacity on narrow screens and moves overflow to the bottom', () => {
  expect(getTopControlLimit(800)).toBe(5);
  expect(getTopControlLimit(360)).toBeLessThan(5);
  const fitted = normalizePlayerControlLayout(defaultPlayerControlLayout(), 1);
  expect(fitted.top).toEqual(['sleep']);
  expect(fitted.bottom).toEqual(expect.arrayContaining(['lock', 'cast']));
  expect([...fitted.top, ...fitted.bottom]).toHaveLength(
    PLAYER_CONTROL_IDS.length,
  );
});

it('adds Decoder to older saved layouts on top, with overflow handled normally', () => {
  const saved = {top: ['sleep', 'lock', 'cast'], bottom: ['audio', 'subtitle', 'speed']};
  const migrated = normalizePlayerControlLayout(saved);
  expect(migrated.top).toContain('decoder');
  const narrow = normalizePlayerControlLayout(saved, 3);
  expect(narrow.top).toEqual(saved.top);
  expect(narrow.bottom).toContain('decoder');
  expect([...narrow.top, ...narrow.bottom, ...narrow.more].filter(id => id === 'decoder')).toHaveLength(1);
});

it('migrates older layouts and keeps Settings last while moving controls into and out of its menu', () => {
  const old = normalizePlayerControlLayout({top: ['sleep', 'cast'], bottom: ['audio']});
  expect(old.more).toEqual([]);
  expect(old.bottom.slice(-1)[0]).toBe('settings');
  const withMenu = movePlayerControl(old, 'audio', 'more', 0);
  expect(withMenu.more).toEqual(['audio']);
  expect(withMenu.bottom).not.toContain('audio');
  const launcherOnTop = movePlayerControl(withMenu, 'settings', 'top', 0);
  expect(launcherOnTop.top).toEqual(['sleep', 'cast', 'lock', 'decoder', 'settings']);
  expect(movePlayerControl(launcherOnTop, 'settings', 'more', 0)).toBe(launcherOnTop);
  const restored = movePlayerControl(launcherOnTop, 'audio', 'bottom', 0);
  expect(restored.more).toEqual([]);
  expect([...restored.top, ...restored.bottom].sort()).toEqual([...PLAYER_CONTROL_IDS].sort());
  expect(normalizePlayerControlLayout(launcherOnTop)).toEqual(launcherOnTop);
});


it('keeps legacy layouts single and remembers the Settings control on the right', () => {
  const legacy = normalizePlayerControlLayout({top: ['sleep'], bottom: ['audio', 'settings']});
  expect(legacy.bottomRight).toEqual([]);

  let rightOnly = defaultPlayerControlLayout();
  for (const id of [...rightOnly.bottom]) {
    rightOnly = movePlayerControl(rightOnly, id, 'bottomRight', rightOnly.bottomRight.length);
  }

  expect(rightOnly.bottom).toEqual([]);
  expect(rightOnly.bottomRight).toEqual(defaultPlayerControlLayout().bottom);
  expect(normalizePlayerControlLayout(JSON.parse(JSON.stringify(rightOnly)))).toEqual(rightOnly);

  const fitted = normalizePlayerControlLayout(rightOnly, 1);
  expect(fitted.bottom).toEqual([]);
  expect(fitted.bottomRight).toContain('decoder');
  expect(fitted.bottomRight.at(-1)).toBe('settings');
});


it('adds Rotate to the existing bottom group for right-only saved layouts', () => {
  const defaults = defaultPlayerControlLayout();
  const old = {
    top: defaults.top,
    bottom: [],
    bottomRight: defaults.bottom.filter(id => id !== 'rotate'),
    more: [],
  };

  expect(normalizePlayerControlLayout(old)).toEqual({
    ...old,
    bottomRight: defaults.bottom,
  });
});
