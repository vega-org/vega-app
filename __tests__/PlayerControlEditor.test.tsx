jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  Object.defineProperty(rn, 'findNodeHandle', {configurable: true, value: jest.fn(() => 123)});
  return rn;
});
jest.mock('expo-blur', () => ({BlurView: 'BlurView'}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {GestureDetector} from 'react-native-gesture-handler';
import {TVFocusable} from '../src/components/tv';
import PlayerControlEditor from '../src/components/PlayerControlEditor';
import PlayerControlArrangement from '../src/components/PlayerControlArrangement';
import * as RN from 'react-native';
import {PlayerControl} from '../src/components/PlayerControlBar';
import {
  defaultPlayerControlLayout,
  PLAYER_CONTROL_IDS,
} from '../src/lib/player/controlLayout';

jest.mock('../src/lib/storage', () => ({settingsStorage: {
  isAmbientVideoEnabled: () => false,
  getAmbientIntensity: () => 0.35,
  getAmbientSpread: () => 1,
  getAmbientResponseMs: () => 220,
  getSubtitleFontSize: () => 16,
  getSubtitleTextOpacity: () => 1,
  getSubtitleOpacity: () => 1,
  getSubtitleBottomPadding: () => 10,
}}));

let mockIsTV = false;
jest.mock('../src/lib/tv/constants', () => ({
  get isTV() {
    return mockIsTV;
  },
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@expo/vector-icons/MaterialIcons', () => 'Icon');
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3HostTheme: () => ({})}));
jest.mock('@expo/ui/jetpack-compose', () => ({Host: 'Host', Slider: 'Slider'}));
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({fillMaxWidth: () => ({})}));
jest.mock('../src/components/tv', () => {
  const ReactModule = require('react');
  return {
    TVFocusGuide: 'FocusGuide',
    TVFocusable: ReactModule.forwardRef((props: object, ref: unknown) =>
      ReactModule.createElement('FocusButton', {...props, ref}),
    ),
  };
});
jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: {View: require('react-native').View},
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => object) => fn(),
    useSharedValue: (initial: unknown) =>
      ReactModule.useRef({
        value: initial,
        get() {
          return this.value;
        },
        set(value: unknown) {
          this.value = value;
        },
      }).current,
  };
});
jest.mock('react-native-gesture-handler', () => {
  const builder = () => ({
    start: undefined,
    update: undefined,
    end: undefined,
    finalize: undefined,
    activateAfterLongPress() {
      return this;
    },
    onStart(fn: unknown) {
      this.start = fn;
      return this;
    },
    onUpdate(fn: unknown) {
      this.update = fn;
      return this;
    },
    onEnd(fn: unknown) {
      this.end = fn;
      return this;
    },
    onFinalize(fn: unknown) {
      this.finalize = fn;
      return this;
    },
  });
  return {
    GestureHandlerRootView: 'GestureRoot',
    GestureDetector: 'GestureDetector',
    Gesture: {
      Pan: builder,
      Tap: builder,
      Exclusive: (pan: unknown, tap: unknown) => ({pan, tap}),
    },
  };
});

const controls: PlayerControl[] = PLAYER_CONTROL_IDS.map(id => ({
  id,
  title: id,
  label: id,
  icon: 'cast',
  visible: true,
  onPress: jest.fn(),
}));
const makeEditor = (options: Partial<React.ComponentProps<typeof PlayerControlEditor>> = {}) => {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const onHaptic = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PlayerControlEditor
        layout={defaultPlayerControlLayout()}
        controls={controls}
        color="#ffffff"
        onSave={onSave}
        onClose={onClose}
        onHaptic={onHaptic}
        {...options}
      />,
    );
  });
  const press = (label: string) =>
    act(() => {
      tree.root
        .findAllByType(TVFocusable)
        .find(node => node.props.accessibilityLabel === label)!
        .props.onPress();
    });
  return {tree, press, onSave, onClose, onHaptic};
};

beforeEach(() => {
  mockIsTV = false;
});


it('does not save on opening or tab changes, and closes without a Save button', () => {
  const {tree, press, onSave, onClose} = makeEditor();
  press('Style'); press('Arrange');
  expect(onSave).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({accessibilityLabel: 'Save'})).toHaveLength(0);
  press('Close');
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('automatically saves subtitle adjustments without closing the dialog', () => {
  mockIsTV = true;
  const {tree, press, onSave, onClose} = makeEditor();
  press('Subtitles'); press('Increase Font size'); press('Increase Bottom elevation');
  expect(onSave.mock.calls.at(-1)![4]).toEqual({fontSize: 17, textOpacity: 1, opacity: 1, paddingBottom: 11});
  expect(onClose).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('automatically saves visibility and keeps hidden controls available to restore', () => {
  const {tree, press, onSave} = makeEditor();
  act(() => tree.root.findAllByProps({accessibilityLabel: 'Move audio'})[0].props.onAccessibilityTap());
  press('Hide control');
  expect(onSave.mock.calls.at(-1)![1]).toEqual(['rotate', 'audio']);
  expect(onSave.mock.calls.at(-1)![0].bottom).toContain('audio');
  press('Show control');
  expect(onSave.mock.calls.at(-1)![1]).toEqual(['rotate']);
  act(() => tree.unmount());
});

it('can show Rotate and resets it to hidden', () => {
  const {tree, press, onSave} = makeEditor();
  act(() => tree.root.findAllByProps({accessibilityLabel: 'Move rotate'})[0].props.onAccessibilityTap());
  press('Show control');
  expect(onSave.mock.calls.at(-1)![1]).not.toContain('rotate');
  press('Reset');
  expect(onSave.mock.calls.at(-1)![1]).toContain('rotate');
  act(() => tree.unmount());
});

it('keeps drag gestures stable and saves only the completed drop', () => {
  const {tree, press, onSave, onHaptic} = makeEditor();
  const pan = () => tree.root.findAllByType(GestureDetector).find(node =>
    node.findAllByProps({accessibilityLabel: 'Move audio'}).length > 0)!.props.gesture.pan;
  const gesture = pan();
  act(() => gesture.start({x: 10, y: 10, absoluteX: 10, absoluteY: 114}));
  expect(pan()).toBe(gesture);
  act(() => gesture.update({translationX: 150, translationY: -74}));
  expect(onSave).not.toHaveBeenCalled();
  act(() => gesture.end({absoluteX: 160, absoluteY: 40}));
  press('To top');
  expect(onHaptic).toHaveBeenCalledTimes(3);
  expect(onSave.mock.calls.at(-1)![0].top).toEqual(['sleep', 'lock', 'cast', 'decoder', 'audio']);
  act(() => tree.unmount());
});

it('supports dragging a control to the empty right side, then moving it back', () => {
  const {tree, press, onSave} = makeEditor();
  const token = () => tree.root.findAllByType(GestureDetector).find(node =>
    node.findAllByProps({accessibilityLabel: 'Move audio'}).length > 0)!;
  const width = Math.max(240, Math.min(600, RN.Dimensions.get('window').width - 32) - 28);

  act(() => token().props.gesture.pan.start({x: 10, y: 10, absoluteX: 10, absoluteY: 106}));
  act(() => token().props.gesture.pan.end({absoluteX: width * 0.75, absoluteY: 108}));
  expect(onSave.mock.calls.at(-1)![0].bottomRight).toEqual(['audio']);
  expect(onSave.mock.calls.at(-1)![0].bottom).not.toContain('audio');

  press('To bottom left');
  expect(onSave.mock.calls.at(-1)![0].bottomRight).toEqual([]);
  expect(onSave.mock.calls.at(-1)![0].bottom).toContain('audio');
  act(() => tree.unmount());
});

it('saves style choices immediately and sliders when interaction finishes', () => {
  const {tree, press, onSave} = makeEditor();
  press('Style'); press('Short'); press('Right');
  expect(onSave.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({labels: 'short', alignment: 'right'}));
  onSave.mockClear();
  const opacity = tree.root.findAllByType('Slider' as any)[0];
  act(() => opacity.props.onValueChange(0.5));
  expect(onSave).not.toHaveBeenCalled();
  act(() => opacity.props.onValueChangeFinished());
  expect(onSave.mock.calls.at(-1)![2].backgroundOpacity).toBe(0.5);
  act(() => tree.unmount());
});

it('supports TV moves and does not save rejected moves into a full row', () => {
  mockIsTV = true;
  const {tree, press, onSave} = makeEditor();
  press('Move speed'); press('To top');
  expect(onSave.mock.calls.at(-1)![0].top).toEqual(['sleep', 'lock', 'cast', 'decoder', 'speed']);
  onSave.mockClear();
  press('Move audio'); press('To top');
  expect(onSave).not.toHaveBeenCalled();
  press('To menu');
  expect(onSave.mock.calls.at(-1)![0].more).toEqual(['audio']);
  act(() => tree.unmount());
});

it.each([false, true])('automatically saves ambient lighting for TV=%s', tv => {
  const {Platform, Switch} = require('react-native');
  const originalOS = Platform.OS;
  Platform.OS = 'android'; mockIsTV = tv;
  try {
    const {tree, press, onSave} = makeEditor();
    press('Style');
    if (tv) press('Ambient lighting');
    else act(() => tree.root.findAllByType(Switch).find(node => node.props.accessibilityLabel === 'Ambient lighting')!.props.onValueChange(true));
    expect(onSave.mock.calls.at(-1)![3].enabled).toBe(true);
    act(() => tree.unmount());
  } finally {Platform.OS = originalOS;}
});

it('automatically saves the title background toggle without closing', () => {
  const {Switch} = require('react-native');
  const {tree, press, onSave, onClose} = makeEditor();
  press('Style');
  act(() => tree.root.findAllByType(Switch).find(node =>
    node.props.accessibilityLabel === 'Title background')!.props.onValueChange(true));
  expect(onSave.mock.calls.at(-1)![2].titleBackground).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('routes TV selection into actions and Up back to the selected tile and header', () => {
  mockIsTV = true;
  jest.useFakeTimers();
  const handle = jest.spyOn(RN, 'findNodeHandle').mockReturnValue(123);
  const focus = jest.spyOn(RN.UIManager, 'dispatchViewManagerCommand').mockImplementation(() => {});
  let tree!: renderer.ReactTestRenderer;
  try {
    act(() => {tree = renderer.create(<PlayerControlArrangement layout={defaultPlayerControlLayout()}
      controls={controls} color="#fff" exitUpHandle={99} onChange={jest.fn()} />,
      {createNodeMock: () => ({})});});
    const button = (label: string) => tree.root.findAllByType(TVFocusable).find(node => node.props.accessibilityLabel === label)!;
    act(() => button('Move sleep').props.onLayout());
    expect(button('Move sleep').props.nextFocusUp).toBe(99);
    act(() => button('Move sleep').props.onPress());
    act(() => jest.advanceTimersByTime(50));
    expect(focus).toHaveBeenCalledWith(123, 'requestTVFocus', []);
    expect(button('Move left').props.nextFocusUp).toBe(123);
    expect(button('To bottom left').props.nextFocusUp).toBe(123);
    expect(button('To bottom right').props.nextFocusUp).toBe(123);
  } finally {
    act(() => tree?.unmount());
    handle.mockRestore(); focus.mockRestore(); jest.useRealTimers();
  }
});
