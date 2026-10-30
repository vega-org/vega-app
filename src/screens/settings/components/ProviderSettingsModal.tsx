import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  ToastAndroid,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { providerManager } from '../../../lib/services/ProviderManager';
import { providerKvStorage } from '../../../lib/storage/StorageService';
import {
  getScopedKvKey,
  migrateLegacyProviderKv,
} from '../../../lib/sandbox/providerScope';
import { showAppDialog } from '../../../lib/zustand/appDialogStore';
import type { ProviderExtension } from '../../../lib/storage/extensionStorage';
import type { SettingsField, SelectOption } from '../../../lib/providers/types';
import { useM3Colors } from '../../../theme/M3PaletteContext';
import { readableOnColor } from '../../../theme/seeds';
import AppText from '../../../components/ui/Text';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import { TVFocusable, TVFocusGuide } from '../../../components/tv';
import { isTV } from '../../../lib/tv';

interface ProviderSettingsModalProps {
  visible: boolean;
  provider: ProviderExtension | null;
  onClose: () => void;
}

export const ProviderSettingsModal: React.FC<ProviderSettingsModalProps> = ({
  visible,
  provider,
  onClose,
}) => {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const closeRef = React.useRef<View>(null);
  const [closeHandle, setCloseHandle] = useState<number | null>(null);
  const [fields, setFields] = useState<SettingsField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const actionBusy = React.useRef(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Plain Animated values, reset on every open. Reanimated entering animations
  // inside this Modal stopped partway on the second open, leaving the sheet
  // pushed down with its buttons off screen.
  const overlayOpacity = React.useRef(new Animated.Value(0)).current;
  const sheetOffset = React.useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (!visible) {
      overlayOpacity.setValue(0);
      sheetOffset.setValue(windowHeight);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(sheetOffset, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [visible, overlayOpacity, sheetOffset, windowHeight]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      e => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      },
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!isTV || !visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const loadSchemaAndValues = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const schema = await providerManager.getSettingsSchema({
        providerValue: provider.value,
        sourceAuthor: provider.source?.author,
      });
      setFields(schema);
      await migrateLegacyProviderKv();

      const initialValues: Record<string, unknown> = {};
      for (const field of schema) {
        if (field.type === 'button') continue;
        const scopedKey = getScopedKvKey(provider.source?.author, provider.value, field.key);
        const storedRaw = providerKvStorage.getString(scopedKey);
        if (storedRaw !== undefined && storedRaw !== null) {
          try {
            initialValues[field.key] = JSON.parse(storedRaw);
          } catch {
            initialValues[field.key] = storedRaw;
          }
        } else if (field.defaultValue !== undefined) {
          initialValues[field.key] = field.defaultValue;
        }
      }
      setValues(initialValues);
    } catch (err) {
      console.error('Failed to load settings schema:', err);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (visible && provider) {
      loadSchemaAndValues();
    } else {
      setFields([]);
      setValues({});
      setExpandedKey(null);
    }
  }, [visible, provider, loadSchemaAndValues]);

  const handleChange = (key: string, val: unknown) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    if (!provider) return;
    for (const [key, value] of Object.entries(values)) {
      const scopedKey = getScopedKvKey(provider.source?.author, provider.value, key);
      if (value === undefined || value === null || value === '') {
        providerKvStorage.delete(scopedKey);
      } else {
        providerKvStorage.setString(scopedKey, JSON.stringify(value));
      }
    }
    onClose();
  };

  const handleResetProvider = () => {
    if (!provider) return;
    showAppDialog({
      title: `Reset ${provider.display_name}?`,
      message: `Are you sure you want to reset all settings and stored data for ${provider.display_name} to defaults?`,
      variant: 'warning',
      actions: [
        { label: 'Cancel' },
        {
          label: 'Reset',
          variant: 'destructive',
          onPress: async () => {
            await providerManager.clearProviderStorage(
              provider.value,
              provider.source?.author,
            );
            const defaultValues: Record<string, unknown> = {};
            for (const field of fields) {
              if (field.defaultValue !== undefined) {
                defaultValues[field.key] = field.defaultValue;
              }
            }
            setValues(defaultValues);
            if (Platform.OS === 'android') {
              ToastAndroid.show('Provider reset to default', ToastAndroid.SHORT);
            }
          },
        },
      ],
    });
  };

  if (!visible || !provider) {
    return null;
  }

  const actionsDisabled = loading || fields.length === 0 || runningAction !== null;
  const sheetMaxHeight = (windowHeight - insets.top) * 0.88;
  // Room left for the settings after the handle, header and buttons. A fixed
  // cap, because a ScrollView grows by default and would stretch the sheet.
  const listMaxHeight = Math.max(160, sheetMaxHeight - (isTV ? 190 : 210) - insets.bottom);

  const renderFieldHeader = (field: SettingsField) => (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
      <AppText role="bodyLarge" style={{ color: colors.onSurface }}>
        {field.label}
      </AppText>
      {field.description ? (
        <AppText
          role="bodySmall"
          style={{ color: colors.onSurfaceVariant, marginTop: 3 }}>
          {field.description}
        </AppText>
      ) : null}
    </View>
  );

  // One row of a select (radio) or multiselect (checkbox) list.
  const renderOptionRow = (
    opt: SelectOption,
    selected: boolean,
    multiple: boolean,
    onPress: () => void,
    nextFocusUp?: number | null,
  ) => (
    <TVFocusable
      key={opt.value}
      onPress={onPress}
      nextFocusUp={nextFocusUp ?? undefined}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={multiple ? { checked: selected } : { selected }}
      accessibilityLabel={opt.label}
      borderRadius={14}
      focusScale={1.02}
      style={{
        alignItems: 'center',
        backgroundColor: selected ? colors.secondaryContainer : 'transparent',
        borderRadius: 14,
        flexDirection: 'row',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: 12,
      }}>
      <MaterialCommunityIcons
        name={
          multiple
            ? selected
              ? 'checkbox-marked'
              : 'checkbox-blank-outline'
            : selected
              ? 'radiobox-marked'
              : 'radiobox-blank'
        }
        size={22}
        color={selected ? colors.onSecondaryContainer : colors.onSurfaceVariant}
      />
      <AppText
        role="bodyMedium"
        style={{
          color: selected ? colors.onSecondaryContainer : colors.onSurface,
          flex: 1,
        }}>
        {opt.label}
      </AppText>
    </TVFocusable>
  );

  const inputStyle = {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 14,
    color: colors.onSurface,
    fontSize: 15,
    marginHorizontal: 16,
    marginBottom: 16,
    marginTop: 4,
    paddingHorizontal: 14,
  };

  const renderField = (field: SettingsField, fieldIndex: number) => {
    const currentValue = values[field.key];
    const firstFocusUp = fieldIndex === 0 ? closeHandle : undefined;

    if (field.type === 'button') {
      return <TVFocusable accessibilityRole="button" accessibilityLabel={field.label}
        disabled={runningAction !== null} nextFocusUp={firstFocusUp}
        borderRadius={14} style={{padding: 16, minHeight: 48}}
        onPress={async () => {
          if (!provider || actionBusy.current) return;
          actionBusy.current = true;
          setRunningAction(field.key);
          try {
            await providerManager.runSettingsAction({providerValue: provider.value, sourceAuthor: provider.source?.author, key: field.key});
            ToastAndroid.show('Action completed', ToastAndroid.SHORT);
          } catch (error) {
            ToastAndroid.show(error instanceof Error ? error.message : 'Action failed', ToastAndroid.LONG);
          } finally { actionBusy.current = false; setRunningAction(null); }
        }}>
        {field.buttonLabel ? <AppText style={{color: colors.onSurface}}>{field.label}</AppText> : null}
        <AppText style={{color: colors.primary}}>{runningAction === field.key ? 'Working…' : field.buttonLabel || field.label}</AppText>
        {field.description ? <AppText style={{color: colors.onSurfaceVariant}}>{field.description}</AppText> : null}
      </TVFocusable>;
    }

    if (field.type === 'toggle') {
      return (
        <SettingsSwitchRow
          nextFocusUp={firstFocusUp}
          title={field.label}
          description={field.description}
          value={Boolean(currentValue)}
          onValueChange={val => handleChange(field.key, val)}
          divider={false}
        />
      );
    }

    if (field.type === 'select' || field.type === 'multiselect') {
      const multiple = field.type === 'multiselect';
      const selectedList: unknown[] = multiple
        ? Array.isArray(currentValue)
          ? currentValue
          : []
        : [currentValue];
      const expanded = expandedKey === field.key;
      const summary = multiple
        ? selectedList.length === 0
          ? 'None'
          : field.options
              .filter(opt => selectedList.includes(opt.value))
              .map(opt => opt.label)
              .join(', ')
        : field.options.find(opt => opt.value === currentValue)?.label ??
          'Not set';
      return (
        <>
          {/* Collapsed to one row showing the current choice, so long option
              lists do not push the other settings out of the sheet. */}
          <TVFocusable
            onPress={() => setExpandedKey(expanded ? null : field.key)}
            nextFocusUp={firstFocusUp ?? undefined}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${field.label}, ${summary}`}
            borderRadius={20}
            focusScale={1.02}
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              gap: 12,
              minHeight: 64,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}>
            <View style={{ flex: 1 }}>
              <AppText role="bodyLarge" style={{ color: colors.onSurface }}>
                {field.label}
              </AppText>
              {field.description ? (
                <AppText
                  role="bodySmall"
                  style={{ color: colors.onSurfaceVariant, marginTop: 3 }}>
                  {field.description}
                </AppText>
              ) : null}
              <AppText
                role="labelLarge"
                numberOfLines={1}
                style={{ color: colors.primary, marginTop: 6 }}>
                {summary}
              </AppText>
            </View>
            <MaterialCommunityIcons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={colors.onSurfaceVariant}
            />
          </TVFocusable>
          {expanded ? (
            <View style={{ gap: 2, paddingBottom: 8, paddingHorizontal: 6 }}>
              {field.options.map((opt: SelectOption) =>
                renderOptionRow(
                  opt,
                  selectedList.includes(opt.value),
                  multiple,
                  () => {
                    if (!multiple) {
                      handleChange(field.key, opt.value);
                      setExpandedKey(null);
                      return;
                    }
                    const list = selectedList as string[];
                    handleChange(
                      field.key,
                      list.includes(opt.value)
                        ? list.filter(v => v !== opt.value)
                        : [...list, opt.value],
                    );
                  },
                ),
              )}
            </View>
          ) : null}
        </>
      );
    }

    if (field.type === 'number') {
      return (
        <>
          {renderFieldHeader(field)}
          <TextInput
            value={currentValue !== undefined ? String(currentValue) : ''}
            onChangeText={text => {
              const num = Number(text);
              handleChange(field.key, isNaN(num) ? undefined : num);
            }}
            keyboardType="numeric"
            selectionColor={colors.primary}
            style={{ ...inputStyle, height: 48 }}
          />
        </>
      );
    }

    // Default: text
    return (
      <>
        {renderFieldHeader(field)}
        <TextInput
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChangeText={text => handleChange(field.key, text)}
          placeholder={field.placeholder}
          placeholderTextColor={colors.onSurfaceVariant}
          selectionColor={colors.primary}
          multiline={true}
          style={{
            ...inputStyle,
            maxHeight: 110,
            minHeight: 48,
            paddingVertical: 12,
            textAlignVertical: 'top',
          }}
        />
      </>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          paddingBottom: Platform.OS === 'android' ? keyboardHeight : 0,
        }}>
        <Animated.View
          style={{
            opacity: overlayOpacity,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}>
          <Pressable
            focusable={false}
            accessible={false}
            style={{ flex: 1 }}
            onPress={() => {
              if (keyboardHeight > 0) {
                Keyboard.dismiss();
              } else {
                onClose();
              }
            }}
          />
        </Animated.View>
        <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusUp={true} trapFocusDown={true}>
          <Animated.View
            style={{
              transform: [{ translateY: sheetOffset }],
              backgroundColor: colors.surfaceContainer,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              maxHeight: sheetMaxHeight,
              paddingBottom: keyboardHeight > 0 ? 12 : insets.bottom + 12,
              paddingHorizontal: 16,
              paddingTop: isTV ? 20 : 10,
            }}>
            {!isTV ? (
              <View
                style={{
                  alignSelf: 'center',
                  backgroundColor: colors.outlineVariant,
                  borderRadius: 2,
                  height: 4,
                  marginBottom: 14,
                  width: 32,
                }}
              />
            ) : null}

            {/* Header */}
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                gap: 12,
                marginBottom: 16,
                paddingHorizontal: 4,
              }}>
              <View
                className="h-12 w-12 items-center justify-center overflow-hidden rounded-2xl"
                style={{ backgroundColor: colors.surfaceContainerHighest }}>
                {provider.icon ? (
                  <Image
                    source={{ uri: provider.icon }}
                    className="h-full w-full"
                    resizeMode="cover"
                    resizeMethod="resize"
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="cog-outline"
                    size={24}
                    color={colors.primary}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <AppText
                  role="titleLarge"
                  numberOfLines={1}
                  style={{ color: colors.onSurface }}>
                  {provider.display_name}
                </AppText>
                <AppText role="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Provider settings
                </AppText>
              </View>
              <TVFocusable
                ref={closeRef}
                onLayout={() => setCloseHandle(findNodeHandle(closeRef.current))}
                hasTVPreferredFocus={isTV}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                borderRadius={20}
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.surfaceContainerHighest,
                  borderRadius: 20,
                  height: 40,
                  justifyContent: 'center',
                  width: 40,
                }}>
                <MaterialCommunityIcons
                  name="close"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
              </TVFocusable>
            </View>

            {/* Body */}
            {loading ? (
              <View className="items-center justify-center py-12">
                <ActivityIndicator size="large" color={colors.primary} />
                <AppText
                  role="bodyMedium"
                  style={{ color: colors.onSurfaceVariant, marginTop: 12 }}>
                  Loading settings...
                </AppText>
              </View>
            ) : fields.length === 0 ? (
              <View className="items-center justify-center py-10">
                <MaterialCommunityIcons
                  name="tune-vertical"
                  size={40}
                  color={colors.onSurfaceVariant}
                />
                <AppText
                  role="bodyMedium"
                  style={{ color: colors.onSurfaceVariant, marginTop: 8 }}>
                  No configurable settings for this provider.
                </AppText>
              </View>
            ) : (
              <ScrollView
                focusable={false}
                accessible={false}
                style={{ flexGrow: 0, maxHeight: listMaxHeight }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                <View style={{ gap: 10 }}>
                  {fields.map((field, fieldIndex) => (
                    <View
                      key={field.key}
                      style={{
                        backgroundColor: colors.surfaceContainerHighest,
                        borderRadius: 20,
                        overflow: 'hidden',
                      }}>
                      {renderField(field, fieldIndex)}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {/* Footer Actions */}
            <TVFocusGuide style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
              <TVFocusable
                disabled={actionsDisabled}
                onPress={handleResetProvider}
                accessibilityRole="button"
                accessibilityLabel="Reset provider settings to default"
                borderRadius={24}
                focusScale={1.08}
                style={{
                  alignItems: 'center',
                  borderColor: colors.outlineVariant,
                  borderRadius: 24,
                  borderWidth: 1,
                  height: 48,
                  justifyContent: 'center',
                  opacity: actionsDisabled ? 0.4 : 1,
                  width: 48,
                }}>
                <MaterialCommunityIcons
                  name="restore"
                  size={22}
                  color={colors.onSurfaceVariant}
                />
              </TVFocusable>

              <TVFocusable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                borderRadius={24}
                focusScale={1.03}
                style={{
                  alignItems: 'center',
                  borderColor: colors.outlineVariant,
                  borderRadius: 24,
                  borderWidth: 1,
                  flex: 1,
                  height: 48,
                  justifyContent: 'center',
                }}>
                <AppText role="labelLarge" style={{ color: colors.onSurface }}>
                  Cancel
                </AppText>
              </TVFocusable>

              <TVFocusable
                disabled={actionsDisabled}
                onPress={handleSave}
                accessibilityRole="button"
                accessibilityLabel="Save"
                borderRadius={24}
                focusScale={1.03}
                style={{
                  alignItems: 'center',
                  backgroundColor: actionsDisabled
                    ? colors.surfaceContainerHighest
                    : colors.primary,
                  borderRadius: 24,
                  flex: 1,
                  height: 48,
                  justifyContent: 'center',
                  opacity: actionsDisabled ? 0.5 : 1,
                }}>
                <AppText
                  role="labelLarge"
                  style={{
                    color: actionsDisabled
                      ? colors.onSurfaceVariant
                      : readableOnColor(colors.primary),
                  }}>
                  Save
                </AppText>
              </TVFocusable>
            </TVFocusGuide>
          </Animated.View>
        </TVFocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default ProviderSettingsModal;
