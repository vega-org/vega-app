import {MaterialCommunityIcons} from '@expo/vector-icons';
import React, {useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  View,
} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import ProviderAdultBadge from '../../../components/ProviderAdultBadge';
import type {ProviderExtension} from '../../../lib/storage/extensionStorage';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {isTV} from '../../../lib/tv/constants';
import {
  DeprecatedProviderChip,
  MetadataChip,
  ProviderStatusBadge,
  ProviderTestStatus,
} from './ProviderStatusBadge';
import {ProviderCardActions} from './ProviderCardActions';

export type {ProviderTestStatus};

interface ProviderCardProps {
  provider: ProviderExtension;
  itemKey: string;
  installed: boolean;
  active: boolean;
  installing: boolean;
  updating: boolean;
  testStatus: ProviderTestStatus;
  hasUpdate: boolean;
  hasSettings?: boolean;
  deprecated?: boolean;
  onDeprecatedPress?: () => void;
  primary: string;
  onActivate: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onTest: () => void;
  onUninstall: () => void;
  onOpenSettings?: () => void;
}

const ProviderCard = ({
  provider,
  itemKey,
  installed,
  active,
  installing,
  updating,
  testStatus,
  hasUpdate,
  hasSettings,
  deprecated,
  onDeprecatedPress,
  primary,
  onActivate,
  onInstall,
  onUpdate,
  onTest,
  onUninstall,
  onOpenSettings,
}: ProviderCardProps) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [isCardFocused, setIsCardFocused] = useState(false);

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        overflow: 'hidden',
        backgroundColor: colors.surfaceContainerHigh,
        borderColor: isCardFocused
          ? focusBorderColor
          : active && !isTV
            ? colors.primary
            : colors.outlineVariant,
        borderRadius: 24,
        borderWidth: isCardFocused ? 3 : active && !isTV ? 2 : 1,
        transform: [{scale: isCardFocused && !isTV ? 1.02 : 1}],
      }}>
      {/* Header section - Focusable on TV if installed to activate */}
      <TVFocusable
        disabled={!installed}
        onFocus={() => setIsCardFocused(true)}
        onBlur={() => setIsCardFocused(false)}
        onPress={onActivate}
        showFocusBorder={false}
        focusScale={1.01}
        borderRadius={24}
        style={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
        }}>
        <View
          style={{
            height: 56,
            width: 56,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            backgroundColor: active
              ? colors.primary
              : colors.surfaceContainerHighest,
            borderRadius: 18,
          }}>
          {provider.icon ? (
            <Image
              source={{uri: provider.icon}}
              style={{height: '100%', width: '100%'}}
              resizeMode="cover"
              resizeMethod="resize"
            />
          ) : (
            <MaterialCommunityIcons
              name="web"
              size={32}
              color={active ? colors.onPrimary : colors.onSurface}
            />
          )}
        </View>

        <View style={{marginLeft: 12, flex: 1, minWidth: 0}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text
              style={{
                fontSize: 18,
                fontWeight: 'bold',
                color: colors.onSurface,
                flexShrink: 1,
              }}
              numberOfLines={1}>
              {provider.display_name || 'Unknown Provider'}
            </Text>
            <Text
              style={{
                marginLeft: 8,
                fontSize: 12,
                fontWeight: '600',
                color: colors.onSurfaceVariant,
              }}>
              v{provider.version || 'Unknown'}
            </Text>
            {provider.adult === true && <ProviderAdultBadge />}
          </View>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: 4}}>
            {deprecated && onDeprecatedPress && (
              <DeprecatedProviderChip
                itemKey={itemKey}
                onPress={onDeprecatedPress}
              />
            )}
            <MetadataChip icon="web" label={provider.type || 'Unknown'} />
            {provider.source?.author && (
              <MetadataChip icon="account" label={provider.source.author} />
            )}
          </View>
        </View>

        {installed && (
          <View style={{marginLeft: 8, alignItems: 'flex-end', gap: 8}}>
            {hasUpdate && (
              <TVFocusable
                testID={`update-provider-${itemKey}`}
                accessibilityLabel={`Update ${provider.display_name}`}
                disabled={updating}
                onPress={onUpdate}
                borderRadius={14}
                focusScale={1.15}
                style={{
                  height: 36,
                  width: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.primary,
                  borderRadius: 14,
                }}>
                {updating ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <MaterialCommunityIcons
                    name="update"
                    size={20}
                    color={colors.onPrimary}
                  />
                )}
              </TVFocusable>
            )}
            <ProviderStatusBadge status={testStatus} itemKey={itemKey} />
          </View>
        )}
      </TVFocusable>

      <View
        style={{
          marginHorizontal: 16,
          height: 1,
          backgroundColor: colors.outlineVariant,
        }}
      />

      {/* Action Buttons: Test, Settings, Uninstall or Install */}
      <ProviderCardActions
        provider={provider}
        itemKey={itemKey}
        installed={installed}
        installing={installing}
        testStatus={testStatus}
        hasSettings={hasSettings}
        primary={primary}
        onInstall={onInstall}
        onTest={onTest}
        onUninstall={onUninstall}
        onOpenSettings={onOpenSettings}
      />
    </View>
  );
};

export default React.memo(ProviderCard);
