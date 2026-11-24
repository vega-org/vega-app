import {
  getDeviceOrientationGroup,
  getPlayerOrientation,
} from '../src/lib/player/playerOrientation';

const local = {isTV: false, remote: false, autoRotate: false};

it('defaults to landscape and allows either manual orientation', () => {
  expect(getPlayerOrientation(local)).toBe('landscape');
  expect(getPlayerOrientation({...local, manual: 'portrait_up'})).toBe('portrait_up');
  expect(getPlayerOrientation({...local, manual: 'landscape'})).toBe('landscape');
});

it('supports auto-rotation and a manual override without rotating the TV or remote player', () => {
  const auto = {...local, autoRotate: true};
  expect(getPlayerOrientation(auto)).toBe('all');
  expect(getPlayerOrientation({...auto, manual: 'portrait_up'})).toBe('portrait_up');
  expect(getPlayerOrientation({...auto, remote: true, manual: 'landscape'})).toBe('portrait_up');
  expect(getPlayerOrientation({...auto, isTV: true, manual: 'portrait_up'})).toBe('landscape');
});

it('groups physical orientations and ignores unknown positions', () => {
  expect(getDeviceOrientationGroup('PORTRAIT')).toBe('portrait_up');
  expect(getDeviceOrientationGroup('LANDSCAPE-LEFT')).toBe('landscape');
  expect(getDeviceOrientationGroup('LANDSCAPE-RIGHT')).toBe('landscape');
  expect(getDeviceOrientationGroup('UNKNOWN')).toBeNull();
  expect(getDeviceOrientationGroup('FACE-UP')).toBeNull();
});
