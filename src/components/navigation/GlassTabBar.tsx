import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BlurView} from 'expo-blur';
import LinearGradient from 'react-native-linear-gradient';
import {GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  I18nManager,
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  GLASS_BAR_BOTTOM_MARGIN,
  GLASS_BAR_HEIGHT_COMPACT,
  GLASS_BAR_HEIGHT_WITH_LABELS,
  GLASS_BAR_MIN_BOTTOM_INSET,
  GLASS_BAR_PADDING,
} from './FloatingTabBarInsetContext';
import {GlassTabBarItem, type GlassTabItem} from './GlassTabBarItem';
import {useGlassTabBarGesture} from './useGlassTabBarGesture';

export type {GlassTabItem};

interface GlassTabBarProps {
  items: GlassTabItem[];
  selectedIndex: number;
  showLabels: boolean;
  hideOnKeyboard?: boolean;
  hidden?: boolean;
  blurTarget?: View;
  onSelect: (index: number, options?: {skipHaptic?: boolean}) => boolean;
}

const SUBPAGE_TRANSITION_MS = 200;
const GLASS_GRADIENT_COLORS = [
  'rgba(44, 44, 48, 0.46)',
  'rgba(22, 22, 26, 0.46)',
];

const GlassTabBarBackdrop = React.memo(function GlassTabBarBackdrop({
  blurActive,
  blurTarget,
}: {
  blurActive: boolean;
  blurTarget?: View;
}) {
  const blurTargetRef = useMemo(
    () => (blurTarget ? {current: blurTarget} : undefined),
    [blurTarget],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {blurActive && (Platform.OS === 'ios' || blurTarget) && (
        <BlurView
          style={StyleSheet.absoluteFill}
          tint="systemChromeMaterialDark"
          intensity={75}
          blurReductionFactor={3.5}
          blurMethod={blurTarget ? 'dimezisBlurView' : undefined}
          blurTarget={blurTargetRef}
        />
      )}
      <LinearGradient
        colors={GLASS_GRADIENT_COLORS}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

export const GlassTabBar = React.memo(function GlassTabBar({
  items,
  selectedIndex,
  showLabels,
  hideOnKeyboard = false,
  hidden = false,
  blurTarget,
  onSelect,
}: GlassTabBarProps) {
  const insets = useSafeAreaInsets();
  const {width: windowWidth} = useWindowDimensions();
  const reducedMotion = Boolean(useReducedMotion());
  const rtl = I18nManager.isRTL;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [blurActive, setBlurActive] = useState(!hidden);
  const hiddenRef = useRef(hidden);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    if (!hideOnKeyboard) {
      setKeyboardVisible(false);
      return;
    }
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [hideOnKeyboard]);

  const hideProgress = useSharedValue(hidden ? 1 : 0);
  const windowWidthShared = useSharedValue(windowWidth);

  useEffect(() => {
    windowWidthShared.set(windowWidth);
  }, [windowWidth, windowWidthShared]);

  const handleHideFinished = useCallback(() => {
    if (hiddenRef.current) {
      setBlurActive(false);
    }
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      hideProgress.set(hidden ? 1 : 0);
      setBlurActive(!hidden);
      return;
    }
    if (!hidden) {
      setBlurActive(true);
    }
    hideProgress.set(
      withTiming(
        hidden ? 1 : 0,
        {
          duration: SUBPAGE_TRANSITION_MS,
          easing: Easing.inOut(Easing.cubic),
        },
        finished => {
          'worklet';
          if (finished && hidden) {
            runOnJS(handleHideFinished)();
          }
        },
      ),
    );
  }, [handleHideFinished, hidden, hideProgress, reducedMotion]);

  const subpageStyle = useAnimatedStyle(() => {
    const progress = hideProgress.get();
    const direction = rtl ? 1 : -1;
    const offset = progress * windowWidthShared.get() * direction;
    return {
      opacity: 1 - progress,
      transform: [{translateX: offset === 0 ? 0 : offset}],
    };
  });

  const {barWidth, position, gesture, lens, pressHighlight, handleBarLayout} =
    useGlassTabBarGesture({
      itemCount: items.length,
      selectedIndex,
      reducedMotion,
      rtl,
      hidden,
      onSelect,
    });

  const onBarLayout = useCallback(
    (event: LayoutChangeEvent) => {
      handleBarLayout(event.nativeEvent.layout.width);
    },
    [handleBarLayout],
  );

  if (hideOnKeyboard && keyboardVisible) {
    return null;
  }

  const pillHeight = showLabels
    ? GLASS_BAR_HEIGHT_WITH_LABELS
    : GLASS_BAR_HEIGHT_COMPACT;
  const pillRadius = pillHeight / 2;
  const selectionRadius = showLabels ? 28 : 22;
  const compactText = items.length >= 5;
  const sidePadding = 16;
  const tabWidth =
    barWidth > 0
      ? Math.max(0, barWidth - GLASS_BAR_PADDING * 2) /
        Math.max(1, items.length)
      : 0;

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.overlay,
        {
          paddingBottom:
            Math.max(insets.bottom, GLASS_BAR_MIN_BOTTOM_INSET) +
            GLASS_BAR_BOTTOM_MARGIN,
          paddingLeft: Math.max(insets.left, sidePadding),
          paddingRight: Math.max(insets.right, sidePadding),
        },
        subpageStyle,
      ]}>
      <View
        style={[
          styles.shadowShell,
          {
            borderRadius: pillRadius,
            width: items.length * 68 + GLASS_BAR_PADDING * 2,
          },
        ]}>
        <GestureDetector gesture={gesture}>
          <View
            onLayout={onBarLayout}
            style={[
              styles.glassBar,
              {
                height: pillHeight,
                borderRadius: pillRadius,
                paddingHorizontal: GLASS_BAR_PADDING,
                backgroundColor:
                  Platform.OS === 'ios' || blurTarget
                    ? 'transparent'
                    : 'rgba(22, 22, 26, 0.88)',
              },
            ]}>
            <GlassTabBarBackdrop
              blurActive={blurActive}
              blurTarget={blurTarget}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.glassSelection,
                {width: tabWidth, borderRadius: selectionRadius},
                lens,
              ]}>
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  styles.glassSelectionHighlight,
                  {borderRadius: selectionRadius},
                  pressHighlight,
                ]}
              />
            </Animated.View>
            {items.map((item, index) => (
              <GlassTabBarItem
                key={item.key}
                item={item}
                index={index}
                isFocused={index === selectedIndex}
                showLabels={showLabels}
                compactText={compactText}
                position={position}
                onSelect={onSelect}
              />
            ))}
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 20,
  },
  shadowShell: {
    maxWidth: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 14,
  },
  glassBar: {
    alignItems: 'center',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    overflow: 'hidden',
  },
  glassSelection: {
    position: 'absolute',
    top: GLASS_BAR_PADDING,
    bottom: GLASS_BAR_PADDING,
    start: GLASS_BAR_PADDING,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  glassSelectionHighlight: {
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
});
