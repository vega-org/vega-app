import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  Switch,
  ToastAndroid,
  TouchableOpacity,
  View,
  TextInput,
  Keyboard,
  BackHandler,
} from 'react-native';
import { settingsStorage } from '../../../lib/storage';
import {
  DOH_PROVIDERS,
  DohProviderValue,
  syncDohSettings,
} from '../../../lib/services/dohService';
import { getWarpStatus, toggleWarp } from '../../../lib/services/warpService';
import {
  DEFAULT_BYEDPI_ARGS,
  BYEDPI_PRESETS,
  getByeDpiStatus,
  restartByeDpi,
  toggleByeDpi,
} from '../../../lib/services/byeDpiService';
import { useM3Colors } from '../../../theme/M3PaletteContext';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {TVFocusable} from '../../../components/tv';
import {findNodeHandle} from 'react-native';
import useTVNavigationStore from '../../../lib/zustand/tvNavigationStore';
import {isTV} from '../../../lib/tv';
import {scheduleWhenIdle} from '../../../lib/performance/idleWork';

const DnsPreference = () => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();

  const [warpEnabled, setWarpEnabledState] = useState<boolean>(
    settingsStorage.isWarpEnabled(),
  );
  const [isWarpBusy, setIsWarpBusy] = useState<boolean>(false);
  const [warpPort, setWarpPort] = useState<number | null>(null);
  const warpRef = React.useRef<View>(null);
  const [warpHandle, setWarpHandle] = useState<number | null>(null);
  const byeDpiRef = React.useRef<View>(null);
  const [byeDpiHandle, setByeDpiHandle] = useState<number | null>(null);

  const [byeDpiEnabled, setByeDpiEnabledState] = useState<boolean>(
    settingsStorage.isByeDpiEnabled(),
  );
  const [isByeDpiBusy, setIsByeDpiBusy] = useState<boolean>(false);
  const [byeDpiPort, setByeDpiPort] = useState<number | null>(null);
  const [byeDpiArgs, setByeDpiArgs] = useState(
    settingsStorage.getByeDpiCmdArgs() || DEFAULT_BYEDPI_ARGS,
  );
  const [showArgsEditor, setShowArgsEditor] = useState<boolean>(false);
  const argsInputRef = React.useRef<TextInput>(null);
  const [isArgsInputFocused, setIsArgsInputFocused] = useState<boolean>(false);
  const customUrlInputRef = React.useRef<TextInput>(null);
  const [isCustomUrlFocused, setIsCustomUrlFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!showArgsEditor && !isArgsInputFocused && !isCustomUrlFocused) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (argsInputRef.current?.isFocused() || isArgsInputFocused) {
        argsInputRef.current?.blur();
        setIsArgsInputFocused(false);
        Keyboard.dismiss();
        return true;
      }
      if (customUrlInputRef.current?.isFocused() || isCustomUrlFocused) {
        customUrlInputRef.current?.blur();
        setIsCustomUrlFocused(false);
        Keyboard.dismiss();
        return true;
      }
      if (showArgsEditor) {
        setShowArgsEditor(false);
        return true;
      }
      return false;
    });

    return () => sub.remove();
  }, [showArgsEditor, isArgsInputFocused, isCustomUrlFocused]);

  useEffect(() => {
    return scheduleWhenIdle(
      signal => {
        getWarpStatus()
          .then(res => {
            if (!signal.aborted && res.running && res.port) {
              setWarpPort(res.port);
            }
          })
          .catch(() => {});
        getByeDpiStatus()
          .then(res => {
            if (!signal.aborted && res.running && res.port) {
              setByeDpiPort(res.port);
            }
          })
          .catch(() => {});
      },
      0,
      true,
    );
  }, []);

  const initialProvider = settingsStorage.isDohEnabled()
    ? (settingsStorage.getDohProvider() as DohProviderValue)
    : 'off';
  const [provider, setProvider] = useState<DohProviderValue>(initialProvider);
  const [customUrl, setCustomUrl] = useState(settingsStorage.getDohCustomUrl());

  const onToggleWarp = async (value: boolean) => {
    if (isWarpBusy || isByeDpiBusy) return;
    setIsWarpBusy(true);
    setWarpEnabledState(value);
    if (value) {
      setByeDpiEnabledState(false);
      setByeDpiPort(null);
    }

    try {
      if (value) {
        ToastAndroid.show(
          'Connecting to Cloudflare WARP...',
          ToastAndroid.SHORT,
        );
      }
      const res = await toggleWarp(value);
      if (value && res.running) {
        setWarpPort(res.port || null);
        ToastAndroid.show(
          `WARP connected (Port ${res.port})`,
          ToastAndroid.SHORT,
        );
      } else if (!value) {
        setWarpPort(null);
        ToastAndroid.show('WARP disconnected', ToastAndroid.SHORT);
      }
    } catch (e: any) {
      setWarpEnabledState(false);
      setWarpPort(null);
      settingsStorage.setWarpEnabled(false);
      ToastAndroid.show(
        `WARP error: ${e?.message || 'Failed to connect'}`,
        ToastAndroid.LONG,
      );
    } finally {
      setIsWarpBusy(false);
    }
  };

  const onToggleByeDpi = async (value: boolean) => {
    if (isByeDpiBusy || isWarpBusy) return;
    setIsByeDpiBusy(true);
    setByeDpiEnabledState(value);
    if (value) {
      setWarpEnabledState(false);
      setWarpPort(null);
    }

    try {
      if (value) {
        ToastAndroid.show('Starting ByeDPI...', ToastAndroid.SHORT);
      }
      const res = await toggleByeDpi(value, byeDpiArgs);
      if (value && res.running) {
        setByeDpiPort(res.port || null);
        ToastAndroid.show(
          `ByeDPI connected (Port ${res.port})`,
          ToastAndroid.SHORT,
        );
      } else if (!value) {
        setByeDpiPort(null);
        ToastAndroid.show('ByeDPI stopped', ToastAndroid.SHORT);
      }
    } catch (e: any) {
      setByeDpiEnabledState(false);
      setByeDpiPort(null);
      settingsStorage.setByeDpiEnabled(false);
      ToastAndroid.show(
        `ByeDPI error: ${e?.message || 'Failed to start'}`,
        ToastAndroid.LONG,
      );
    } finally {
      setIsByeDpiBusy(false);
    }
  };

  const saveByeDpiArgs = async (value: string) => {
    const trimmed = value.trim();
    setByeDpiArgs(trimmed);
    settingsStorage.setByeDpiCmdArgs(trimmed);
    if (byeDpiEnabled) {
      setIsByeDpiBusy(true);
      try {
        const res = await restartByeDpi(trimmed);
        setByeDpiPort(res.running ? res.port || null : null);
        if (res.running) {
          ToastAndroid.show(
            'ByeDPI restarted with new parameters',
            ToastAndroid.SHORT,
          );
        }
      } catch (e: any) {
        setByeDpiPort(null);
        ToastAndroid.show(`ByeDPI error: ${e?.message}`, ToastAndroid.LONG);
      } finally {
        setIsByeDpiBusy(false);
      }
    } else {
      ToastAndroid.show('ByeDPI parameters saved', ToastAndroid.SHORT);
    }
  };

  const resetByeDpiArgs = () => {
    saveByeDpiArgs(DEFAULT_BYEDPI_ARGS);
  };

  const selectProvider = async (value: DohProviderValue) => {
    setProvider(value);
    settingsStorage.setDohEnabled(value !== 'off');
    if (value !== 'off') {
      settingsStorage.setDohProvider(value);
    }
    await syncDohSettings();
  };

  const saveCustomUrl = async (value: string) => {
    settingsStorage.setDohCustomUrl(value);
    await syncDohSettings();
    ToastAndroid.show('Custom DNS applied', ToastAndroid.SHORT);
  };

  return (
    <View className="p-4">
      {/* Cloudflare WARP Section */}
      <TVFocusable
        ref={isTV ? warpRef : undefined}
        onLayout={
          isTV
            ? () => {
                if (warpRef.current) setWarpHandle(findNodeHandle(warpRef.current));
              }
            : undefined
        }
        onFocus={
          isTV
            ? () => {
                if (warpRef.current) {
                  const h = findNodeHandle(warpRef.current);
                  if (h) useTVNavigationStore.getState().setActiveScreenFocusHandle(h);
                }
              }
            : undefined
        }
        nextFocusRight={isTV ? warpHandle : undefined}
        accessibilityRole="switch"
        accessibilityState={{checked: warpEnabled}}
        accessibilityLabel="Cloudflare WARP Mode"
        disabled={isWarpBusy || isByeDpiBusy}
        onPress={() => onToggleWarp(!warpEnabled)}
        focusScale={1.02}
        borderRadius={16}
        style={{
          marginBottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 8,
          borderRadius: 16,
        }}>
        <View className="mr-3 flex-1 flex-row items-center">
          <View
            className="mr-4 h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.secondaryContainer }}>
            <MaterialCommunityIcons
              name="cloud-outline"
              size={21}
              color={colors.onSecondaryContainer}
            />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <AppText role="bodyLarge" className="text-m3-on-surface">
                WARP Mode
              </AppText>
              {warpEnabled && warpPort ? (
                <View
                  className="ml-2 rounded px-1.5 py-0.5"
                  style={{ backgroundColor: colors.primaryContainer }}>
                  <AppText
                    role="labelSmall"
                    style={{ color: colors.onPrimaryContainer, fontSize: 10 }}>
                    Active :{warpPort}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText
              role="bodySmall"
              className="mt-0.5 text-m3-on-surface-variant">
              Bypass ISP restrictions with Cloudflare WARP VPN
            </AppText>
          </View>
        </View>
        <Switch
          accessibilityLabel="Cloudflare WARP Mode"
          value={warpEnabled}
          disabled={true}
          focusable={false}
          pointerEvents="none"
          importantForAccessibility="no"
          thumbColor={warpEnabled ? colors.onPrimary : colors.outline}
          trackColor={{
            false: colors.surfaceContainerHighest,
            true: colors.primary,
          }}
        />
      </TVFocusable>

      {/* Divider */}
      <View
        style={{
          borderBottomColor: colors.outlineVariant,
          borderBottomWidth: 1,
          marginBottom: 16,
        }}
      />

      {/* ByeDPI Section */}
      <View className="mb-4">
        <TVFocusable
          ref={isTV ? byeDpiRef : undefined}
          onLayout={
            isTV
              ? () => {
                  if (byeDpiRef.current) setByeDpiHandle(findNodeHandle(byeDpiRef.current));
                }
              : undefined
          }
          onFocus={
            isTV
              ? () => {
                  if (byeDpiRef.current) {
                    const h = findNodeHandle(byeDpiRef.current);
                    if (h) useTVNavigationStore.getState().setActiveScreenFocusHandle(h);
                  }
                }
              : undefined
          }
          nextFocusRight={isTV ? byeDpiHandle : undefined}
          accessibilityRole="switch"
          accessibilityState={{checked: byeDpiEnabled}}
          accessibilityLabel="ByeDPI Anti-DPI Mode"
          disabled={isByeDpiBusy || isWarpBusy}
          onPress={() => onToggleByeDpi(!byeDpiEnabled)}
          focusScale={1.02}
          borderRadius={16}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 8,
            borderRadius: 16,
          }}>
          <View className="mr-3 flex-1 flex-row items-center">
            <View
              className="mr-4 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.secondaryContainer }}>
              <MaterialCommunityIcons
                name="shield-half"
                size={21}
                color={colors.onSecondaryContainer}
              />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center">
                <AppText role="bodyLarge" className="text-m3-on-surface">
                  AntiDPI Mode
                </AppText>
                {byeDpiEnabled && byeDpiPort ? (
                  <View
                    className="ml-2 rounded px-1.5 py-0.5"
                    style={{ backgroundColor: colors.primaryContainer }}>
                    <AppText
                      role="labelSmall"
                      style={{ color: colors.onPrimaryContainer, fontSize: 10 }}>
                      Active :{byeDpiPort}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText
                role="bodySmall"
                className="mt-0.5 text-m3-on-surface-variant">
                Bypass ISP blocking without VPN
              </AppText>
            </View>
          </View>
          <Switch
            accessibilityLabel="ByeDPI Anti-DPI Mode"
            value={byeDpiEnabled}
            disabled={true}
            focusable={false}
            pointerEvents="none"
            importantForAccessibility="no"
            thumbColor={byeDpiEnabled ? colors.onPrimary : colors.outline}
            trackColor={{
              false: colors.surfaceContainerHighest,
              true: colors.primary,
            }}
          />
        </TVFocusable>

        {/* Optional Args Editor Toggle & Config */}
        <View className="mt-2 ml-14">
          <TVFocusable
            onPress={() => setShowArgsEditor(!showArgsEditor)}
            focusScale={1.03}
            borderRadius={8}
            style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 4}}>
            <AppText
              role="labelSmall"
              style={{ color: colors.primary, marginRight: 4 }}>
              {showArgsEditor ? 'Hide parameters' : 'Configure parameters'}
            </AppText>
            <MaterialCommunityIcons
              name={showArgsEditor ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </TVFocusable>

          {showArgsEditor ? (
            <View className="mt-2 pr-1">
              <View className="flex-row items-center justify-between mb-2">
                <AppText
                  role="labelMedium"
                  style={{ color: colors.onSurfaceVariant }}>
                  Command Line Arguments
                </AppText>
                <TVFocusable
                  onPress={resetByeDpiArgs}
                  focusScale={1.05}
                  borderRadius={8}
                  style={{paddingHorizontal: 8, paddingVertical: 4}}>
                  <AppText role="labelSmall" style={{ color: colors.primary }}>
                    Reset default
                  </AppText>
                </TVFocusable>
              </View>

              {/* Preset Strategies */}
              <View className="mb-2.5 flex-row flex-wrap gap-1.5">
                {BYEDPI_PRESETS.map(preset => {
                  const isSelected =
                    (byeDpiArgs || DEFAULT_BYEDPI_ARGS) === preset.args;
                  return (
                    <TVFocusable
                      key={preset.id}
                      onPress={() => saveByeDpiArgs(preset.args)}
                      focusScale={1.08}
                      borderRadius={16}
                      style={{
                        backgroundColor: isSelected
                          ? colors.primaryContainer
                          : colors.surfaceContainerHigh,
                        borderWidth: isSelected ? 1 : 0,
                        borderColor: colors.primary,
                        borderRadius: 16,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}>
                      <AppText
                        role="labelSmall"
                        style={{
                          color: isSelected
                            ? colors.onPrimaryContainer
                            : colors.onSurfaceVariant,
                          fontWeight: isSelected ? '600' : '400',
                        }}>
                        {preset.name}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>

              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4}}>
                <TextInput
                  ref={argsInputRef}
                  value={byeDpiArgs}
                  onChangeText={setByeDpiArgs}
                  onFocus={() => setIsArgsInputFocused(true)}
                  onBlur={() => {
                    setIsArgsInputFocused(false);
                    saveByeDpiArgs(byeDpiArgs);
                  }}
                  onSubmitEditing={() => {
                    saveByeDpiArgs(byeDpiArgs);
                    argsInputRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={DEFAULT_BYEDPI_ARGS}
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceContainerHigh,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    fontSize: 13,
                    color: colors.onSurface,
                    borderWidth: isArgsInputFocused ? 2 : 1,
                    borderColor: isArgsInputFocused ? colors.primary : colors.outlineVariant,
                  }}
                />
                <TVFocusable
                  onPress={() => {
                    saveByeDpiArgs(byeDpiArgs);
                    argsInputRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                  borderRadius={12}
                  focusScale={1.05}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                  <AppText role="labelMedium" style={{color: colors.onPrimary, fontWeight: '700'}}>
                    Save
                  </AppText>
                </TVFocusable>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {/* Divider */}
      <View
        style={{
          borderBottomColor: colors.outlineVariant,
          borderBottomWidth: 1,
          marginBottom: 16,
        }}
      />

      {/* DNS over HTTPS Section */}
      <View style={{ opacity: warpEnabled ? 0.45 : 1 }}>
        <View className="mb-3 flex-row items-center">
          <View
            className="mr-4 h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.secondaryContainer }}>
            <MaterialCommunityIcons
              name="shield-lock-outline"
              size={21}
              color={colors.onSecondaryContainer}
            />
          </View>
          <View className="flex-1">
            <AppText role="bodyLarge" className="text-m3-on-surface">
              DNS over HTTPS
            </AppText>
            <AppText
              role="bodySmall"
              className="mt-0.5 text-m3-on-surface-variant">
              {warpEnabled
                ? 'Managed by Cloudflare WARP (resolved remotely)'
                : byeDpiEnabled
                  ? 'Works in synergy with ByeDPI for DNS privacy'
                  : 'Encrypt DNS queries with secure resolver'}
            </AppText>
          </View>
        </View>

        <View style={{ width: '100%', minHeight: 56 }}>
          <DropdownField
            disabled={warpEnabled}
            options={DOH_PROVIDERS}
            value={DOH_PROVIDERS.find(option => option.value === provider)}
            getKey={option => option.value}
            getLabel={option => option.label}
            onChange={option => selectProvider(option.value)}
          />
        </View>

        {provider === 'custom' && !warpEnabled ? (
          <View
            style={{
              borderTopColor: colors.outlineVariant,
              borderTopWidth: 1,
              marginTop: 14,
              paddingTop: 14,
            }}>
            <AppText
              role="labelMedium"
              style={{ color: colors.onSurfaceVariant, marginBottom: 8 }}>
              Custom DoH URL
            </AppText>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4}}>
              <TextInput
                ref={customUrlInputRef}
                value={customUrl}
                onChangeText={setCustomUrl}
                onFocus={() => setIsCustomUrlFocused(true)}
                onBlur={() => {
                  setIsCustomUrlFocused(false);
                  saveCustomUrl(customUrl);
                }}
                onSubmitEditing={() => {
                  saveCustomUrl(customUrl);
                  customUrlInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://dns.example.com/dns-query"
                placeholderTextColor={colors.onSurfaceVariant}
                style={{
                  flex: 1,
                  backgroundColor: colors.surfaceContainerHigh,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 13,
                  color: colors.onSurface,
                  borderWidth: isCustomUrlFocused ? 2 : 1,
                  borderColor: isCustomUrlFocused ? colors.primary : colors.outlineVariant,
                }}
              />
              <TVFocusable
                onPress={() => {
                  saveCustomUrl(customUrl);
                  customUrlInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
                borderRadius={12}
                focusScale={1.05}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                <AppText role="labelMedium" style={{color: colors.onPrimary, fontWeight: '700'}}>
                  Apply
                </AppText>
              </TVFocusable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default React.memo(DnsPreference);
