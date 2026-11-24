import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import SwipeToUnfollow from '../src/screens/settings/components/SwipeToUnfollow';

const mockGesture = {
  activeOffsetX: jest.fn().mockReturnThis(),
  failOffsetX: jest.fn().mockReturnThis(),
  failOffsetY: jest.fn().mockReturnThis(),
  onUpdate: jest.fn().mockReturnThis(),
  onEnd: jest.fn().mockReturnThis(),
  onFinalize: jest.fn().mockReturnThis(),
};
let mockFinishAnimation: ((finished: boolean) => void) | undefined;
let mockHapticsEnabled = false;

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {isHapticFeedbackEnabled: () => mockHapticsEnabled},
}));
jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {Pan: () => mockGesture},
  GestureDetector: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-worklets', () => ({scheduleOnRN: (callback: () => void) => callback()}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {View: require('react-native').View},
  LinearTransition: {duration: jest.fn()},
  useAnimatedStyle: (callback: () => object) => callback(),
  useSharedValue: (initial: unknown) => {
    let value = initial;
    return {get: () => value, set: (next: unknown) => {value = next;}};
  },
  withTiming: (value: number, _config: object, complete?: (finished: boolean) => void) => {
    mockFinishAnimation = complete;
    return value;
  },
}));

function renderRow(onUnfollow: () => void) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<SwipeToUnfollow onUnfollow={onUnfollow}><View /></SwipeToUnfollow>);
  });
  act(() => tree.root.findByProps({collapsable: false}).props.onLayout({
    nativeEvent: {layout: {width: 320}},
  }));
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFinishAnimation = undefined;
  mockHapticsEnabled = false;
});

it('does not unfollow or vibrate on short or cancelled swipes', () => {
  const onUnfollow = jest.fn();
  const tree = renderRow(onUnfollow);
  const [end] = mockGesture.onEnd.mock.calls[0];
  const [finalize] = mockGesture.onFinalize.mock.calls[0];
  mockHapticsEnabled = true;

  end({translationX: -80}, true);
  end({translationX: -125}, false);
  finalize({}, false);

  expect(mockFinishAnimation).toBeUndefined();
  expect(onUnfollow).not.toHaveBeenCalled();
  expect(ReactNativeHapticFeedback.trigger).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it.each([true, false])('unfollows once after the animation with haptics enabled = %s', enabled => {
  mockHapticsEnabled = enabled;
  const onUnfollow = jest.fn();
  const tree = renderRow(onUnfollow);
  const [end] = mockGesture.onEnd.mock.calls[0];

  end({translationX: -125}, true);
  end({translationX: -125}, true);
  expect(onUnfollow).not.toHaveBeenCalled();

  act(() => mockFinishAnimation?.(true));
  expect(onUnfollow).toHaveBeenCalledTimes(1);
  expect(ReactNativeHapticFeedback.trigger).toHaveBeenCalledTimes(enabled ? 1 : 0);
  act(() => tree.unmount());
});
