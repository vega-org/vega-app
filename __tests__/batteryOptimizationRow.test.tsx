import {beforeEach, afterEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import * as RN from 'react-native';

let mockFocusCallback: (() => void) | undefined;
let mockAppStateListener: ((state: RN.AppStateStatus) => void) | undefined;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    mockFocusCallback = callback;
    const ReactModule = require('react');
    ReactModule.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const {View} = require('react-native');
  return View;
});

jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    primary: '#6750a4',
    onPrimary: '#ffffff',
    secondaryContainer: '#e8def8',
    onSecondaryContainer: '#1d192b',
    surfaceContainerHighest: '#2b2930',
    outlineVariant: '#49454f',
    onSurface: '#e6e1e5',
    onSurfaceVariant: '#cac4d0',
  }),
}));

jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View, TVFocusGuide: View};
});
jest.mock('../src/lib/tv/useTVNavFocusMemory', () => ({
  useSafeIsNavFocused: () => false,
}));
jest.mock('../src/lib/zustand/tvNavigationStore', () => ({
  __esModule: true,
  default: {getState: () => ({setActiveScreenFocusHandle: jest.fn()})},
}));
jest.mock('../src/components/ui/SettingsSearchTarget', () => ({
  SettingsSearchAnchor: ({children}: {children: React.ReactNode}) => children,
}));

import {episodeCheckNative} from '../src/lib/services/episodeCheckNative';
import BatteryOptimizationRow from '../src/screens/settings/components/BatteryOptimizationRow';

const collectText = (node: renderer.ReactTestInstance): string =>
  node.children
    .map(child => (typeof child === 'string' ? child : collectText(child)))
    .join(' ');

const flushPromises = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe('BatteryOptimizationRow and episodeCheckNative battery helpers', () => {
  let mockIsIgnoring: jest.Mock<() => Promise<boolean>>;
  let mockRequestIgnore: jest.Mock<() => Promise<boolean>>;

  beforeEach(() => {
    mockFocusCallback = undefined;
    mockAppStateListener = undefined;
    Object.defineProperty(RN.Platform, 'OS', {value: 'android', configurable: true});
    mockIsIgnoring = jest.fn(async () => false);
    mockRequestIgnore = jest.fn(async () => true);
    RN.NativeModules.EpisodeCheck = {
      schedule: jest.fn(async () => true),
      scheduleAt: jest.fn(async () => true),
      cancel: jest.fn(async () => true),
      startBackgroundSandbox: jest.fn(async () => true),
      injectBackgroundSandbox: jest.fn(),
      stopBackgroundSandbox: jest.fn(async () => true),
      isIgnoringBatteryOptimizations: mockIsIgnoring,
      requestIgnoreBatteryOptimizations: mockRequestIgnore,
    };
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_type, cb) => {
      mockAppStateListener = cb;
      return {remove: jest.fn()};
    });
    jest.spyOn(RN.Linking, 'openSettings').mockResolvedValue();
    jest.spyOn(RN.ToastAndroid, 'show').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete RN.NativeModules.EpisodeCheck;
  });

  it('exposes battery optimization checks via episodeCheckNative with safe fallbacks', async () => {
    expect(episodeCheckNative.supportsBatteryOptimization()).toBe(true);
    await expect(episodeCheckNative.isIgnoringBatteryOptimizations()).resolves.toBe(false);
    mockIsIgnoring.mockResolvedValueOnce(true);
    await expect(episodeCheckNative.isIgnoringBatteryOptimizations()).resolves.toBe(true);
    await expect(episodeCheckNative.requestIgnoreBatteryOptimizations()).resolves.toBe(true);

    delete RN.NativeModules.EpisodeCheck;
    expect(episodeCheckNative.supportsBatteryOptimization()).toBe(false);
    await expect(episodeCheckNative.isIgnoringBatteryOptimizations()).resolves.toBe(false);
    await expect(episodeCheckNative.requestIgnoreBatteryOptimizations()).resolves.toBe(false);
  });

  it('renders null off Android', async () => {
    Object.defineProperty(RN.Platform, 'OS', {value: 'ios', configurable: true});
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BatteryOptimizationRow />);
    });
    await flushPromises();
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  it('shows Allow badge when restricted, opens native prompt on press, and updates to Allowed on AppState active', async () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BatteryOptimizationRow />);
    });
    await flushPromises();

    expect(mockIsIgnoring).toHaveBeenCalledTimes(1);
    const initialText = collectText(tree.root);
    expect(initialText).toContain('Background battery');
    expect(initialText).toContain('Allow');
    expect(initialText).not.toContain('Allowed');

    const button = tree.root.findByProps({accessibilityRole: 'button'});
    await act(async () => {
      await button.props.onPress();
    });
    expect(mockRequestIgnore).toHaveBeenCalledTimes(1);

    mockIsIgnoring.mockResolvedValueOnce(true);
    expect(mockAppStateListener).toBeDefined();
    act(() => {
      mockAppStateListener?.('active');
    });
    await flushPromises();

    const updatedText = collectText(tree.root);
    expect(updatedText).toContain('Allowed');
    expect(updatedText).toContain('Unrestricted');

    // Focus refresh also stays wired
    act(() => {
      mockFocusCallback?.();
    });
    await flushPromises();
    expect(mockIsIgnoring).toHaveBeenCalledTimes(3);

    act(() => tree.unmount());
  });

  it('shows toast when native battery settings cannot open and falls back to Linking.openSettings when native method is absent', async () => {
    mockRequestIgnore.mockResolvedValueOnce(false);
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BatteryOptimizationRow />);
    });
    await flushPromises();

    await act(async () => {
      await tree.root.findByProps({accessibilityRole: 'button'}).props.onPress();
    });
    expect(RN.ToastAndroid.show).toHaveBeenCalledWith(
      'Could not open battery settings',
      RN.ToastAndroid.SHORT,
    );

    delete RN.NativeModules.EpisodeCheck.requestIgnoreBatteryOptimizations;
    await act(async () => {
      await tree.root.findByProps({accessibilityRole: 'button'}).props.onPress();
    });
    expect(RN.Linking.openSettings).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });
});
