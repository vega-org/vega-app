import React from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import AppText from '../../../components/ui/Text';
import {settingsStorage} from '../../../lib/storage';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const rowTransition = LinearTransition.duration(180);

export default function SwipeToUnfollow({children, onUnfollow}: {
  children: React.ReactNode;
  onUnfollow: () => void;
}) {
  const colors = useM3Colors();
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const rowStyle = useAnimatedStyle(() => ({transform: [{translateX: offset.get()}]}));

  const commit = React.useCallback(() => {
    onUnfollow();
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger(Platform.OS === 'android' ? 'effectTick' : 'impactLight', {
        enableVibrateFallback: false,
        ignoreAndroidSystemSettings: false,
      });
    }
  }, [onUnfollow]);

  const swipe = React.useMemo(() => Gesture.Pan()
    .activeOffsetX(-16)
    .failOffsetX(16)
    .failOffsetY([-12, 12])
    .onUpdate(({translationX}) => {
      if (dismissing.get()) return;
      offset.set(Math.max(-width.get(), Math.min(0, translationX)));
    })
    .onEnd(({translationX}, success) => {
      if (!success || dismissing.get()) return;
      const rowWidth = width.get();
      if (rowWidth <= 0 || -translationX < Math.min(112, rowWidth * 0.35)) {
        offset.set(withTiming(0, {duration: 160}));
        return;
      }
      dismissing.set(true);
      offset.set(withTiming(-rowWidth, {duration: 180}, finished => {
        if (finished) scheduleOnRN(commit);
      }));
    })
    .onFinalize((_event, success) => {
      if (!success && !dismissing.get()) offset.set(withTiming(0, {duration: 160}));
    }), [commit, dismissing, offset, width]);

  return (
    <Animated.View
      collapsable={false}
      layout={rowTransition}
      onLayout={({nativeEvent}) => width.set(nativeEvent.layout.width)}
      style={{overflow: 'hidden'}}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          StyleSheet.absoluteFill,
          {
            alignItems: 'center',
            backgroundColor: colors.errorContainer,
            flexDirection: 'row',
            gap: 8,
            justifyContent: 'flex-end',
            paddingHorizontal: 16,
          },
        ]}>
        <MaterialCommunityIcons name="bell-off-outline" size={20} color={colors.onErrorContainer} />
        <AppText role="labelLarge" style={{color: colors.onErrorContainer}}>Unfollow</AppText>
      </View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[{backgroundColor: colors.surfaceContainerLow}, rowStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
