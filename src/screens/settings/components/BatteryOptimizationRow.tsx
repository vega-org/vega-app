import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  Linking,
  Platform,
  ToastAndroid,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import SettingsRow from '../../../components/ui/SettingsRow';
import AppText from '../../../components/ui/Text';
import {episodeCheckNative} from '../../../lib/services/episodeCheckNative';
import {useM3Colors} from '../../../theme/M3PaletteContext';

export default function BatteryOptimizationRow({
  divider = true,
}: {
  divider?: boolean;
}) {
  const colors = useM3Colors();
  const [isUnrestricted, setIsUnrestricted] = useState<boolean | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (Platform.OS !== 'android' || !episodeCheckNative.supportsBatteryOptimization()) {
      return;
    }
    try {
      const ignoring = await episodeCheckNative.isIgnoringBatteryOptimizations();
      if (mountedRef.current) {
        setIsUnrestricted(ignoring);
      }
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshStatus().catch(() => {});
    }, [refreshStatus]),
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshStatus().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [refreshStatus]);

  const handlePress = useCallback(async () => {
    try {
      if (episodeCheckNative.supportsBatteryOptimization()) {
        const opened = await episodeCheckNative.requestIgnoreBatteryOptimizations();
        if (!opened && Platform.OS === 'android') {
          ToastAndroid.show('Could not open battery settings', ToastAndroid.SHORT);
        }
        return;
      }
      await Linking.openSettings();
    } catch {
      if (Platform.OS === 'android') {
        ToastAndroid.show('Could not open battery settings', ToastAndroid.SHORT);
      }
    }
  }, []);

  if (Platform.OS !== 'android') {
    return null;
  }

  const allowed = isUnrestricted === true;

  return (
    <SettingsRow
      title="Background battery"
      description={
        allowed
          ? 'Unrestricted for reliable checks'
          : 'Allow unrestricted battery for reliable checks'
      }
      icon={allowed ? 'battery-check-outline' : 'battery-alert-variant-outline'}
      divider={divider}
      onPress={handlePress}
      trailing={
        <View
          style={{
            flexShrink: 0,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: allowed
              ? colors.secondaryContainer
              : colors.primary,
          }}>
          <AppText
            role="labelMedium"
            numberOfLines={1}
            style={{
              color: allowed
                ? colors.onSecondaryContainer
                : colors.onPrimary,
            }}>
            {allowed ? 'Allowed' : 'Allow'}
          </AppText>
        </View>
      }
    />
  );
}
