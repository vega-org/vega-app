import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, Pressable, Text, View} from 'react-native';
import {isTV} from '../lib/tv/constants';
import {TVFocusGuide} from './tv';
import {readableOnColor} from '../theme/seeds';

interface AutoNextOverlayProps {
  seconds: number;
  focusColor: string;
  onPlayNow: () => void;
  onCancel: () => void;
}

// Counts down while mounted and starts the next episode at zero. Unmounting
// cancels the countdown, so the parent controls it by rendering it or not.
const AutoNextOverlay = ({
  seconds,
  focusColor,
  onPlayNow,
  onCancel,
}: AutoNextOverlayProps) => {
  const [remaining, setRemaining] = useState(seconds);
  const onPlayNowRef = useRef(onPlayNow);
  onPlayNowRef.current = onPlayNow;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(previous => Math.max(0, previous - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (remaining === 0) {
      onPlayNowRef.current();
    }
  }, [remaining]);

  // Back dismisses the countdown before it leaves the player.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onCancelRef.current();
        return true;
      },
    );
    return () => subscription.remove();
  }, []);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: 'rgba(20, 20, 20, 0.85)',
        borderColor: 'rgba(255, 255, 255, 0.28)',
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 10,
      }}>
      <Text
        style={{
          color: 'rgba(255, 255, 255, 0.95)',
          fontWeight: '700',
          fontSize: 14,
        }}>
        {`Next episode in ${remaining}s`}
      </Text>
      <TVFocusGuide
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        trapFocusDown
        style={{flexDirection: 'row', gap: 10}}>
        <OverlayButton
          label="Play now"
          focusColor={focusColor}
          primary
          preferredFocus
          onPress={onPlayNow}
        />
        <OverlayButton
          label="Cancel"
          focusColor={focusColor}
          onPress={onCancel}
        />
      </TVFocusGuide>
    </View>
  );
};

const OverlayButton = ({
  label,
  focusColor,
  primary = false,
  preferredFocus = false,
  onPress,
}: {
  label: string;
  focusColor: string;
  primary?: boolean;
  preferredFocus?: boolean;
  onPress: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      focusable
      isTVSelectable
      hasTVPreferredFocus={isTV && preferredFocus}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}>
      <View
        style={{
          backgroundColor: primary ? focusColor : 'rgba(255, 255, 255, 0.12)',
          borderColor: focused ? '#FFFFFF' : 'transparent',
          borderWidth: 2,
          borderRadius: 20,
          paddingVertical: 6,
          paddingHorizontal: 14,
        }}>
        <Text
          numberOfLines={1}
          style={{
            color: primary ? readableOnColor(focusColor) : '#FFFFFF',
            fontWeight: '700',
            fontSize: 13,
          }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
};

export default AutoNextOverlay;
