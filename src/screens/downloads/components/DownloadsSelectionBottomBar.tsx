import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import {ActivityIndicator, View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import {isTV} from '../../../lib/tv';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {useFloatingTabBarInset} from '../../../components/navigation/FloatingTabBarInsetContext';

interface DownloadsSelectionBottomBarProps {
  selectedCount: number;
  isAllSelected: boolean;
  isDeleting: boolean;
  onToggleSelectAll: () => void;
  onInvertSelection: () => void;
  onDeletePress: () => void;
  onExitSelection?: () => void;
}

export const DownloadsSelectionBottomBar: React.FC<DownloadsSelectionBottomBarProps> = ({
  selectedCount,
  isAllSelected,
  isDeleting,
  onToggleSelectAll,
  onInvertSelection,
  onDeletePress,
  onExitSelection,
}) => {
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const focusBorderColor = useTVFocusBorderColor();

  return (
    <View
      style={{
        bottom: isTV ? 20 : 24 + floatingTabBarInset,
        left: isTV ? 24 : 16,
        position: 'absolute',
        right: isTV ? 48 : 16,
        zIndex: 20,
      }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHighest,
          borderColor: colors.outlineVariant,
          borderRadius: 24,
          borderWidth: 1,
          elevation: 8,
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 10,
          shadowColor: '#000',
          shadowOffset: {width: 0, height: 4},
          shadowOpacity: 0.35,
          shadowRadius: 10,
        }}>
        <View style={{alignItems: 'center', flexDirection: 'row', gap: onExitSelection ? 8 : 16}}>
          {onExitSelection && <TVFocusable accessibilityRole="button" accessibilityLabel="Exit selection" disabled={isDeleting} onPress={onExitSelection} borderRadius={18} focusScale={1.1} focusBorderColor={focusBorderColor} style={{minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center'}}><MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceVariant} /></TVFocusable>}
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Select all"
            disabled={isDeleting}
            onPress={onToggleSelectAll}
            borderRadius={18}
            focusScale={1.1}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              borderRadius: 18,
              justifyContent: 'center',
              minHeight: 36,
              minWidth: 36,
              padding: 4,
            }}>
            <MaterialIcons
              name="select-all"
              size={24}
              color={isAllSelected ? colors.primary : colors.onSurfaceVariant}
            />
          </TVFocusable>
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Invert selection"
            disabled={isDeleting}
            onPress={onInvertSelection}
            borderRadius={18}
            focusScale={1.1}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              borderRadius: 18,
              justifyContent: 'center',
              minHeight: 36,
              minWidth: 36,
              padding: 4,
            }}>
            <MaterialCommunityIcons
              name="select-inverse"
              size={24}
              color={colors.onSurfaceVariant}
            />
          </TVFocusable>
          <AppText
            role="labelMediumEmphasized"
            style={{color: colors.onSurfaceVariant}}>
            {selectedCount}{onExitSelection ? '' : ' selected'}
          </AppText>
        </View>

        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel="Delete selected downloads"
          disabled={isDeleting || selectedCount === 0}
          onPress={onDeletePress}
          borderRadius={16}
          focusScale={1.06}
          focusBorderColor={focusBorderColor}
          style={{
            alignItems: 'center',
            backgroundColor:
              selectedCount > 0
                ? colors.errorContainer
                : colors.surfaceContainerHigh,
            borderRadius: 16,
            flexDirection: 'row',
            gap: 6,
            opacity: isDeleting || selectedCount === 0 ? 0.45 : 1,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}>
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.onErrorContainer} />
          ) : (
            <>
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={20}
                color={
                  selectedCount > 0
                    ? colors.onErrorContainer
                    : colors.onSurfaceVariant
                }
              />
              <AppText
                role="labelLargeEmphasized"
                style={{
                  color:
                    selectedCount > 0
                      ? colors.onErrorContainer
                      : colors.onSurfaceVariant,
                  fontWeight: '700',
                }}>
                Delete
              </AppText>
            </>
          )}
        </TVFocusable>
      </View>
    </View>
  );
};

export default React.memo(DownloadsSelectionBottomBar);
