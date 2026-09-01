import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockBottomSheetProps = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactModule = require('react');
  const ReactNative = require('react-native');
  const BottomSheet = ReactModule.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockBottomSheetProps(props);
      // Reproduce the library lifecycle window where the ref is populated but
      // its imperative close/expand methods have not been attached yet.
      ReactModule.useImperativeHandle(ref, () => ({}));
      return ReactModule.createElement(ReactNative.View, null, props.children);
    },
  );
  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetScrollView: ReactNative.ScrollView,
    BottomSheetView: ReactNative.View,
    BottomSheetBackdrop: ReactNative.View,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const {View} = require('react-native');
  return {GestureHandlerRootView: View};
});

jest.mock('../src/components/Skeleton', () => {
  const {View} = require('react-native');
  return View;
});

jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));

jest.mock('../src/lib/zustand/themeStore', () => ({
  __esModule: true,
  default: (selector: (state: {primary: string}) => unknown) =>
    selector({primary: '#ffffff'}),
}));

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isHapticFeedbackEnabled: () => false,
    getBool: () => false,
  },
}));

jest.mock('react-native-video', () => ({
  TextTrackType: {VTT: 'text/vtt'},
}));

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const {View} = require('react-native');
  return View;
});

jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    primary: '#ffffff',
    surfaceContainerLow: '#1c1b1f',
    surfaceContainerHighest: '#2b2930',
    outline: '#79747e',
    outlineVariant: '#49454f',
    onSurface: '#e6e1e5',
    onSurfaceVariant: '#cac4d0',
    primaryContainer: '#4f378b',
    onPrimaryContainer: '#eaddff',
    secondaryContainer: '#4a4458',
    onSecondaryContainer: '#e8def8',
    errorContainer: '#8c1d18',
    onErrorContainer: '#f9dedc',
    error: '#f2b8b5',
  }),
}));

import DownloadBottomSheet from '../src/components/DownloadBottomSheet';

describe('DownloadBottomSheet', () => {
  it('keeps fixed snap points when no servers are found', () => {
    act(() => {
      renderer.create(
        <DownloadBottomSheet
          data={[]}
          loading={false}
          title="Streams"
          showModal={true}
          setModal={jest.fn()}
          onPressVideo={jest.fn()}
          onPressSubs={jest.fn()}
          error="No server found"
        />,
      );
    });

    expect(mockBottomSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enableDynamicSizing: false,
        snapPoints: ['50%', '85%'],
      }),
    );
  });

  it('does not call a missing close method while mounted hidden', () => {
    expect(() => {
      act(() => {
        renderer.create(
          <DownloadBottomSheet
            data={[]}
            loading={false}
            title="Streams"
            showModal={false}
            setModal={jest.fn()}
            onPressVideo={jest.fn()}
            onPressSubs={jest.fn()}
          />,
        );
      });
    }).not.toThrow();
  });
});
