import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Gesture} from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {settingsStorage} from '../../lib/storage';
import {GLASS_BAR_PADDING} from './FloatingTabBarInsetContext';

const lensSpring = {damping: 19, stiffness: 250, mass: 0.72};

interface UseGlassTabBarGestureParams {
  itemCount: number;
  selectedIndex: number;
  reducedMotion: boolean;
  rtl: boolean;
  hidden: boolean;
  onSelect: (index: number, options?: {skipHaptic?: boolean}) => boolean;
}

export function useGlassTabBarGesture({
  itemCount,
  selectedIndex,
  reducedMotion,
  rtl,
  hidden,
  onSelect,
}: UseGlassTabBarGestureParams) {
  const [barWidth, setBarWidth] = useState(0);
  const onSelectRef = useRef(onSelect);
  const selectedIndexRef = useRef(selectedIndex);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const position = useSharedValue(selectedIndex);
  const targetIndex = useSharedValue(selectedIndex);
  const pressed = useSharedValue(0);
  const width = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastHovered = useSharedValue(-1);
  const countShared = useSharedValue(Math.max(1, itemCount));
  const selectedIndexShared = useSharedValue(selectedIndex);
  const hiddenShared = useSharedValue(hidden);

  useEffect(() => {
    hiddenShared.set(hidden);
  }, [hidden, hiddenShared]);

  useEffect(() => {
    selectedIndexShared.set(selectedIndex);
    countShared.set(Math.max(1, itemCount));
    if (!dragging.get() && targetIndex.get() !== selectedIndex) {
      targetIndex.set(selectedIndex);
      position.set(
        reducedMotion ? selectedIndex : withSpring(selectedIndex, lensSpring),
      );
    }
  }, [
    countShared,
    dragging,
    itemCount,
    position,
    reducedMotion,
    selectedIndex,
    selectedIndexShared,
    targetIndex,
  ]);

  const triggerHoverHaptic = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
  }, []);

  const handleFinishSelection = useCallback(
    (index: number, fromDrag: boolean) => {
      if (!onSelectRef.current(index, {skipHaptic: fromDrag})) {
        const fallback = selectedIndexRef.current;
        targetIndex.set(fallback);
        position.set(
          reducedMotion ? fallback : withSpring(fallback, lensSpring),
        );
      }
    },
    [position, reducedMotion, targetIndex],
  );

  const gesture = useMemo(() => {
    const indexAt = (x: number) => {
      'worklet';
      const innerWidth = width.get() - GLASS_BAR_PADDING * 2;
      const safeCount = Math.max(1, countShared.get());
      if (innerWidth <= 0) {
        return selectedIndexShared.get();
      }
      const localX = x - GLASS_BAR_PADDING;
      const ratio = rtl ? 1 - localX / innerWidth : localX / innerWidth;
      const unit = safeCount * ratio - 0.5;
      return Math.max(0, Math.min(safeCount - 1, unit));
    };

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(4)
      .onBegin(() => {
        if (hiddenShared.get()) return;
        pressed.set(reducedMotion ? 1 : withTiming(1, {duration: 90}));
      })
      .onStart(event => {
        if (hiddenShared.get()) return;
        dragging.set(true);
        targetIndex.set(-1);
        if (width.get() > 0) {
          const nextPos = indexAt(event.x);
          position.set(nextPos);
          const hovered = Math.round(nextPos);
          lastHovered.set(hovered);
        }
      })
      .onUpdate(event => {
        if (hiddenShared.get() || !dragging.get()) return;
        if (width.get() > 0) {
          const nextPos = indexAt(event.x);
          position.set(nextPos);
          const hovered = Math.round(nextPos);
          if (hovered !== lastHovered.get()) {
            lastHovered.set(hovered);
            runOnJS(triggerHoverHaptic)();
          }
        }
      })
      .onEnd((event, success) => {
        if (!success || hiddenShared.get() || width.get() <= 0) return;
        const next = Math.round(indexAt(event.x));
        targetIndex.set(next);
        position.set(reducedMotion ? next : withSpring(next, lensSpring));
        runOnJS(handleFinishSelection)(next, true);
      })
      .onFinalize((_event, success) => {
        if (!success && dragging.get()) {
          const current = selectedIndexShared.get();
          targetIndex.set(current);
          position.set(
            reducedMotion ? current : withSpring(current, lensSpring),
          );
        }
        dragging.set(false);
        lastHovered.set(-1);
        pressed.set(reducedMotion ? 0 : withSpring(0, lensSpring));
      });

    const tap = Gesture.Tap()
      .maxDuration(10000)
      .maxDistance(16)
      .onEnd((event, success) => {
        if (!success || hiddenShared.get() || width.get() <= 0) return;
        const next = Math.round(indexAt(event.x));
        targetIndex.set(next);
        position.set(reducedMotion ? next : withSpring(next, lensSpring));
        runOnJS(handleFinishSelection)(next, false);
      });

    return Gesture.Race(pan, tap);
  }, [
    countShared,
    dragging,
    handleFinishSelection,
    hiddenShared,
    lastHovered,
    position,
    pressed,
    reducedMotion,
    rtl,
    selectedIndexShared,
    targetIndex,
    triggerHoverHaptic,
    width,
  ]);

  const lens = useAnimatedStyle(() => {
    const totalWidth = width.get();
    const innerWidth = Math.max(0, totalWidth - GLASS_BAR_PADDING * 2);
    const tabWidth = innerWidth / Math.max(1, countShared.get());
    const lift = Math.max(0, Math.min(1, pressed.get()));
    const travel = position.get() * tabWidth * (rtl ? -1 : 1);
    return {
      opacity: innerWidth > 0 ? 1 : 0,
      transform: [
        {translateX: travel},
        {scaleX: reducedMotion ? 1 : 1 + lift * 0.04},
        {scaleY: reducedMotion ? 1 : 1 + lift * 0.06},
      ],
    };
  });

  const pressHighlight = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, pressed.get())),
  }));

  const handleBarLayout = useCallback(
    (layoutWidth: number) => {
      width.set(layoutWidth);
      setBarWidth(previous =>
        Math.abs(layoutWidth - previous) > 0.5 ? layoutWidth : previous,
      );
    },
    [width],
  );

  return {
    barWidth,
    position,
    gesture,
    lens,
    pressHighlight,
    handleBarLayout,
  };
}
