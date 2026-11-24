import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Image, Text, TouchableOpacity, View} from 'react-native';

const mockNavigate = jest.fn();
const mockHapticTrigger = jest.fn();

jest.mock('../src/lib/storage/StorageService', () => {
  const bools = new Map<string, boolean>();
  const strings = new Map<string, string>();
  const numbers = new Map<string, number>();
  const arrays = new Map<string, unknown[]>();
  return {
    StorageService: jest.fn(),
    registerStorageClearHook: jest.fn(),
    clearAllMMKVStorage: jest.fn(),
    createZustandStorage: jest.fn(() => ({
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    })),
    mainStorage: {
      __clear: () => {
        bools.clear();
        strings.clear();
        numbers.clear();
        arrays.clear();
      },
      getBool: (key: string, defaultValue = false) =>
        bools.has(key) ? Boolean(bools.get(key)) : defaultValue,
      setBool: (key: string, value: boolean) => bools.set(key, value),
      getString: (key: string) => strings.get(key),
      setString: (key: string, value: string) => strings.set(key, value),
      getNumber: (key: string) => numbers.get(key),
      setNumber: (key: string, value: number) => numbers.set(key, value),
      getArray: (key: string) => arrays.get(key),
      setArray: (key: string, value: unknown[]) => arrays.set(key, value),
      delete: jest.fn(),
      getRevision: jest.fn(() => 0),
    },
    cacheStorage: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
  };
});

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: {trigger: (...args: unknown[]) => mockHapticTrigger(...args)},
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate, isFocused: () => true}),
  NavigationContext: require('react').createContext({isFocused: () => true}),
}));

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react');
  const {View: RNView} = require('react-native');
  return {
    FlatList: ({data = [], renderItem, ListFooterComponent}: any) =>
      ReactModule.createElement(
        RNView,
        null,
        data.map((item: any, index: number) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            {key: String(item?.link ?? index)},
            renderItem?.({item, index}),
          ),
        ),
        ListFooterComponent ?? null,
      ),
  };
});

jest.mock('react-native-reanimated', () => {
  const {View: RNView} = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RNView,
      createAnimatedComponent: (component: unknown) => component,
    },
  };
});

jest.mock('expo-blur', () => ({BlurView: 'BlurView'}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('../src/lib/tv/constants', () => ({
  isTV: false,
  TV_FOCUS_BORDER_WIDTH: 2,
  TV_FOCUS_ANIMATION_DURATION: 0,
}));
jest.mock('../src/lib/tv', () => ({
  isTV: false,
}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#ffffff',
}));
jest.mock('../src/lib/tv/useTVRemote', () => ({
  useTVRemote: jest.fn(),
}));
jest.mock('../src/lib/tv/useTVNavFocusMemory', () => ({
  useSafeIsNavFocused: () => true,
  useTVNavFocusMemory: () => ({
    preferredFocus: false,
    onFocus: jest.fn(),
    onBlur: jest.fn(),
  }),
}));

jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    background: '#111111',
    surfaceContainerHigh: '#222222',
    surfaceContainerHighest: '#2a2a2a',
    primaryContainer: '#333344',
    onPrimaryContainer: '#ffffff',
    onPrimary: '#000000',
    onBackground: '#ffffff',
    onSurface: '#ffffff',
    onSurfaceVariant: '#aaaaaa',
    outlineVariant: '#444444',
    primary: '#ff8888',
  }),
}));

jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/Button', () => {
  const ReactModule = require('react');
  const {Text: RNText} = require('react-native');
  return function MockButton({children, onPress}: any) {
    return ReactModule.createElement(
      'MockButton',
      {accessibilityRole: 'button', onPress},
      ReactModule.createElement(RNText, null, children),
    );
  };
});
jest.mock('../src/components/Skeleton', () => 'SkeletonLoader');
jest.mock('../src/components/tv', () => {
  const {View: RNView} = require('react-native');
  return {
    TVFocusable: RNView,
    TVFocusGuide: RNView,
  };
});

jest.mock('react-native-video', () => ({
  __esModule: true,
  default: 'MockVideo',
  ResizeMode: {CONTAIN: 'contain'},
  ViewType: {TEXTURE: 0, SURFACE: 1},
}));

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: (select: any) => select({provider: {value: 'provA'}}),
}));

import {resolvePostPreview} from '../src/lib/providers/postPreview';
import type {Post} from '../src/lib/providers/types';
import {SettingsKeys, settingsStorage} from '../src/lib/storage/SettingsStorage';
import useNavigationPreferencesStore from '../src/lib/zustand/navigationPreferencesStore';
import useTitlePreviewStore from '../src/lib/zustand/titlePreviewStore';
import Slider from '../src/components/Slider';
import TitlePreviewHost from '../src/components/TitlePreviewHost';

beforeEach(() => {
  (require('../src/lib/storage/StorageService').mainStorage as any).__clear();
  jest.clearAllMocks();
  useTitlePreviewStore.getState().dismissPreview();
  useNavigationPreferencesStore.setState({
    holdPreviewEnabled: true,
    holdPreviewOnlyWhileHolding: false,
  });
});

describe('resolvePostPreview', () => {
  it('resolves string, object, video, and gif preview fields with sanitized headers', () => {
    expect(
      resolvePostPreview({
        title: 'Clip',
        link: 'https://prov.test/item',
        image: 'https://prov.test/poster.jpg',
        preview: 'https://cdn.test/clip.mp4',
      }),
    ).toEqual({
      url: 'https://cdn.test/clip.mp4',
      mediaType: 'video',
      explicitType: false,
      headers: undefined,
    });

    expect(
      resolvePostPreview({
        title: 'Gif Clip',
        link: 'https://prov.test/item2',
        image: 'https://prov.test/poster.jpg',
        preview: 'https://cdn.test/loop.gif?size=small',
      }),
    ).toEqual({
      url: 'https://cdn.test/loop.gif?size=small',
      mediaType: 'gif',
      explicitType: false,
      headers: undefined,
    });

    expect(
      resolvePostPreview({
        title: 'Object Preview',
        link: 'https://prov.test/item3',
        image: 'https://prov.test/poster.jpg',
        preview: {
          url: 'https://cdn.test/stream/123',
          type: 'video',
          headers: {
            Referer: 'https://prov.test/',
            BadHeader: 'bad\r\nvalue',
          },
        },
      }),
    ).toEqual({
      url: 'https://cdn.test/stream/123',
      mediaType: 'video',
      explicitType: true,
      headers: {Referer: 'https://prov.test/'},
    });

    expect(
      resolvePostPreview({
        title: 'Legacy Video + Headers',
        link: 'https://prov.test/item4',
        image: 'https://prov.test/poster.jpg',
        previewVideo: 'https://cdn.test/v.webm',
        previewHeaders: {Origin: 'https://prov.test'},
      }),
    ).toEqual({
      url: 'https://cdn.test/v.webm',
      mediaType: 'video',
      explicitType: true,
      headers: {Origin: 'https://prov.test'},
    });

    expect(
      resolvePostPreview({
        title: 'Gif Field',
        link: 'https://prov.test/item5',
        image: 'https://prov.test/poster.jpg',
        previewGif: 'https://cdn.test/preview/anim',
      }),
    ).toEqual({
      url: 'https://cdn.test/preview/anim',
      mediaType: 'gif',
      explicitType: true,
      headers: undefined,
    });
  });

  it('rejects unsafe, private, or missing preview urls', () => {
    const base = {
      title: 'Unsafe',
      link: 'https://prov.test/item',
      image: 'https://prov.test/poster.jpg',
    };
    expect(resolvePostPreview(base)).toBeNull();
    expect(
      resolvePostPreview({...base, preview: 'javascript:alert(1)'}),
    ).toBeNull();
    expect(
      resolvePostPreview({...base, preview: 'file:///sdcard/video.mp4'}),
    ).toBeNull();
    expect(
      resolvePostPreview({...base, preview: 'http://127.0.0.1/clip.mp4'}),
    ).toBeNull();
  });
});

describe('hold preview settings', () => {
  it('defaults hold preview enabled and only-while-holding disabled and persists changes', () => {
    expect(settingsStorage.isHoldPreviewEnabled()).toBe(true);
    expect(settingsStorage.isHoldPreviewOnlyWhileHolding()).toBe(false);

    settingsStorage.setHoldPreviewEnabled(false);
    expect(settingsStorage.isHoldPreviewEnabled()).toBe(false);
    expect(
      require('../src/lib/storage/StorageService').mainStorage.getBool(
        SettingsKeys.HOLD_PREVIEW_ENABLED,
      ),
    ).toBe(false);

    settingsStorage.setHoldPreviewOnlyWhileHolding(true);
    expect(settingsStorage.isHoldPreviewOnlyWhileHolding()).toBe(true);
    expect(
      require('../src/lib/storage/StorageService').mainStorage.getBool(
        SettingsKeys.HOLD_PREVIEW_ONLY_WHILE_HOLDING,
      ),
    ).toBe(true);
  });
});

describe('Slider and TitlePreviewHost interactions', () => {
  const posts: Post[] = [
    {
      title: 'With Video Preview',
      link: 'https://prov.test/video-show',
      image: 'https://prov.test/poster-video.jpg',
      preview: 'https://cdn.test/trailer.mp4',
    },
    {
      title: 'With Gif Preview',
      link: 'https://prov.test/gif-show',
      image: 'https://prov.test/poster-gif.jpg',
      previewGif: 'https://cdn.test/clip.gif',
    },
    {
      title: 'No Preview Show',
      link: 'https://prov.test/plain-show',
      image: 'https://prov.test/poster-plain.jpg',
    },
  ];

  const renderSliderWithHost = (enableHoldPreview = true) =>
    renderer.create(
      <View style={{flex: 1}}>
        <Slider
          isLoading={false}
          title="Trending"
          posts={posts}
          filter="trending"
          providerValue="provA"
          enableHoldPreview={enableHoldPreview}
        />
        <TitlePreviewHost />
      </View>,
    );

  it('shows volume only for videos with audio and opens the title when the preview is tapped', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderSliderWithHost(true);
    });

    const cards = tree.root.findAllByType(TouchableOpacity);
    expect(cards).toHaveLength(3);

    act(() => {
      cards[0].props.onLongPress();
    });

    expect(mockHapticTrigger).toHaveBeenCalledTimes(1);
    const videos = tree.root.findAllByType('MockVideo' as any);
    expect(videos).toHaveLength(1);
    expect(videos[0].props.source).toEqual({
      uri: 'https://cdn.test/trailer.mp4',
      headers: undefined,
    });
    expect(videos[0].props.viewType).toBe(0);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Unmute preview'})).toHaveLength(0);
    act(() => videos[0].props.onLoad({audioTracks: [], duration: 20}));
    const scrubber = tree.root.findAllByProps({accessibilityLabel: 'Preview position'})[0];
    act(() => scrubber.props.onLayout({nativeEvent: {layout: {width: 200}}}));
    act(() => scrubber.props.onResponderGrant({nativeEvent: {locationX: 100}}));
    act(() => videos[0].props.onProgress({currentTime: 1}));
    expect(scrubber.props.accessibilityValue.now).toBe(10);
    act(() => scrubber.props.onResponderRelease({nativeEvent: {locationX: 150}}));
    expect(scrubber.props.accessibilityValue.now).toBe(15);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Unmute preview'})).toHaveLength(0);
    act(() => videos[0].props.onAudioTracks({audioTracks: [{index: 0}]}));
    const volume = tree.root.findAllByProps({accessibilityLabel: 'Unmute preview'})[0];
    act(() => volume.props.onPress());
    expect(videos[0].props.muted).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();

    // Releasing card does NOT close preview when only-while-holding is off
    act(() => {
      tree.root.findAllByType(View).find(v => v.props.onTouchEnd)?.props.onTouchEnd();
    });
    expect(tree.root.findAllByType('MockVideo' as any)).toHaveLength(1);

    expect(tree.root.findAllByType('MockButton' as any)).toHaveLength(0);
    const openPreview = tree.root.findAllByProps({accessibilityLabel: 'Open title'})[0];
    act(() => {
      openPreview.props.onPress();
    });
    expect(tree.root.findAllByType('MockVideo' as any)).toHaveLength(0);
    expect(mockNavigate).toHaveBeenCalledWith('Info', {
      link: 'https://prov.test/video-show',
      provider: 'provA',
      poster: 'https://prov.test/poster-video.jpg',
    });

    // Disabling haptic feedback suppresses vibration on hold
    mockHapticTrigger.mockClear();
    settingsStorage.setHapticFeedbackEnabled(false);
    act(() => {
      cards[1].props.onLongPress();
    });
    expect(mockHapticTrigger).not.toHaveBeenCalled();
    const gifImages = tree.root
      .findAllByType(Image)
      .filter(img => img.props.source?.uri === 'https://cdn.test/clip.gif');
    expect(gifImages).toHaveLength(1);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Unmute preview'})).toHaveLength(0);

    act(() => tree.unmount());
  });

  it('ignores cards without a preview and when preview is disabled', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderSliderWithHost(true);
    });

    const cards = tree.root.findAllByType(TouchableOpacity);
    expect(cards[2].props.onLongPress).toBeUndefined();
    expect(useTitlePreviewStore.getState().activePreview).toBeUndefined();
    expect(mockHapticTrigger).not.toHaveBeenCalled();

    act(() => {
      useNavigationPreferencesStore.setState({holdPreviewEnabled: false});
    });
    const disabledCards = tree.root.findAllByType(TouchableOpacity);
    expect(disabledCards[0].props.onLongPress).toBeUndefined();
    act(() => tree.unmount());

    let nonPreviewTree!: renderer.ReactTestRenderer;
    act(() => {
      nonPreviewTree = renderSliderWithHost(false);
    });
    const otherCards = nonPreviewTree.root.findAllByType(TouchableOpacity);
    expect(otherCards[0].props.onLongPress).toBeUndefined();
    act(() => nonPreviewTree.unmount());
  });

  it('uses non-blocking overlay and closes on release when only-while-holding is enabled', () => {
    useNavigationPreferencesStore.setState({
      holdPreviewEnabled: true,
      holdPreviewOnlyWhileHolding: true,
    });

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderSliderWithHost(true);
    });

    const cards = tree.root.findAllByType(TouchableOpacity);
    act(() => {
      cards[0].props.onLongPress();
    });

    expect(tree.root.findAllByType('MockVideo' as any)).toHaveLength(1);
    const releaseHint = tree.root
      .findAllByType(Text)
      .find(t => t.props.children === 'Release to close');
    expect(releaseHint).toBeUndefined();
    const overlayRoot = tree.root
      .findAllByType(View)
      .find(v => v.props.pointerEvents === 'none' && v.props.accessibilityViewIsModal === false);
    expect(overlayRoot).toBeDefined();
    const touchTarget = tree.root.findAllByType(View).find(v => v.props.onTouchEnd);
    expect(touchTarget).toBeDefined();
    act(() => cards[0].props.onPressOut?.());
    expect(tree.root.findAllByType('MockVideo' as any)).toHaveLength(1);

    act(() => {
      touchTarget!.props.onTouchEnd();
    });
    expect(tree.root.findAllByType('MockVideo' as any)).toHaveLength(0);
    expect(useTitlePreviewStore.getState().activePreview).toBeUndefined();

    act(() => tree.unmount());
  });
});
