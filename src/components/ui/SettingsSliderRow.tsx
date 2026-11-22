import {SettingsSearchAnchor} from './SettingsSearchTarget';
import {registerInteractionCommit} from '../../lib/performance/idleWork';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {Host, Slider} from '@expo/ui/jetpack-compose';
import {fillMaxWidth} from '@expo/ui/jetpack-compose/modifiers';
import React, {useCallback, useRef} from 'react';
import {View, findNodeHandle} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {settingsStorage} from '../../lib/storage';
import {useM3Colors, useM3HostTheme} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {TVFocusable} from '../tv/TVFocusable';
import AppText from './Text';

interface SettingsSliderRowProps {
  title: string;
  description?: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: number;
  min: number;
  max: number;
  step?: number;
  valueDisplay?: string | number;
  /**
   * Widest text the value can show. The chip keeps this width, so the title
   * and description do not reflow as the value changes. Defaults to `max`.
   */
  widestValue?: string;
  onValueChange: (value: number) => void;
  onValueChangeFinished?: (value: number) => void;
  divider?: boolean;
}

const SettingsSliderRow = ({
  title,
  description,
  icon,
  value,
  min,
  max,
  step,
  valueDisplay,
  widestValue,
  onValueChange,
  onValueChangeFinished,
  divider = true,
}: SettingsSliderRowProps) => {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const prevValueRef = useRef(value);
  const decreaseRef = useRef<View>(null);
  const increaseRef = useRef<View>(null);
  const [decreaseHandle, setDecreaseHandle] = React.useState<number | null>(
    null,
  );
  const [increaseHandle, setIncreaseHandle] = React.useState<number | null>(
    null,
  );

  // In Android Jetpack Compose Slider:
  // steps = number of discrete intervals between min and max.
  // steps = (max - min) / step - 1
  let steps = 0;
  if (step && step > 0) {
    steps = Math.max(Math.round((max - min) / step) - 1, 0);
  }

  const triggerHaptic = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
  }, []);

  const dirtyRef = useRef(false);
  const finishRef = useRef(onValueChangeFinished);
  React.useEffect(() => {
    if (!dirtyRef.current) prevValueRef.current = value;
  }, [value]);
  React.useEffect(() => {
    finishRef.current = onValueChangeFinished;
  }, [onValueChangeFinished]);
  const commitValue = useCallback(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    finishRef.current?.(prevValueRef.current);
  }, []);
  React.useEffect(() => registerInteractionCommit(commitValue), [commitValue]);

  const handleValueChange = useCallback(
    (v: number) => {
      let next = v;
      if (step && step > 0) {
        next = Number((Math.round((v - min) / step) * step + min).toFixed(6));
      }
      if (next === prevValueRef.current) return;
      prevValueRef.current = next;
      dirtyRef.current = true;
      triggerHaptic();
      onValueChange(next);
    },
    [min, step, onValueChange, triggerHaptic],
  );

  const handleValueChangeFinished = useCallback(() => {
    triggerHaptic();
    commitValue();
  }, [triggerHaptic, commitValue]);

  const display = valueDisplay !== undefined ? valueDisplay : value;

  return (
    <SettingsSearchAnchor label={title}>
      <View
        className="px-4 py-3"
        style={{
          borderBottomColor: colors.outlineVariant,
          borderBottomWidth: divider ? 1 : 0,
        }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 mr-2">
            {icon ? (
              <View
                className="mr-4 h-10 w-10 items-center justify-center rounded-full"
                style={{backgroundColor: colors.secondaryContainer}}>
                <MaterialCommunityIcons
                  name={icon}
                  size={21}
                  color={colors.onSecondaryContainer}
                  pointerEvents="none"
                />
              </View>
            ) : null}
            <View className="flex-1">
              <AppText role="bodyLarge" className="text-m3-on-surface">
                {title}
              </AppText>
              {description ? (
                <AppText
                  role="bodySmall"
                  className="mt-0.5 text-m3-on-surface-variant">
                  {description}
                </AppText>
              ) : null}
            </View>
          </View>
          <View
            className="items-center rounded-full px-2.5 py-1"
            style={{backgroundColor: colors.surfaceContainerHighest}}>
            <AppText
              role="titleSmall"
              style={{color: colors.primary, fontWeight: '700'}}>
              {display}
            </AppText>
            {/* Zero-height copy of the widest value: keeps the chip at least that
                wide without adding height. */}
            <AppText
              role="titleSmall"
              aria-hidden
              style={{fontWeight: '700', height: 0, opacity: 0}}>
              {widestValue ?? String(max)}
            </AppText>
          </View>
        </View>
        <View className="mt-2 w-full">
          {isTV ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 6,
              }}>
              <TVFocusable
                ref={decreaseRef}
                onLayout={() =>
                  setDecreaseHandle(findNodeHandle(decreaseRef.current))
                }
                nextFocusRight={increaseHandle}
                onPress={() => {
                  const s = step && step > 0 ? step : 1;
                  const next = Math.max(min, Math.round((value - s) * 100) / 100);
                  handleValueChange(next);
                  handleValueChangeFinished();
                }}
                borderRadius={20}
                focusScale={1.1}
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${title}`}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: colors.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <MaterialCommunityIcons
                  name="minus"
                  size={24}
                  color={colors.onSurface}
                />
              </TVFocusable>

              <View
                style={{
                  flex: 1,
                  marginHorizontal: 16,
                  height: 8,
                  backgroundColor: colors.surfaceContainerHighest,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, ((value - min) / Math.max(max - min, 1)) * 100))}%`,
                    backgroundColor: colors.primary,
                    borderRadius: 4,
                  }}
                />
              </View>

              <TVFocusable
                ref={increaseRef}
                onLayout={() =>
                  setIncreaseHandle(findNodeHandle(increaseRef.current))
                }
                nextFocusLeft={decreaseHandle}
                onPress={() => {
                  const s = step && step > 0 ? step : 1;
                  const next = Math.min(max, Math.round((value + s) * 100) / 100);
                  handleValueChange(next);
                  handleValueChangeFinished();
                }}
                borderRadius={20}
                focusScale={1.1}
                accessibilityRole="button"
                accessibilityLabel={`Increase ${title}`}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: colors.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <MaterialCommunityIcons
                  name="plus"
                  size={24}
                  color={colors.onSurface}
                />
              </TVFocusable>
            </View>
          ) : (
            <Host
              matchContents={{vertical: true}}
              style={{width: '100%'}}
              {...hostTheme}>
              <Slider
                value={value}
                min={min}
                max={max}
                steps={steps}
                colors={{
                  thumbColor: colors.primary,
                  activeTrackColor: colors.primary,
                  inactiveTrackColor: colors.surfaceContainerHighest,
                  activeTickColor: colors.onPrimary,
                  inactiveTickColor: colors.outlineVariant,
                }}
                onValueChange={handleValueChange}
                onValueChangeFinished={handleValueChangeFinished}
                modifiers={[fillMaxWidth()]}
              />
            </Host>
          )}
        </View>
      </View>
    </SettingsSearchAnchor>
  );
};

export default SettingsSliderRow;
