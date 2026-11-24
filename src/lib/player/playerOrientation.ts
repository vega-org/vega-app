export type ManualPlayerOrientation = 'portrait_up' | 'landscape';

export function getPlayerOrientation({
  isTV,
  remote,
  autoRotate,
  manual,
}: {
  isTV: boolean;
  remote: boolean;
  autoRotate: boolean;
  manual?: ManualPlayerOrientation | null;
}): ManualPlayerOrientation | 'all' {
  if (isTV) return 'landscape';
  if (remote) return 'portrait_up';
  return manual ?? (autoRotate ? 'all' : 'landscape');
}

export function getDeviceOrientationGroup(orientation: string): ManualPlayerOrientation | null {
  if (orientation.startsWith('PORTRAIT')) return 'portrait_up';
  if (orientation.startsWith('LANDSCAPE')) return 'landscape';
  return null;
}
