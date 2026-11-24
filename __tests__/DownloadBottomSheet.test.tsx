import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ScrollView, SectionList, TouchableOpacity} from 'react-native';
import type {TextTracks} from '../src/lib/providers/types';

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
    BottomSheetSectionList: ReactNative.SectionList,
    BottomSheetView: ReactNative.View,
    BottomSheetBackdrop: ReactNative.View,
  };
});

jest.mock('../src/components/SearchSubtitles', () => ({
  __esModule: true,
  default: ({renderTrigger}: any) => renderTrigger?.(() => {}) ?? null,
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View, TVFocusGuide: View};
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

  it('reopens cached sources with a fresh animated sheet', () => {
    const props = {
      data: Array.from({length: 20}, (_, index) => ({
        server: `Server ${index}`,
        link: `https://example.com/${index}.mp4`,
        type: 'mp4',
      })),
      loading: false,
      setModal: jest.fn(),
      onPressVideo: jest.fn(),
      onPressSubs: jest.fn(),
    };
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DownloadBottomSheet {...props} showModal />);
    });
    const firstScrollView = tree!.root.findByType(ScrollView);
    act(() => {
      tree!.update(<DownloadBottomSheet {...props} showModal={false} />);
    });
    expect(tree!.toJSON()).toBeNull();
    act(() => {
      tree!.update(<DownloadBottomSheet {...props} showModal />);
    });
    expect(tree!.root.findByType(ScrollView)).not.toBe(firstScrollView);
    expect(mockBottomSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({index: 0}),
    );
    expect(mockBottomSheetProps).toHaveBeenLastCalledWith(
      expect.not.objectContaining({animateOnMount: false}),
    );
    act(() => tree!.unmount());
  });

  it('mounts only a window of a long subtitle list when switching tabs', () => {
    const subtitles: TextTracks = Array.from({length: 300}, (_, index) => ({
      title: `Subtitle ${index}`,
      uri: `https://example.com/${index}.vtt`,
      language: 'en',
      type: 'text/vtt' as TextTracks[number]['type'],
    }));
    const onPressSubs = jest.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <DownloadBottomSheet
          data={[{
            server: 'Server',
            link: 'https://example.com/video.mp4',
            type: 'mp4',
            subtitles: [
              ...subtitles,
              {...subtitles[0], title: 'Alias'},
              {...subtitles[0], title: 'Alias', uri: 'https://example.com/alias.vtt'},
            ],
          }]}
          loading={false}
          showModal
          setModal={jest.fn()}
          onPressVideo={jest.fn()}
          onPressSubs={onPressSubs}
          downloadedSubtitles={[{id: 'saved', title: 'Saved subtitle'}]}
        />,
      );
    });

    const pressTab = (tab: string) => {
      const button = tree!.root.findAllByType(TouchableOpacity).find(
        node => node.props.accessibilityLabel === `${tab} download sources`,
      );
      act(() => button!.props.onPress());
    };
    pressTab('Subtitle');

    expect(tree!.root.findByType(SectionList).props.sections).toEqual([
      expect.objectContaining({title: 'Downloaded', data: [expect.objectContaining({id: 'saved'})]}),
      expect.objectContaining({title: 'Available', data: subtitles}),
    ]);
    const downloadButtons = tree!.root.findAllByType(TouchableOpacity).filter(
      node => node.props.accessibilityLabel?.startsWith('Download subtitle '),
    );
    expect(downloadButtons.length).toBeGreaterThan(0);
    expect(downloadButtons.length).toBeLessThan(30);
    act(() => downloadButtons[0].props.onPress());
    expect(onPressSubs).toHaveBeenCalledWith({
      link: subtitles[0].uri,
      title: subtitles[0].title,
      type: 'text/vtt',
    });

    pressTab('Video');
    expect(tree!.root.findAllByType(SectionList)).toHaveLength(0);
    act(() => tree!.unmount());
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
