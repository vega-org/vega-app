import {MaterialCommunityIcons} from '@expo/vector-icons';
import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {TVFocusable} from '../../../components/tv';

export type ProviderTestStatus = 'untested' | 'testing' | 'working' | 'failed';

export const ProviderStatusBadge = ({
  status,
  itemKey,
}: {
  status: ProviderTestStatus;
  itemKey: string;
}) => {
  const colors = useM3Colors();

  if (status === 'testing') {
    return (
      <View
        testID={`provider-status-${itemKey}-testing`}
        style={{
          height: 32,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          backgroundColor: colors.secondaryContainer,
          borderRadius: 16,
        }}>
        <ActivityIndicator size={14} color={colors.onSecondaryContainer} />
        <Text
          style={{
            marginLeft: 8,
            fontSize: 12,
            fontWeight: 'bold',
            color: colors.onSecondaryContainer,
          }}>
          Testing
        </Text>
      </View>
    );
  }

  const failed = status === 'failed';
  const working = status === 'working';
  const label = failed ? 'Failed' : working ? 'Working' : 'Not tested';
  const icon = failed ? 'close-circle' : working ? 'check-circle' : 'circle';
  const containerColor = failed
    ? colors.errorContainer
    : working
      ? colors.tertiaryContainer
      : colors.surfaceContainerHighest;
  const contentColor = failed
    ? colors.onErrorContainer
    : working
      ? colors.onTertiaryContainer
      : colors.onSurfaceVariant;

  return (
    <View
      testID={`provider-status-${itemKey}-${status}`}
      style={{
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        backgroundColor: containerColor,
        borderRadius: 16,
      }}>
      <MaterialCommunityIcons
        name={icon}
        size={status === 'untested' ? 9 : 16}
        color={contentColor}
      />
      <Text
        style={{
          marginLeft: 8,
          fontSize: 12,
          fontWeight: 'bold',
          color: contentColor,
        }}>
        {label}
      </Text>
    </View>
  );
};

export const MetadataChip = ({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
}) => {
  const colors = useM3Colors();
  return (
    <View
      style={{
        marginRight: 8,
        marginTop: 8,
        maxWidth: 144,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: colors.surfaceContainerHighest,
        borderRadius: 10,
      }}>
      <MaterialCommunityIcons
        name={icon}
        size={15}
        color={colors.onSurfaceVariant}
      />
      <Text
        style={{
          marginLeft: 6,
          fontSize: 12,
          textTransform: 'capitalize',
          color: colors.onSurfaceVariant,
        }}
        numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

/**
 * Full-width strip under the card header for an installed provider its author
 * disabled in the manifest. It sits outside the header so the name, chips and
 * test status keep the same layout as every other card.
 */
export const DeprecatedProviderChip = ({
  itemKey,
  onPress,
}: {
  itemKey: string;
  onPress: () => void;
}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable
      testID={`provider-deprecated-${itemKey}`}
      accessibilityRole="button"
      accessibilityLabel="Provider removed by its author. Tap for details."
      onPress={onPress}
      borderRadius={12}
      focusScale={1.02}
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.errorContainer,
        borderRadius: 12,
      }}>
      <MaterialCommunityIcons
        name="information"
        size={18}
        color={colors.onErrorContainer}
      />
      <Text
        style={{
          flex: 1,
          marginLeft: 8,
          fontSize: 13,
          fontWeight: '600',
          color: colors.onErrorContainer,
        }}
        numberOfLines={1}>
        Deprecated · removed by its author
      </Text>
      <MaterialCommunityIcons
        name="chevron-right"
        size={18}
        color={colors.onErrorContainer}
      />
    </TVFocusable>
  );
};
