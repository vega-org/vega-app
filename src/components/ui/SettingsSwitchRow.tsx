import {SettingsSearchAnchor} from './SettingsSearchTarget';
import React, {useCallback, useRef, useState} from 'react';
import {findNodeHandle, Platform, Pressable, Switch, View} from 'react-native';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {TVFocusable} from '../tv';
import AppText from './Text';
import {rippleColor} from './rippleColor';

interface SettingsSwitchRowProps {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  divider?: boolean;
  nextFocusUp?: number | null;
}

const SettingsSwitchRow = React.forwardRef<View, SettingsSwitchRowProps>(({
  title,
  description,
  value,
  onValueChange,
  divider = true,
  nextFocusUp,
}: SettingsSwitchRowProps, forwardedRef) => {
  const colors = useM3Colors();
  const rowRef = useRef<View>(null);
  const [rowHandle, setRowHandle] = useState<number | null>(null);
  const setRefs = useCallback((node: View | null) => {
    rowRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const onLayout = useCallback(() => {
    if (rowRef.current) {
      setRowHandle(findNodeHandle(rowRef.current));
    }
  }, []);

  const renderContent = (isFocused: boolean) => (
    <SettingsSearchAnchor label={title}>
      <View
        className="min-h-16 flex-row items-center px-4 py-3"
        style={{
          backgroundColor: isFocused
            ? colors.surfaceContainerHighest
            : 'transparent',
          borderRadius: isFocused ? 12 : 0,
          borderBottomColor: divider ? colors.outlineVariant : 'transparent',
          borderBottomWidth: divider ? 1 : 0,
          width: '100%',
        }}>
        <View className="mr-4 flex-1">
          <AppText role="bodyLarge" style={{color: colors.onSurface}}>
            {title}
          </AppText>
          {description ? (
            <AppText
              role="bodySmall"
              style={{color: colors.onSurfaceVariant, marginTop: 3}}>
              {description}
            </AppText>
          ) : null}
        </View>
        <Switch
          accessibilityLabel={title}
          value={value}
          disabled={isTV}
          focusable={false}
          pointerEvents={isTV ? 'none' : 'auto'}
          importantForAccessibility={isTV ? 'no' : 'auto'}
          onValueChange={isTV ? undefined : onValueChange}
          thumbColor={value ? colors.onPrimary : colors.outline}
          trackColor={{
            false: colors.surfaceContainerHighest,
            true: colors.primary,
          }}
        />
      </View>
    </SettingsSearchAnchor>
  );

  if (isTV) {
    return (
      <TVFocusable
        ref={setRefs}
        onLayout={onLayout}
        onPress={() => onValueChange(!value)}
        nextFocusRight={rowHandle}
        nextFocusUp={nextFocusUp}
        focusScale={1.02}
        borderRadius={12}
        accessibilityRole="switch"
        accessibilityState={{checked: value}}
        accessibilityLabel={title}
        style={{width: '100%'}}>
        {({focused}) => renderContent(focused)}
      </TVFocusable>
    );
  }

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      accessibilityLabel={title}
      onPress={() => onValueChange(!value)}
      // Ripple keeps playing after a quick tap, unlike a pressed-state
      // opacity change that flips back before it can be seen.
      android_ripple={{color: rippleColor(colors.onSurface)}}
      style={({pressed}) => ({
        backgroundColor:
          pressed && Platform.OS !== 'android'
            ? colors.surfaceContainerHighest
            : 'transparent',
      })}>
      {renderContent(false)}
    </Pressable>
  );
});

export default React.memo(SettingsSwitchRow);
