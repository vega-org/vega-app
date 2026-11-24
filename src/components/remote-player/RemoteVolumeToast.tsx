import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useRef, useState} from 'react';
import {Animated, DeviceEventEmitter, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppText from '../ui/Text';
import {REMOTE_VOLUME_SHOWN_EVENT} from '../../lib/remote/remotePlaybackManager';
import {useM3Colors} from '../../theme/M3PaletteContext';

const VISIBLE_MS = 1500;

/** Receiver volume popup for the phone volume keys, shown over every screen. */
export const RemoteVolumeToast: React.FC = () => {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const [volume, setVolume] = useState<number | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let revision=0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const subscription = DeviceEventEmitter.addListener(
      REMOTE_VOLUME_SHOWN_EVENT,
      (next: number) => {
        const current=++revision;
        opacity.stopAnimation();
        setVolume(next);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }).start();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          Animated.timing(opacity, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }).start(({finished}) => {
            if (finished && current===revision) setVolume(null);
          });
        }, VISIBLE_MS);
      },
    );
    return () => {
      subscription.remove();
      clearTimeout(hideTimer);
    };
  }, [opacity]);

  if (volume === null) return null;
  const percent = Math.round(volume * 100);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        alignItems: 'center',
        left: 0,
        opacity,
        position: 'absolute',
        right: 0,
        top: insets.top + 12,
      }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: 28,
          elevation: 6,
          flexDirection: 'row',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 10,
          width: 260,
        }}>
        <MaterialCommunityIcons
          name={percent === 0 ? 'volume-off' : percent < 50 ? 'volume-medium' : 'volume-high'}
          size={22}
          color={colors.primary}
        />
        <View
          style={{
            backgroundColor: colors.surfaceContainerHighest,
            borderRadius: 3,
            flex: 1,
            height: 6,
            overflow: 'hidden',
          }}>
          <View
            style={{
              backgroundColor: colors.primary,
              height: '100%',
              width: `${percent}%`,
            }}
          />
        </View>
        <AppText
          role="labelLarge"
          style={{color: colors.onSurface, textAlign: 'right', width: 40}}>
          {percent}%
        </AppText>
      </View>
    </Animated.View>
  );
};
