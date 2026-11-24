import {SettingsSearchAnchor} from '../../../components/ui/SettingsSearchTarget';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Pressable, TextInput, ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import SettingsSection from '../../../components/ui/SettingsSection';
import {settingsStorage} from '../../../lib/storage';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {TVFocusable} from '../../../components/tv';
import {isTV} from '../../../lib/tv';

const TmdbApiKeyPreference = ({draft}: {draft?: {
  inputKey: string;
  setInputKey: React.Dispatch<React.SetStateAction<string>>;
}}) => {
  const colors = useM3Colors();
  const [savedKey, setSavedKey] = useState(() => settingsStorage.getTmdbApiKey());
  const [localInputKey, setLocalInputKey] = useState(() => settingsStorage.getTmdbApiKey());
  const inputKey = draft?.inputKey ?? localInputKey;
  const setInputKey = draft?.setInputKey ?? setLocalInputKey;
  const [showKey, setShowKey] = useState(false);

  // Sync state from storage whenever screen gains focus
  useFocusEffect(
    useCallback(() => {
      const currentStoredKey = settingsStorage.getTmdbApiKey();
      setSavedKey(currentStoredKey);
      if (!draft) setLocalInputKey(currentStoredKey);
    }, [Boolean(draft)]),
  );

  const normalizedInput = inputKey.trim();
  const isDirty = normalizedInput !== savedKey;
  const canSave = isDirty && Boolean(normalizedInput);

  const saveKey = (overrideValue?: string) => {
    const keyToSave = (overrideValue !== undefined ? overrideValue : inputKey).trim();
    if (!keyToSave) {
      clearKey();
      return;
    }
    settingsStorage.setTmdbApiKey(keyToSave);
    setInputKey(keyToSave);
    setSavedKey(keyToSave);
    ToastAndroid.show('Custom TMDB API key saved', ToastAndroid.SHORT);
  };

  const clearKey = () => {
    settingsStorage.setTmdbApiKey('');
    setInputKey('');
    setSavedKey('');
    ToastAndroid.show('Using bundled default key', ToastAndroid.SHORT);
  };

  const handleBlur = () => {
    if (normalizedInput && normalizedInput !== savedKey) {
      saveKey(normalizedInput);
    }
  };

  return (
    <SettingsSection title="Metadata">
      <View style={{padding: 16}}>
        <SettingsSearchAnchor label="Custom TMDB API key">
          <AppText role="bodyLarge" style={{color: colors.onSurface}}>
            Custom TMDB API key
          </AppText>
        </SettingsSearchAnchor>
        <AppText
          role="bodySmall"
          style={{
            color: colors.onSurfaceVariant,
            lineHeight: 19,
            marginTop: 4,
          }}>
          A custom TMDB API v3 key takes priority over the key bundled with
          Vega. Clear it to return to the default.
        </AppText>

        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surfaceContainerHighest,
            borderColor: savedKey ? colors.primary : colors.outlineVariant,
            borderRadius: 18,
            borderWidth: 1,
            flexDirection: 'row',
            marginTop: 16,
          }}>
          <TextInput
            focusable={true}
            autoCapitalize="none"
            autoCorrect={false}
            importantForAutofill="no"
            onBlur={handleBlur}
            onChangeText={setInputKey}
            onSubmitEditing={() => saveKey()}
            placeholder="Enter TMDB API v3 key"
            placeholderTextColor={colors.onSurfaceVariant}
            returnKeyType="done"
            secureTextEntry={!showKey}
            selectionColor={colors.primary}
            style={{
              color: colors.onSurface,
              flex: 1,
              fontSize: 15,
              height: 54,
              paddingHorizontal: 16,
            }}
            value={inputKey}
          />
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={showKey ? 'Hide API key' : 'Show API key'}
            onPress={() => setShowKey(value => !value)}
            borderRadius={24}
            focusScale={1.1}
            style={{
              alignItems: 'center',
              height: 48,
              justifyContent: 'center',
              width: 48,
            }}>
            <MaterialCommunityIcons
              name={showKey ? 'eye-off-outline' : 'eye-outline'}
              size={23}
              color={colors.primary}
            />
          </TVFocusable>
        </View>

        <View style={{flexDirection: 'row', gap: 10, marginTop: 14}}>
          {isTV ? (
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Clear custom TMDB API key"
              disabled={!savedKey && !inputKey}
              onPress={clearKey}
              focusScale={1.03}
              borderRadius={16}
              style={{
                alignItems: 'center',
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 16,
                flex: 1,
                height: 48,
                justifyContent: 'center',
                opacity: !savedKey && !inputKey ? 0.38 : 1,
              }}>
              <AppText
                role="labelLargeEmphasized"
                style={{color: colors.onSurface}}>
                Clear
              </AppText>
            </TVFocusable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear custom TMDB API key"
              disabled={!savedKey && !inputKey}
              onPress={clearKey}
              style={({pressed}) => ({
                alignItems: 'center',
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 16,
                flex: 1,
                height: 48,
                justifyContent: 'center',
                opacity: !savedKey && !inputKey ? 0.38 : pressed ? 0.72 : 1,
              })}>
              <AppText
                role="labelLargeEmphasized"
                style={{color: colors.onSurface}}>
                Clear
              </AppText>
            </Pressable>
          )}
          {isTV ? (
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Save custom TMDB API key"
              disabled={!canSave}
              onPress={() => saveKey()}
              focusScale={1.03}
              borderRadius={16}
              style={{
                alignItems: 'center',
                backgroundColor: colors.primary,
                borderRadius: 16,
                flex: 1,
                height: 48,
                justifyContent: 'center',
                opacity: !canSave ? 0.38 : 1,
              }}>
              <AppText
                role="labelLargeEmphasized"
                style={{color: colors.onPrimary}}>
                Save
              </AppText>
            </TVFocusable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save custom TMDB API key"
              disabled={!canSave}
              onPress={() => saveKey()}
              style={({pressed}) => ({
                alignItems: 'center',
                backgroundColor: colors.primary,
                borderRadius: 16,
                flex: 1,
                height: 48,
                justifyContent: 'center',
                opacity: !canSave ? 0.38 : pressed ? 0.72 : 1,
              })}>
              <AppText
                role="labelLargeEmphasized"
                style={{color: colors.onPrimary}}>
                Save
              </AppText>
            </Pressable>
          )}
        </View>

        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 6,
            marginTop: 12,
          }}>
          <MaterialCommunityIcons
            name={
              savedKey
                ? 'check-circle-outline'
                : isDirty
                  ? 'alert-circle-outline'
                  : 'information-outline'
            }
            size={16}
            color={
              savedKey
                ? '#22c55e'
                : isDirty
                  ? colors.primary
                  : colors.onSurfaceVariant
            }
          />
          <AppText
            role="labelSmall"
            style={{
              color: savedKey
                ? '#22c55e'
                : isDirty
                  ? colors.primary
                  : colors.onSurfaceVariant,
            }}>
            {savedKey
              ? `Custom key active (${savedKey.slice(0, 4)}...${savedKey.slice(-4)})`
              : isDirty
                ? 'Unsaved changes — tap Save to apply'
                : 'Using bundled default key'}
          </AppText>
        </View>
      </View>
    </SettingsSection>
  );
};

export default TmdbApiKeyPreference;
