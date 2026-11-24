import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {TouchableOpacity} from 'react-native';
import {NavigationContext} from '@react-navigation/native';
import {Slider} from '@expo/ui/jetpack-compose';
import {TVFocusable} from '../src/components/tv/TVFocusable';
import DropdownField from '../src/components/ui/DropdownField';
import SettingsRow from '../src/components/ui/SettingsRow';
import SettingsSliderRow from '../src/components/ui/SettingsSliderRow';
import {flushInteractionCommits} from '../src/lib/performance/idleWork';

jest.mock('@expo/ui/jetpack-compose', () => {
  const ReactModule = require('react');
  const Text = ({children}: any) => children ?? null;
  const TextField = ({children}: any) =>
    ReactModule.createElement('ComposeTextField', null, children);
  TextField.Placeholder = ({children}: any) => children ?? null;
  TextField.TrailingIcon = ({children}: any) => children ?? null;
  const DropdownMenuItem = ({onClick, children}: any) =>
    ReactModule.createElement('ComposeDropdownMenuItem', {onClick}, children);
  DropdownMenuItem.Text = ({children}: any) => children ?? null;
  return {
    Host: 'ComposeHost',
    Slider: 'ComposeSlider',
    ExposedDropdownMenuBox: 'ComposeExposedDropdownMenuBox',
    ExposedDropdownMenu: 'ComposeExposedDropdownMenu',
    DropdownMenuItem,
    HorizontalDivider: 'ComposeHorizontalDivider',
    RNHostView: 'ComposeRNHostView',
    Shape: {RoundedCorner: jest.fn(() => ({}))},
    Text,
    TextField,
  };
});
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  fillMaxWidth: jest.fn(() => ({})),
  clip: jest.fn(() => ({})),
  menuAnchor: jest.fn(() => ({})),
  padding: jest.fn(() => ({})),
  Shapes: {RoundedCorner: jest.fn(() => ({}))},
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(undefined),
  NavigationRouteContext: require('react').createContext(undefined),
}));
jest.mock('../src/lib/tv/constants', () => ({isTV: false}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({useTVFocusBorderColor: () => {throw new Error('Phone allocated TV color hook');}}));
jest.mock('../src/lib/tv/useTVNavFocusMemory', () => ({useSafeIsNavFocused: () => {throw new Error('Phone subscribed to TV focus');}, useTVNavFocusMemory: jest.fn()}));
jest.mock('react-native-reanimated', () => ({__esModule: true, default: {View: require('react-native').View}, useSharedValue: () => {throw new Error('Phone allocated a shared value');}}));
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    onSurface: '#ffffff',
    onSurfaceVariant: '#aaaaaa',
    outlineVariant: '#444444',
    primary: '#ff8888',
    secondaryContainer: '#333333',
    onSecondaryContainer: '#eeeeee',
    surfaceContainerHighest: '#222222',
  }),
  useM3HostTheme: () => ({colorScheme: 'dark'}),
}));
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View, TVFocusGuide: View};
});
jest.mock('../src/lib/storage', () => ({settingsStorage: {isHapticFeedbackEnabled: () => false}}));
jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/ui/Text', () => require('react-native').Text);

it('uses phone touch handling without TV worklets and checks focus at press time', () => {
  let focused = true;
  const onPress = jest.fn();
  const navigation = {isFocused: () => focused};
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<NavigationContext.Provider value={navigation as any}><TVFocusable onPress={onPress}>Hello</TVFocusable></NavigationContext.Provider>); });
  const press = tree.root.findByType(TouchableOpacity).props.onPress;
  act(() => press());
  expect(onPress).toHaveBeenCalledTimes(1);
  focused = false;
  act(() => press());
  expect(onPress).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('deduplicates snapped slider values and commits the final value on release or background', () => {
  const change = jest.fn();
  const finish = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<SettingsSliderRow title="Buffer" value={0.1} min={0} max={1} step={0.1} onValueChange={change} onValueChangeFinished={finish} />); });
  const slider = tree.root.findByType(Slider);
  act(() => { slider.props.onValueChange(0.21); slider.props.onValueChange(0.22); slider.props.onValueChange(0.29); });
  expect(change.mock.calls).toEqual([[0.2], [0.3]]);
  expect(finish).not.toHaveBeenCalled();
  act(() => slider.props.onValueChangeFinished());
  expect(finish.mock.calls).toEqual([[0.3]]);
  act(() => slider.props.onValueChange(0.41));
  act(() => flushInteractionCommits());
  expect(finish.mock.calls).toEqual([[0.3], [0.4]]);
  act(() => tree.unmount());
  expect(finish).toHaveBeenCalledTimes(2);
});

const findPressTrigger = (tree: renderer.ReactTestRenderer) =>
  tree.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function',
  );

it('defers Compose Host mount for closed DropdownField on phone and unmounts on selection or dismissal', () => {
  jest.useFakeTimers();
  const options = [
    {value: 'cloudflare', label: 'Cloudflare (1.1.1.1)'},
    {value: 'off', label: 'Off'},
  ];
  const onChange = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DropdownField
        options={options}
        value={options[0]}
        getKey={option => option.value}
        getLabel={option => option.label}
        onChange={onChange}
      />,
    );
  });

  expect(tree.root.findAllByType('ComposeHost' as any)).toHaveLength(0);

  act(() => {
    findPressTrigger(tree).props.onPress();
  });

  const host = tree.root.findByType('ComposeHost' as any);
  expect(
    tree.root.findByType('ComposeExposedDropdownMenu' as any).props.expanded,
  ).toBe(false);

  act(() => {
    host.props.onLayoutContent({nativeEvent: {width: 320, height: 56}});
    jest.runAllTimers();
  });
  expect(
    tree.root.findByType('ComposeExposedDropdownMenu' as any).props.expanded,
  ).toBe(true);

  const items = tree.root.findAllByType('ComposeDropdownMenuItem' as any);
  expect(items).toHaveLength(2);
  act(() => {
    items[1].props.onClick();
  });
  expect(onChange).toHaveBeenCalledWith(options[1]);
  expect(tree.root.findAllByType('ComposeHost' as any)).toHaveLength(0);

  act(() => {
    findPressTrigger(tree).props.onPress();
  });
  const reopenedHost = tree.root.findByType('ComposeHost' as any);
  act(() => {
    reopenedHost.props.onLayoutContent({nativeEvent: {width: 320, height: 56}});
    jest.runAllTimers();
  });
  act(() => {
    tree.root
      .findByType('ComposeExposedDropdownMenu' as any)
      .props.onDismissRequest();
  });
  expect(tree.root.findAllByType('ComposeHost' as any)).toHaveLength(0);

  act(() => tree.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('renders SettingsRow on phone without subscribing to TV focus', () => {
  const onPress = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <SettingsRow
        title="Appearance"
        description="Theme colors"
        icon="palette-outline"
        onPress={onPress}
      />,
    );
  });

  act(() => {
    findPressTrigger(tree).props.onPress();
  });
  expect(onPress).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
