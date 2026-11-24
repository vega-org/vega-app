import { View, Text, Dimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withSequence,
  useSharedValue,
  withDelay,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Icon from '@expo/vector-icons/MaterialIcons';
import AntDesign from '@expo/vector-icons/AntDesign';
import * as Brightness from 'expo-brightness';
import { VolumeManager } from 'react-native-volume-manager';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { settingsStorage } from '../../../lib/storage';
import {getPlayerVolumeLevels} from '../../../lib/playerVolume';

import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

type GesturesProps = {
  maxVolume: number;
  onVolumeBoostChange: (boost: number) => void;
  forward: (time?: number) => void;
  rewind: (time?: number) => void;
  togglePlayPause: () => void;
  seekerWidth: number;
  doubleTapTime: number;
  toggleControls: () => void;
  tapActionTimeout: React.MutableRefObject<NodeJS.Timeout | null>;
  tapAnywhereToPause: boolean;
  rewindTime: number;
  showControls: boolean;

  seekButtonsEnabled?: boolean;
  seekEnabled?: boolean;
  disableGesture: boolean;
  baseRate?: number;
  setPlayback: (rate: number) => void;
  clearControlTimeout: () => void;
  setControlTimeout: () => void;
  zoomScale: SharedValue<number>;
  zoomStartScale: SharedValue<number>;
  onSkipFeedback?: (side: 'left' | 'right', totalTime: number) => void;
};

const SWIPE_RANGE = 370;


const RIPPLE_FADE_DURATION = 400;

const Ripple = React.memo(
  ({
    visible,
    isLeft,
    totalTime,
  }: {
    visible: boolean;
    isLeft: boolean;
    totalTime: number;
  }) => {
    const scale = useSharedValue(0);
    const opacity = useSharedValue(0);

    useEffect(() => {
      cancelAnimation(scale);
      cancelAnimation(opacity);

      if (visible) {

        scale.value = 0.9;
        opacity.value = 0;
        scale.value = withTiming(1, { duration: 180 });
        opacity.value = withSequence(
          withTiming(0.28, { duration: 100 }),
          withDelay(120, withTiming(0, { duration: 180 })),
        );
      } else {
        scale.value = 0.9;
        opacity.value = 0;
      }
    }, [visible, totalTime, scale, opacity]);

    const rippleStyle = useAnimatedStyle(
      () => ({
        opacity: opacity.value,
        //@ts-ignore
        transform: [{ scale: scale.value }],
      }),
      [],
    );

    const contentRippleStyle = useAnimatedStyle(
      () => ({
        opacity: Math.min(opacity.value * 3.2, 1),
        transform: [{ scale: scale.value }],
      }),
      [],
    );

    const containerStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: '100%' as const,
        height: '100%' as const,
        zIndex: 999,
      }),
      [],
    );

    const innerStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        top: '-20%' as const,
        left: isLeft ? ('-48%' as const) : undefined,
        right: isLeft ? undefined : ('-48%' as const),
        width: '90%' as const,
        height: '140%' as const,
        backgroundColor: 'black',
        borderRadius: 9999,
      }),
      [isLeft],
    );

    const contentStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        top: '50%' as const,
        marginTop: -34,
        left: isLeft ? ('25%' as const) : undefined,
        right: isLeft ? undefined : ('25%' as const),
        marginLeft: isLeft ? -40 : 0,
        marginRight: isLeft ? 0 : -40,
        width: 104,
        flexDirection: 'row' as const,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        gap: 6,
      }),
      [isLeft],
    );

    const textStyle = useMemo(
      () => ({
        color: 'white',
        fontSize: 20,
        fontWeight: '700' as const,
      }),
      [],
    );

    return visible ? (
      <View style={containerStyle as any} pointerEvents="none">
        <Animated.View style={[innerStyle, rippleStyle]} />
        <Animated.View style={[contentStyle, contentRippleStyle]}>
          {isLeft && <AntDesign name="double-left" size={24} color="white" />}
          {!isNaN(totalTime) && totalTime > 0 && (
            <Text style={textStyle}>
              {isLeft ? '-' : '+'}
              {Math.floor(totalTime)}
            </Text>
          )}
          {!isLeft && <AntDesign name="double-right" size={24} color="white" />}
        </Animated.View>
      </View>
    ) : null;
  },
);

const INDICATOR_FADE_IN = 120;
const INDICATOR_FADE_OUT = 220;

const ControlOverlay = React.memo(
  ({
    value,
    isVisible,
    isVolume,
    maximum = 1,
  }: {
    value: number;
    isVisible: boolean;
    isVolume: boolean;
    maximum?: number;
  }) => {
    const opacity = useSharedValue(0);
    // Stays mounted for the length of the fade out. Unmounting straight from
    // the gesture's onFinalize is what made it vanish instantly before.
    const [mounted, setMounted] = useState(isVisible);
    const unmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (unmountRef.current) {
        clearTimeout(unmountRef.current);
        unmountRef.current = null;
      }
      cancelAnimation(opacity);

      if (isVisible) {
        setMounted(true);
        opacity.value = withTiming(1, { duration: INDICATOR_FADE_IN });
      } else {
        opacity.value = withTiming(0, { duration: INDICATOR_FADE_OUT });
        unmountRef.current = setTimeout(() => {
          setMounted(false);
          unmountRef.current = null;
        }, INDICATOR_FADE_OUT);
      }
    }, [isVisible, opacity]);

    useEffect(
      () => () => {
        if (unmountRef.current) {
          clearTimeout(unmountRef.current);
        }
      },
      [],
    );

    const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }), []);

    const containerStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        top: '50%' as const,
        marginTop: -102,
        left: isVolume ? ('7%' as const) : undefined,
        right: isVolume ? undefined : ('7%' as const),
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 18,
        width: 56,
        paddingHorizontal: 8,
        paddingVertical: 14,
        alignItems: 'center' as const,
        zIndex: 1000,
      }),
      [isVolume],
    );

    const textStyle = useMemo(
      () => ({
        color: 'white',
        marginBottom: 9,
        fontSize: 13,
        fontWeight: '600' as const,
      }),
      [],
    );

    const trackStyle = useMemo(
      () => ({
        width: 6,
        height: 120,
        borderRadius: 3,
        overflow: 'hidden' as const,
        justifyContent: 'flex-end' as const,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
      }),
      [],
    );

    const fillStyle = useMemo(
      () => ({
        width: '100%' as const,
        height: `${Math.round(
          Math.max(0, Math.min(1, value / maximum)) * 100,
        )}%` as `${number}%`,
        borderRadius: 3,
        backgroundColor: isVolume && value > 1 ? '#FFB74D' : 'white',
      }),
      [value, maximum, isVolume],
    );

    const iconStyle = useMemo(() => ({ marginTop: 10 }), []);

    const iconName = useMemo(() => {
      if (isVolume) {
        return value === 0
          ? 'volume-mute'
          : value < 0.3
            ? 'volume-down'
            : 'volume-up';
      }
      return 'brightness-6';
    }, [isVolume, value]);

    if (!mounted) return null;

    return (
      <Animated.View style={[containerStyle as any, fadeStyle]}>
        <Text style={textStyle}>{Math.round(value * 100)}%</Text>
        <View style={trackStyle}>
          <View style={fillStyle} />
        </View>
        <View style={iconStyle}>
          <Icon name={iconName} size={22} color="white" />
        </View>
      </Animated.View>
    );
  },
);

const Gestures = ({
  maxVolume,
  onVolumeBoostChange,
  forward,
  rewind,
  togglePlayPause,
  toggleControls,
  doubleTapTime,
  tapActionTimeout,
  tapAnywhereToPause,
  rewindTime = 10,
  showControls = false,
  seekButtonsEnabled = false,
  seekEnabled = true,
  disableGesture,
  baseRate = 1,
  setPlayback,
  clearControlTimeout,
  setControlTimeout,
  zoomScale,
  zoomStartScale,
  onSkipFeedback,
}: GesturesProps) => {
  const baseRateRef = useRef(baseRate);
  baseRateRef.current = baseRate;

  const [rippleVisible, setRippleVisible] = useState(false);
  const [isLeftRipple, setIsLeftRipple] = useState(false);
  const [totalSkipTime, setTotalSkipTime] = useState(0);
  const [displayVolume, setDisplayVolume] = useState(0);
  const [displayBrightness, setDisplayBrightness] = useState(0);
  const [isVolumeVisible, setIsVolumeVisible] = useState(false);
  const [isBrightnessVisible, setIsBrightnessVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Memoize screen dimensions
  const screenDimensions = useMemo(() => Dimensions.get('window'), []);
  const { width: SCREEN_WIDTH } = screenDimensions;

  // Refs
  const initialTapPosition = useRef({ x: 0, y: 0 });
  const isDoubleTapRef = useRef(false);
  const currentSideRef = useRef<'left' | 'right' | null>(null);
  const tapCountRef = useRef(0);
  const skipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rippleHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef(0);
  const originalSettings = useRef({
    volume: 0,
    brightness: 0,
  });
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const is2xActiveRef = useRef(false);

  // Shared values
  // the left/right split has to be measured rather than taken from the window:
  // the view can be narrower than the screen, and the memoized window width
  // below never updates on rotation. Falls back to the window until first layout.
  const gestureWidth = useSharedValue(0);
  const volumeValue = useSharedValue(0);
  const brightnessValue = useSharedValue(0);
  const startVolume = useSharedValue(0);
  const startBrightness = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const is2xActiveShared = useSharedValue(false);
  const isPanActive = useSharedValue(false);

  // Toast styles (inline, no Tailwind)
  const toastAnimatedStyle = useAnimatedStyle(
    () => ({
      opacity: toastOpacity.value,
      transform: [
        {
          translateY: (1 - toastOpacity.value) * -4, // subtle lift-in
        },
      ] as any,
    }),
    [],
  );

  const toastContainerStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      width: '100%' as const,
      top: 48, // ~ top-12
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 8, // px-2
      zIndex: 1200,
    }),
    [],
  );

  const toastTextStyle = useMemo(
    () => ({
      color: 'white', // text-white
      backgroundColor: 'rgba(0,0,0,0.5)', // bg-black/50
      padding: 8, // p-2
      borderRadius: 9999, // rounded-full
      fontSize: 16, // text-base
    }),
    [],
  );

  const show2xToast = useCallback(() => {
    setToastMessage('2Ã— speed');
    toastOpacity.value = withTiming(1, { duration: 150 });
  }, [toastOpacity]);

  const hideToast = useCallback(() => {
    toastOpacity.value = withTiming(0, { duration: 150 }, (finished) => {
      if (finished) {
        runOnJS(setToastMessage)(null);
      }
    });
  }, [toastOpacity]);

  const start2x = useCallback(() => {
    if (disableGesture || showControls || isPanActive.value) return;
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('impactMedium', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    is2xActiveRef.current = true;
    is2xActiveShared.value = true;
    setPlayback(2);
    show2xToast();
  }, [disableGesture, showControls, setPlayback, show2xToast, isPanActive, is2xActiveShared]);

  const cancel2x = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    touchStartPosRef.current = null;
    is2xActiveShared.value = false;
    if (is2xActiveRef.current) {
      is2xActiveRef.current = false;
      setPlayback(baseRateRef.current);
      hideToast();
    }
  }, [hideToast, setPlayback, is2xActiveShared]);

  const handleTouchDown = useCallback(
    (x: number, y: number) => {
      if (disableGesture || showControls) return;
      cancel2x();
      touchStartPosRef.current = { x, y };
      longPressTimeoutRef.current = setTimeout(() => {
        start2x();
      }, 450);
    },
    [disableGesture, showControls, cancel2x, start2x],
  );

  const handleTouchMove = useCallback(
    (x: number, y: number) => {
      if (is2xActiveRef.current) return;
      if (!touchStartPosRef.current) return;
      const dx = Math.abs(x - touchStartPosRef.current.x);
      const dy = Math.abs(y - touchStartPosRef.current.y);
      if (dx > 8 || dy > 8) {
        cancel2x();
      }
    },
    [cancel2x],
  );

  const handleTouchUp = useCallback(() => {
    cancel2x();
  }, [cancel2x]);

  // The accumulated label is owned by the seek button and fades out on its own
  // timer, so resetting the tap tracking must not clear it. Otherwise the
  // number would disappear the instant the seek is applied.
  const resetState = useCallback(() => {
    isDoubleTapRef.current = false;
    currentSideRef.current = null;
    tapCountRef.current = 0;
    lastTapTimeRef.current = 0;
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
  }, []);

  const handleSkip = useCallback(async () => {
    const side = currentSideRef.current;

    try {
      const count = Number(tapCountRef.current) - 1;
      const baseTime = Number(rewindTime);
      const skipTime = baseTime * count;

      if (!isNaN(skipTime) && skipTime > 0) {
        if (side === 'left') {
          rewind(skipTime);
        } else if (side === 'right') {
          forward(skipTime);
        }
      }
    } catch (error) {
      console.error('Error while skipping:', error);
    } finally {
      resetState();
      // Release the label as soon as the seek lands, otherwise it hangs
      // outside the arc waiting on an unrelated fallback timer.
      onSkipFeedback?.(side ?? 'right', 0);
      // The ripple fades itself out, so it is only unmounted afterwards. That
      // keeps `visible` flipping false, which is what lets the next double tap
      // replay the animation from the start.
      if (rippleHideRef.current) {
        clearTimeout(rippleHideRef.current);
      }
      rippleHideRef.current = setTimeout(() => {
        setRippleVisible(false);
        setTotalSkipTime(0);
        rippleHideRef.current = null;
      }, RIPPLE_FADE_DURATION);
      setControlTimeout();
    }
  }, [
    rewindTime,
    rewind,
    forward,
    resetState,
    setControlTimeout,
    onSkipFeedback,
  ]);

  const handleTap = useCallback(
    (touchX: number, touchY: number, side: 'left' | 'right') => {
      if (!seekEnabled) {
        if (tapActionTimeout.current) clearTimeout(tapActionTimeout.current);
        tapActionTimeout.current = setTimeout(() => {
          if (tapAnywhereToPause) togglePlayPause();
          else toggleControls();
        }, doubleTapTime);
        return;
      }
      // Keep the controls timer from interrupting an active multi-tap seek.
      // It is restarted after the accumulated seek has been applied.
      clearControlTimeout();
      const now = Date.now();
      if (now - lastTapTimeRef.current > 500) {
        resetState();
      }

      if (!isDoubleTapRef.current) {
        isDoubleTapRef.current = true;
        initialTapPosition.current = { x: touchX, y: touchY };
        currentSideRef.current = side;
        tapCountRef.current = 1;
        lastTapTimeRef.current = now;

        tapActionTimeout.current = setTimeout(() => {
          if (tapAnywhereToPause) {
            togglePlayPause();
          } else {
            toggleControls();
          }
          resetState();
        }, doubleTapTime);
      } else {
        if (tapActionTimeout.current) {
          clearTimeout(tapActionTimeout.current);
          tapActionTimeout.current = null;
        }

        if (currentSideRef.current === side) {
          tapCountRef.current += 1;
          lastTapTimeRef.current = now;

          const count = Number(tapCountRef.current) - 1;
          const baseTime = Number(rewindTime);
          const newSkipTime = baseTime * count;

          // Only one feedback style runs per seek. When the seek buttons are
          // rendered they own the feedback and animate their own label; when
          // they are switched off there is no button to animate, so the ripple
          // stands in regardless of whether the rest of the controls are up.
          if (seekButtonsEnabled) {
            onSkipFeedback?.(side, newSkipTime);
          } else {
            if (rippleHideRef.current) {
              clearTimeout(rippleHideRef.current);
              rippleHideRef.current = null;
            }
            setTotalSkipTime(newSkipTime);
            setIsLeftRipple(side === 'left');
            setRippleVisible(true);
          }

          if (skipTimeoutRef.current) {
            clearTimeout(skipTimeoutRef.current);
          }
          // Window for stacking another tap onto the same seek. Kept short so
          // the number does not sit out there long after the last tap.
          skipTimeoutRef.current = setTimeout(handleSkip, 350);
        } else {
          resetState();
          isDoubleTapRef.current = true;
          initialTapPosition.current = { x: touchX, y: touchY };
          currentSideRef.current = side;
          tapCountRef.current = 1;
          lastTapTimeRef.current = now;

          tapActionTimeout.current = setTimeout(() => {
            resetState();
          }, doubleTapTime);
        }
      }
    },
    [
      resetState,
      tapAnywhereToPause,
      togglePlayPause,
      toggleControls,
      doubleTapTime,
      rewindTime,
      handleSkip,
      clearControlTimeout,
      onSkipFeedback,
      seekButtonsEnabled,
      seekEnabled,
    ],
  );

  const lastSystemVolume = useRef<number | null>(null);
  const updateSystemVolume = useCallback((newVolume: number) => {
    const {level, system, boost} = getPlayerVolumeLevels(newVolume, maxVolume);
    // Raising gain above 100% does not repeatedly write unchanged system volume.
    if (lastSystemVolume.current !== system) {
      lastSystemVolume.current = system;
      VolumeManager.setVolume(system).catch(() => {});
    }
    onVolumeBoostChange(boost);
    setDisplayVolume(level);
  }, [maxVolume, onVolumeBoostChange]);

  useEffect(() => {
    if (volumeValue.value > maxVolume) {
      volumeValue.value = maxVolume;
      updateSystemVolume(maxVolume);
    }
  }, [maxVolume, updateSystemVolume, volumeValue]);

  useEffect(() => {
    const listener = VolumeManager.addVolumeListener(({volume: system}) => {
      if (isPanActive.value) return;
      lastSystemVolume.current = system;
      // Ignore our own 100% system event while the player is boosted.
      if (system >= 1 && volumeValue.value > 1) return;
      volumeValue.value = system;
      setDisplayVolume(system);
      onVolumeBoostChange(1);
    });
    return () => listener.remove();
  }, [isPanActive, onVolumeBoostChange, volumeValue]);

  const updateSystemBrightness = useCallback((newBrightness: number) => {
    const clampedBrightness = Math.max(0, Math.min(1, newBrightness));
    Brightness.setBrightnessAsync(clampedBrightness);
    setDisplayBrightness(clampedBrightness);
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disableGesture)
        .maxPointers(1)
        .minDistance(10) // Minimum distance before gesture starts
        .onTouchesDown((event) => {
          'worklet';
          isPanActive.value = false;
          is2xActiveShared.value = false;
          if (event.allTouches && event.allTouches.length > 0) {
            runOnJS(handleTouchDown)(
              event.allTouches[0].x,
              event.allTouches[0].y,
            );
          }
        })
        .onTouchesMove((event) => {
          'worklet';
          if (event.allTouches && event.allTouches.length > 0) {
            runOnJS(handleTouchMove)(
              event.allTouches[0].x,
              event.allTouches[0].y,
            );
          }
        })
        .onTouchesUp(() => {
          'worklet';
          runOnJS(handleTouchUp)();
        })
        .onTouchesCancelled(() => {
          'worklet';
          runOnJS(handleTouchUp)();
        })
        .onStart((event) => {
          'worklet';
          if (is2xActiveShared.value) {
            return;
          }
          isPanActive.value = true;
          runOnJS(cancel2x)();
          const isLeftSide = event.x < (gestureWidth.value || SCREEN_WIDTH) / 2;

          if (isLeftSide) {
            startBrightness.value = brightnessValue.value;
            runOnJS(setIsBrightnessVisible)(true);
          } else {
            startVolume.value = volumeValue.value;
            runOnJS(setIsVolumeVisible)(true);
          }
        })
        .onUpdate((event) => {
          'worklet';
          if (is2xActiveShared.value || !isPanActive.value) {
            return;
          }
          const isLeftSide = event.x < (gestureWidth.value || SCREEN_WIDTH) / 2;
          const change = -event.translationY / SWIPE_RANGE;

          if (isLeftSide) {
            // Brightness control
            const newBrightness = Math.max(
              0,
              Math.min(1, startBrightness.value + change),
            );
            brightnessValue.value = newBrightness;
            runOnJS(updateSystemBrightness)(newBrightness);
          } else {
            // Volume control
            const newVolume = Math.max(
              0,
              Math.min(maxVolume, startVolume.value + change),
            );
            volumeValue.value = newVolume;
            runOnJS(updateSystemVolume)(newVolume);
          }
        })
        .onFinalize(() => {
          'worklet';
          isPanActive.value = false;
          is2xActiveShared.value = false;
          runOnJS(handleTouchUp)();
          runOnJS(setIsVolumeVisible)(false);
          runOnJS(setIsBrightnessVisible)(false);
        }),
    [
      SCREEN_WIDTH,
      gestureWidth,
      disableGesture,
      is2xActiveShared,
      isPanActive,
      handleTouchDown,
      handleTouchMove,
      handleTouchUp,
      cancel2x,
      updateSystemBrightness,
      updateSystemVolume,
      maxVolume,
    ],
  );

  // Initialize and store original settings
  useEffect(() => {
    let mounted = true;

    const initializeSettings = async () => {
      try {
        const [currentVolume, currentBrightness] = await Promise.all([
          VolumeManager.getVolume(),
          Brightness.getBrightnessAsync(),
        ]);

        if (mounted) {
          // Store original values
          originalSettings.current = {
            volume: currentVolume.volume,
            brightness: currentBrightness,
          };

          // Set initial values
          volumeValue.value = currentVolume.volume;
          lastSystemVolume.current = currentVolume.volume;
          brightnessValue.value = currentBrightness;
          setDisplayVolume(currentVolume.volume);
          setDisplayBrightness(currentBrightness);

          console.log('Original settings stored:ðŸ”¥', {
            volume: currentVolume,
            brightness: currentBrightness,
          });
        }
      } catch (error) {
        console.error('Error initializing settings:', error);
      }
    };

    initializeSettings();

    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup useEffect
  useEffect(() => {
    return () => {
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current);
      }
      if (rippleHideRef.current) {
        clearTimeout(rippleHideRef.current);
      }
      if (tapActionTimeout.current) {
        clearTimeout(tapActionTimeout.current);
      }
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  // Memoize container styles
  const containerStyle = useMemo(
    () => ({
      width: '100%' as const,
      height: '70%' as const,
    }),
    [],
  );

  const gestureContainerStyle = useMemo(
    () => ({
      position: 'relative' as const,
      width: '100%' as const,
      height: '100%' as const,
      flexDirection: 'row' as const,
    }),
    [],
  );

  // Records the real width of the tap surface. Fires again on rotation and on
  // entering/leaving fullscreen, which is what keeps the midpoint honest.
  const handleGestureLayout = useCallback(
    (event: LayoutChangeEvent) => {
      gestureWidth.value = event.nativeEvent.layout.width;
    },
    [gestureWidth],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(true)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          zoomStartScale.value = zoomScale.value;
          runOnJS(clearControlTimeout)();
        })
        .onUpdate((event) => {
          'worklet';
          // Keep the original view as the minimum, but intentionally do not
          // impose a maximum so the user controls how far to zoom.
          zoomScale.value = Math.max(1, zoomStartScale.value * event.scale);
        })
        .onFinalize(() => {
          'worklet';
          zoomStartScale.value = zoomScale.value;
          runOnJS(setControlTimeout)();
        }),
    [clearControlTimeout, setControlTimeout, zoomScale, zoomStartScale],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        // Tapping to show/hide controls is not an optional swipe gesture.
        // The locked player does not render this component at all.
        .enabled(true)
        .maxDuration(250)
        .maxDistance(14)
        .onEnd((event, success) => {
          'worklet';
          if (success && !is2xActiveShared.value) {
            const side =
              event.x < (gestureWidth.value || SCREEN_WIDTH) / 2
                ? 'left'
                : 'right';
            runOnJS(handleTap)(event.x, event.y, side);
          }
        }),
    [SCREEN_WIDTH, gestureWidth, handleTap, is2xActiveShared],
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, tapGesture),
    [panGesture, pinchGesture, tapGesture],
  );

  const visualOverlayStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 100000,
    }),
    [],
  );

  return (
    <>
      <GestureHandlerRootView style={containerStyle}>
        <GestureDetector gesture={composedGesture}>
          <View style={gestureContainerStyle} onLayout={handleGestureLayout} />
        </GestureDetector>
      </GestureHandlerRootView>

      <View style={visualOverlayStyle} pointerEvents="none">
        <Ripple
          visible={rippleVisible && isLeftRipple}
          isLeft={true}
          totalTime={totalSkipTime}
        />
        <Ripple
          visible={rippleVisible && !isLeftRipple}
          isLeft={false}
          totalTime={totalSkipTime}
        />
        {toastMessage ? (
          <Animated.View
            style={[toastContainerStyle as any, toastAnimatedStyle]}>
            <Text style={toastTextStyle}>{toastMessage}</Text>
          </Animated.View>
        ) : null}
        <ControlOverlay
          value={displayVolume}
          maximum={maxVolume}
          isVisible={isVolumeVisible}
          isVolume={true}
        />
        <ControlOverlay
          value={displayBrightness}
          isVisible={isBrightnessVisible}
          isVolume={false}
        />
      </View>
    </>
  );
};

export default Gestures;
