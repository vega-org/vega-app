import {BlurView} from 'expo-blur';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {
  Dimensions,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const mockHapticTrigger = jest.fn();
let mockGlassEnabled = true;
let mockShowLabels = true;
let mockHapticsEnabled = true;
let mockInsets = {top: 24, right: 0, bottom: 16, left: 0};

let latestPanBuilder: any;
let latestTapBuilder: any;
let latestAnimatedStyleFn: (() => any) | undefined;
const mockRace = jest.fn((pan: unknown, tap: unknown) => ({
  type: 'race',
  pan,
  tap,
}));

jest.mock('expo-blur', () => ({BlurView: 'BlurView'}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: {trigger: (...args: unknown[]) => mockHapticTrigger(...args)},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  G: 'G',
  Path: 'Path',
  Circle: 'Circle',
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  const {View: RNView} = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RNView,
      createAnimatedComponent: (component: unknown) => component,
    },
    useSharedValue: (initial: unknown) =>
      ReactModule.useRef({
        value: initial,
        get() {
          return this.value;
        },
        set(next: unknown) {
          this.value = next;
        },
      }).current,
    useAnimatedStyle: (fn: () => any) => {
      const evaluated = fn();
      if (evaluated && 'backgroundColor' in evaluated) {
        latestAnimatedStyleFn = fn;
      }
      return evaluated;
    },
    useAnimatedProps: (fn: () => unknown) => fn(),
    useReducedMotion: () => false,
    withSpring: jest.fn((value: unknown) => value),
    withTiming: jest.fn(
      (value: unknown, _config?: unknown, cb?: (finished?: boolean) => void) => {
        cb?.(true);
        return value;
      },
    ),
    cancelAnimation: jest.fn(),
    runOnJS: (fn: unknown) => fn,
    Easing: {cubic: (value: number) => value, inOut: (fn: unknown) => fn},
    Extrapolation: {CLAMP: 'clamp'},
    interpolate: (value: number, [start, end]: number[], [from, to]: number[]) =>
      from +
      Math.max(0, Math.min(1, (value - start) / (end - start))) * (to - from),
  };
});
jest.mock('react-native-gesture-handler', () => {
  const createBuilder = (kind: 'pan' | 'tap') => {
    const gesture: any = {
      kind,
      maxPointersCount: undefined,
      minDist: undefined,
      longPressDuration: undefined,
      maxDurationMs: undefined,
      maxDist: undefined,
      begin: undefined,
      start: undefined,
      update: undefined,
      end: undefined,
      finalize: undefined,
      maxPointers(n: number) {
        this.maxPointersCount = n;
        return this;
      },
      minDistance(d: number) {
        this.minDist = d;
        return this;
      },
      activateAfterLongPress(ms: number) {
        this.longPressDuration = ms;
        return this;
      },
      maxDuration(ms: number) {
        this.maxDurationMs = ms;
        return this;
      },
      maxDistance(d: number) {
        this.maxDist = d;
        return this;
      },
      onBegin(fn: unknown) {
        this.begin = fn;
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
    };
    if (kind === 'pan') latestPanBuilder = gesture;
    else latestTapBuilder = gesture;
    return gesture;
  };
  return {
    GestureDetector: 'GestureDetector',
    Gesture: {
      Pan: () => createBuilder('pan'),
      Tap: () => createBuilder('tap'),
      Race: (pan: unknown, tap: unknown) => mockRace(pan, tap),
    },
  };
});
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isGlassTabBarEnabled: () => mockGlassEnabled,
    hideGlassTabBarInSubpages: () => true,
    showTabBarLabels: () => mockShowLabels,
    isHapticFeedbackEnabled: () => mockHapticsEnabled,
    hideDownloadsTab: () => false,
    showContinueWatching: () => true,
    setGlassTabBarEnabled: jest.fn(),
    setHideGlassTabBarInSubpages: jest.fn(),
    setHideDownloadsTab: jest.fn(),
    setShowContinueWatching: jest.fn(),
  },
}));
jest.mock('../src/lib/tv/constants', () => ({isTV: false}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#ffffff',
}));
jest.mock('../src/components/tv', () => ({
  TVFocusable: 'TVFocusable',
}));
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    background: '#111111',
    surfaceContainerHigh: '#222222',
    secondaryContainer: '#333333',
    onSecondaryContainer: '#eeeeee',
    onSurface: '#ffffff',
    onSurfaceVariant: '#aaaaaa',
    outlineVariant: '#444444',
    primary: '#ff8888',
  }),
}));

import {
  FloatingTabBarInsetContext,
  GLASS_BAR_PADDING,
  getGlassTabBarClearance,
  isTabRouteOnSubpage,
  useFloatingTabBarInset,
} from '../src/components/navigation/FloatingTabBarInsetContext';
import {
  GlassTabBar,
  type GlassTabItem,
} from '../src/components/navigation/GlassTabBar';
import StreamingTabBar from '../src/components/navigation/StreamingTabBar';
import {syncTabVisibility, useTabVisibilityStore} from '../src/lib/zustand/tabVisibilityStore';
import useNavigationPreferencesStore from '../src/lib/zustand/navigationPreferencesStore';

const FIVE_ROUTES = [
  {key: 'home', name: 'HomeStack', title: 'Home'},
  {key: 'search', name: 'SearchStack', title: 'Search'},
  {key: 'library', name: 'WatchListStack', title: 'Library'},
  {key: 'downloads', name: 'DownloadsStack', title: 'Downloads'},
  {key: 'settings', name: 'SettingsStack', title: 'Settings'},
];

const FIVE_ITEMS: GlassTabItem[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'search', label: 'Search', icon: 'search'},
  {key: 'library', label: 'Library', icon: 'watchlist'},
  {key: 'downloads', label: 'Downloads', icon: 'download'},
  {key: 'settings', label: 'Settings', icon: 'settings'},
];

function makeBottomTabProps(
  routes = FIVE_ROUTES,
  selectedIndex = 0,
  routeStates?: Record<string, any>,
) {
  const emit = jest.fn(() => ({defaultPrevented: false}));
  const navigate = jest.fn();
  const descriptors: Record<string, any> = {};
  for (const route of routes) {
    descriptors[route.key] = {
      options: {
        title: route.title,
        tabBarHideOnKeyboard: true,
      },
    };
  }
  return {
    state: {
      index: selectedIndex,
      routes: routes.map(r => ({
        key: r.key,
        name: r.name,
        params: undefined,
        state: routeStates?.[r.key],
      })),
    } as any,
    descriptors: descriptors as any,
    navigation: {emit, navigate} as any,
    insets: mockInsets,
  };
}

function getTranslateX(style: any): number {
  const flat = StyleSheet.flatten(style) || {};
  const transform = Array.isArray(flat.transform) ? flat.transform : [];
  const entry = transform.find((t: any) => 'translateX' in t);
  return entry?.translateX ?? 0;
}

beforeEach(() => {
  useTabVisibilityStore.setState({subpages: {}});
  jest.clearAllMocks();
  Dimensions.set({
    window: {width: 390, height: 844, scale: 2, fontScale: 1},
    screen: {width: 390, height: 844, scale: 2, fontScale: 1},
  });
  mockGlassEnabled = true;
  mockShowLabels = true;
  mockHapticsEnabled = true;
  mockInsets = {top: 24, right: 0, bottom: 16, left: 0};
  latestPanBuilder = undefined;
  latestTapBuilder = undefined;
  latestAnimatedStyleFn = undefined;
  useNavigationPreferencesStore.setState({
    glassTabBar: true,
    hideGlassTabBarInSubpages: true,
  });
});

it.each([
  [0, 'Home', 'Info'],
  [1, 'Search', 'SearchResults'],
  [2, 'WatchList', 'LocalContent'],
  [3, 'Downloads', 'DownloadedDetails'],
  [4, 'Settings', 'Extensions'],
  [4, 'Settings', 'Preferences'],
  [4, 'Settings', 'Appearance'],
  [4, 'Settings', 'PlayerSettings'],
  [4, 'Settings', 'About'],
])('restores the bar after returning from %s / %s / %s with cached tab props', (index, root, page) => {
  const selected = Number(index);
  const tab = FIVE_ROUTES[selected];
  // Keep tab-bar props on the subpage snapshot while the container publishes
  // the pop. This reproduces the nested navigator/cache boundary.
  const props = makeBottomTabProps(FIVE_ROUTES, selected, {
    [tab.key]: {index: 1, routes: [{name: root}, {name: page}]},
  });
  const publish = (onSubpage: boolean) => syncTabVisibility({
    type: 'stack', index: 0, routes: [{name: 'TabStack', state: {
      type: 'tab', index: selected, routes: FIVE_ROUTES.map(r => ({...r, state: {
        index: r.key === tab.key && onSubpage ? 1 : 0,
        routes: [{name: root}, ...(r.key === tab.key && onSubpage ? [{name: page}] : [])],
      }})),
    }}],
  });
  let tree!: renderer.ReactTestRenderer;
  act(() => {publish(true); tree = renderer.create(<StreamingTabBar {...props} />);});
  expect(tree.root.findByType(GlassTabBar).props.hidden).toBe(true);
  act(() => publish(false));
  expect(tree.root.findByType(GlassTabBar).props.hidden).toBe(false);
  expect(tree.root.findAllByType(View)[0].props.pointerEvents).toBe('box-none');
  act(() => tree.unmount());
});

it('renders a floating transparent overlay in Glass mode and a docked bar in Material mode', () => {
  const glassProps = makeBottomTabProps();
  const blurTarget = {} as View;
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<StreamingTabBar {...glassProps} blurTarget={blurTarget} />);
  });

  const rootView = tree.root.findAllByType(View)[0];
  const glassStyle = StyleSheet.flatten(rootView.props.style);
  expect(rootView.props.pointerEvents).toBe('box-none');
  expect(glassStyle.position).toBe('absolute');
  expect(glassStyle.backgroundColor).toBe('transparent');
  const blurView = tree.root.findByType(BlurView);
  expect(blurView.props.blurTarget.current).toBe(blurTarget);
  expect(blurView.props.tint).toBe('systemChromeMaterialDark');
  expect(blurView.props.intensity).toBe(75);
  expect(blurView.props.blurReductionFactor).toBe(3.5);

  act(() => {
    useNavigationPreferencesStore.setState({glassTabBar: false});
  });

  const materialRoot = tree.root.findAllByType(View)[0];
  const materialStyle = StyleSheet.flatten(materialRoot.props.style);
  expect(materialStyle.position).not.toBe('absolute');
  expect(materialStyle.backgroundColor).toBe('#222222');

  act(() => tree.unmount());
});

it('avoids TouchableOpacity inside GlassTabBar and configures immediate Pan + Tap race', () => {
  const onSelect = jest.fn(() => true);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GlassTabBar
        items={FIVE_ITEMS}
        selectedIndex={0}
        showLabels
        onSelect={onSelect}
      />,
    );
  });

  expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  expect(latestPanBuilder.longPressDuration).toBeUndefined();
  expect(latestPanBuilder.minDist).toBe(4);
  expect(latestPanBuilder.maxPointersCount).toBe(1);
  expect(mockRace).toHaveBeenCalledWith(latestPanBuilder, latestTapBuilder);

  act(() => tree.unmount());
});

it('tracks finger movement 1:1 without recreating gesture, highlights hovered tab, and commits on release', () => {
  const onSelect = jest.fn(() => true);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GlassTabBar
        items={FIVE_ITEMS}
        selectedIndex={0}
        showLabels
        onSelect={onSelect}
      />,
    );
  });

  const detector = tree.root.findByType('GestureDetector' as any);
  const initialGesture = detector.props.gesture;
  const barView = detector.find(
    node =>
      typeof node.props.onLayout === 'function' && node.type === (View as any),
  );

  // Inner width = 400 (5 tabs => 80px each) with 4px horizontal padding on both sides.
  act(() => {
    barView.props.onLayout({nativeEvent: {layout: {width: 408}}});
  });

  // Start drag over tab 0 (center x = 4 + 40 = 44)
  act(() => {
    latestPanBuilder.begin();
    latestPanBuilder.start({x: 44});
  });
  expect(getTranslateX(latestAnimatedStyleFn!())).toBeCloseTo(0, 5);
  expect(mockHapticTrigger).not.toHaveBeenCalled();

  // Sub-pixel/mid-tab drag at x = 84 => index unit = 0.5 => translateX = 40px
  act(() => {
    latestPanBuilder.update({x: 84});
  });
  expect(getTranslateX(latestAnimatedStyleFn!())).toBeCloseTo(40, 5);
  expect(mockHapticTrigger).toHaveBeenCalledTimes(1);

  // Hovering tab 1 caused a re-render to highlight its label, yet gesture stays memoized!
  expect(detector.props.gesture).toBe(initialGesture);
  const texts = tree.root.findAllByType(Text);
  const searchLabel = texts.find(t => t.props.children === 'Search')!;
  const homeLabel = texts.find(t => t.props.children === 'Home')!;
  expect(StyleSheet.flatten(searchLabel.props.style).color).toBe('#FFFFFF');
  expect(StyleSheet.flatten(searchLabel.props.style).fontWeight).toBe('600');
  expect(StyleSheet.flatten(homeLabel.props.style).color).toBe(
    'rgba(255, 255, 255, 0.56)',
  );

  // Continue dragging to tab 2 (center x = 4 + 200 = 204)
  act(() => {
    latestPanBuilder.update({x: 204});
  });
  expect(getTranslateX(latestAnimatedStyleFn!())).toBeCloseTo(160, 5);
  expect(mockHapticTrigger).toHaveBeenCalledTimes(2);

  // Release on tab 2 => skips duplicate navigation haptic
  act(() => {
    latestPanBuilder.end({x: 204}, true);
    latestPanBuilder.finalize({}, true);
  });
  expect(onSelect).toHaveBeenCalledWith(2, {skipHaptic: true});

  act(() => tree.unmount());
});

it('handles direct taps and cancelled drags safely', () => {
  const props = makeBottomTabProps(FIVE_ROUTES, 0);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<StreamingTabBar {...props} />);
  });

  const detector = tree.root.findByType('GestureDetector' as any);
  const barView = detector.find(
    node =>
      typeof node.props.onLayout === 'function' && node.type === (View as any),
  );
  act(() => {
    barView.props.onLayout({nativeEvent: {layout: {width: 408}}});
  });

  // Tap on tab 3 ("Downloads", center x = 4 + 3.5 * 80 = 284)
  act(() => {
    latestTapBuilder.end({x: 284}, true);
  });
  expect(props.navigation.navigate).toHaveBeenCalledWith(
    'DownloadsStack',
    undefined,
  );
  expect(mockHapticTrigger).toHaveBeenCalledTimes(1);

  // Cancelled drag moves to tab 4 then aborts without navigating
  act(() => {
    latestPanBuilder.begin();
    latestPanBuilder.start({x: 44});
    latestPanBuilder.update({x: 364});
    latestPanBuilder.finalize({}, false);
  });
  expect(props.navigation.navigate).toHaveBeenCalledTimes(1);
  expect(getTranslateX(latestAnimatedStyleFn!())).toBeCloseTo(0, 5);

  const texts = tree.root.findAllByType(Text);
  const homeLabel = texts.find(t => t.props.children === 'Home')!;
  expect(StyleSheet.flatten(homeLabel.props.style).color).toBe('#FFFFFF');

  act(() => tree.unmount());
});

it('sizes labels and bubble geometry cleanly for 5-tab and 4-tab layouts', () => {
  const onSelect = jest.fn(() => true);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GlassTabBar
        items={FIVE_ITEMS}
        selectedIndex={0}
        showLabels
        onSelect={onSelect}
      />,
    );
  });

  const detector5 = tree.root.findByType('GestureDetector' as any);
  const bar5 = detector5.find(
    node =>
      typeof node.props.onLayout === 'function' && node.type === (View as any),
  );
  expect(StyleSheet.flatten(bar5.props.style).height).toBe(64);
  expect(GLASS_BAR_PADDING).toBe(4);

  const labels5 = tree.root.findAllByType(Text);
  for (const label of labels5) {
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(StyleSheet.flatten(label.props.style).fontSize).toBe(10.5);
  }

  act(() => {
    tree.update(
      <GlassTabBar
        items={FIVE_ITEMS.slice(0, 4)}
        selectedIndex={0}
        showLabels
        onSelect={onSelect}
      />,
    );
  });
  const labels4 = tree.root.findAllByType(Text);
  for (const label of labels4) {
    expect(StyleSheet.flatten(label.props.style).fontSize).toBe(11.5);
  }

  act(() => tree.unmount());
});

it('hides floating GlassTabBar when keyboard opens and restores when hidden', () => {
  const listeners: Record<string, (() => void) | undefined> = {};
  const addListenerSpy = jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((event: any, cb: any) => {
      listeners[event] = cb;
      return {remove: jest.fn()} as any;
    });

  const onSelect = jest.fn(() => true);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GlassTabBar
        items={FIVE_ITEMS}
        selectedIndex={0}
        showLabels
        hideOnKeyboard
        onSelect={onSelect}
      />,
    );
  });

  expect(tree.toJSON()).not.toBeNull();
  act(() => {
    listeners.keyboardDidShow?.();
    listeners.keyboardWillShow?.();
  });
  expect(tree.toJSON()).toBeNull();

  act(() => {
    listeners.keyboardDidHide?.();
    listeners.keyboardWillHide?.();
  });
  expect(tree.toJSON()).not.toBeNull();

  addListenerSpy.mockRestore();
  act(() => tree.unmount());
});

it('computes positive floating tab bar clearance and defaults context inset to 0', () => {
  expect(getGlassTabBarClearance(16, true)).toBe(98);
  expect(getGlassTabBarClearance(0, false)).toBe(80);

  let measured = -1;
  const Reader = () => {
    measured = useFloatingTabBarInset();
    return null;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Reader />);
  });
  expect(measured).toBe(0);

  act(() => {
    tree.update(
      <FloatingTabBarInsetContext.Provider value={98}>
        <Reader />
      </FloatingTabBarInsetContext.Provider>,
    );
  });
  expect(measured).toBe(98);
  act(() => tree.unmount());
});

it('detects subpages across direct, nested, and duplicated stack states', () => {
  expect(isTabRouteOnSubpage(undefined)).toBe(false);
  expect(
    isTabRouteOnSubpage({
      state: {index: 0, routes: [{}]},
    }),
  ).toBe(false);
  expect(
    isTabRouteOnSubpage({
      state: {index: 1, routes: [{}, {}]},
    }),
  ).toBe(true);
  expect(
    isTabRouteOnSubpage({
      state: {
        index: 0,
        routes: [{state: {index: 1, routes: [{}, {}]}}],
      },
    }),
  ).toBe(true);

  const rootPairs = [
    ['HomeStack', 'Home', 'Info'],
    ['SearchStack', 'Search', 'SearchResults'],
    ['WatchListStack', 'WatchList', 'LocalContent'],
    ['DownloadsStack', 'Downloads', 'DownloadedDetails'],
    ['SettingsStack', 'Settings', 'Extensions'],
  ] as const;

  for (const [tabName, rootScreen, subpage] of rootPairs) {
    expect(
      isTabRouteOnSubpage({
        name: tabName,
        state: {index: 0, routes: [{name: rootScreen}]},
      }),
    ).toBe(false);
    expect(
      isTabRouteOnSubpage({
        name: tabName,
        state: {
          index: 2,
          routes: [{name: rootScreen}, {name: subpage}, {name: rootScreen}],
        },
      }),
    ).toBe(false);
    expect(
      isTabRouteOnSubpage({
        name: tabName,
        state: {index: 1, routes: [{name: rootScreen}, {name: subpage}]},
      }),
    ).toBe(true);
  }

  expect(
    isTabRouteOnSubpage({
      name: 'SettingsStack',
      state: {
        index: 1,
        routes: [
          {name: 'Settings'},
          {
            name: 'DownloadsStack',
            state: {index: 0, routes: [{name: 'Downloads'}]},
          },
        ],
      },
    }),
  ).toBe(true);
});

it('restores the Glass bar when returning from Extensions to Settings even if Settings is at a higher index', () => {
  const blurTarget = {} as View;
  const settingsRoot = makeBottomTabProps(FIVE_ROUTES, 4, {
    settings: {index: 0, routes: [{name: 'Settings'}]},
  });
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <StreamingTabBar {...settingsRoot} blurTarget={blurTarget} />,
    );
  });
  expect(StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style).opacity).toBe(1);

  const onExtensions = makeBottomTabProps(FIVE_ROUTES, 4, {
    settings: {
      index: 1,
      routes: [{name: 'Settings'}, {name: 'Extensions'}],
    },
  });
  act(() => {
    tree.update(<StreamingTabBar {...onExtensions} blurTarget={blurTarget} />);
  });
  const hiddenRoot = tree.root.findAllByType(View)[0];
  const hiddenStyle = StyleSheet.flatten(hiddenRoot.props.style);
  expect(hiddenRoot.props.pointerEvents).toBe('none');
  expect(hiddenStyle.opacity).toBe(0);
  expect(getTranslateX(hiddenStyle)).toBe(-390);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(0);

  const returnedPopped = makeBottomTabProps(FIVE_ROUTES, 4, {
    settings: {index: 0, routes: [{name: 'Settings'}]},
  });
  act(() => {
    tree.update(<StreamingTabBar {...returnedPopped} blurTarget={blurTarget} />);
  });
  const poppedRoot = tree.root.findAllByType(View)[0];
  const poppedStyle = StyleSheet.flatten(poppedRoot.props.style);
  expect(poppedRoot.props.pointerEvents).toBe('box-none');
  expect(poppedStyle.opacity).toBe(1);
  expect(getTranslateX(poppedStyle)).toBeCloseTo(0, 5);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(1);

  act(() => {
    tree.update(<StreamingTabBar {...onExtensions} blurTarget={blurTarget} />);
  });
  const returnedDuplicated = makeBottomTabProps(FIVE_ROUTES, 4, {
    settings: {
      index: 2,
      routes: [{name: 'Settings'}, {name: 'Extensions'}, {name: 'Settings'}],
    },
  });
  act(() => {
    tree.update(
      <StreamingTabBar {...returnedDuplicated} blurTarget={blurTarget} />,
    );
  });
  const dupRoot = tree.root.findAllByType(View)[0];
  const dupStyle = StyleSheet.flatten(dupRoot.props.style);
  expect(dupRoot.props.pointerEvents).toBe('box-none');
  expect(dupStyle.opacity).toBe(1);
  expect(getTranslateX(dupStyle)).toBeCloseTo(0, 5);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(1);

  act(() => tree.unmount());
});

it('animates hiding the Glass bar on subpages when enabled and keeps Material bar visible', () => {
  const {withTiming} = require('react-native-reanimated');
  const rootProps = makeBottomTabProps(FIVE_ROUTES, 0, {
    home: {index: 0, routes: [{name: 'Home'}]},
  });
  const blurTarget = {} as View;
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <StreamingTabBar {...rootProps} blurTarget={blurTarget} />,
    );
  });

  const initialRoot = tree.root.findAllByType(View)[0];
  const initialStyle = StyleSheet.flatten(initialRoot.props.style);
  expect(initialRoot.props.pointerEvents).toBe('box-none');
  expect(initialStyle.opacity).toBe(1);
  expect(getTranslateX(initialStyle)).toBeCloseTo(0, 5);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(1);

  const subpageProps = makeBottomTabProps(FIVE_ROUTES, 0, {
    home: {index: 1, routes: [{name: 'Home'}, {name: 'Info'}]},
  });
  act(() => {
    tree.update(<StreamingTabBar {...subpageProps} blurTarget={blurTarget} />);
  });

  expect(withTiming).toHaveBeenCalledWith(
    1,
    expect.objectContaining({duration: 200}),
    expect.any(Function),
  );
  const hiddenRoot = tree.root.findAllByType(View)[0];
  const hiddenStyle = StyleSheet.flatten(hiddenRoot.props.style);
  expect(hiddenRoot.props.pointerEvents).toBe('none');
  expect(hiddenRoot.props.accessibilityElementsHidden).toBe(true);
  expect(hiddenRoot.props.importantForAccessibility).toBe(
    'no-hide-descendants',
  );
  expect(hiddenStyle.opacity).toBe(0);
  expect(getTranslateX(hiddenStyle)).toBe(-390);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(0);

  act(() => {
    useNavigationPreferencesStore.setState({hideGlassTabBarInSubpages: false});
  });
  expect(withTiming).toHaveBeenCalledWith(
    0,
    expect.objectContaining({duration: 200}),
    expect.any(Function),
  );
  const restoredRoot = tree.root.findAllByType(View)[0];
  const restoredStyle = StyleSheet.flatten(restoredRoot.props.style);
  expect(restoredRoot.props.pointerEvents).toBe('box-none');
  expect(restoredStyle.opacity).toBe(1);
  expect(getTranslateX(restoredStyle)).toBeCloseTo(0, 5);
  expect(tree.root.findAllByType(BlurView)).toHaveLength(1);

  act(() => {
    useNavigationPreferencesStore.setState({
      glassTabBar: false,
      hideGlassTabBarInSubpages: true,
    });
  });
  const materialRoot = tree.root.findAllByType(View)[0];
  const materialStyle = StyleSheet.flatten(materialRoot.props.style);
  expect(materialStyle.position).not.toBe('absolute');
  expect(materialStyle.opacity).not.toBe(0);
  expect(getTranslateX(materialStyle)).not.toBe(-390);

  act(() => tree.unmount());
});
