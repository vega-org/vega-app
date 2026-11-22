import React from 'react';
import {View} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import MaterialDialogSurface from './MaterialDialogSurface';
import AppText from './Text';

type Props<T extends string> = {
  title: string;
  choices: readonly {value: T; label: string; description: string}[];
  selected: T;
  onSelect: (value: T) => void;
  onDismiss: () => void;
};

export default function SettingsChoiceDialog<T extends string>({
  title,
  choices,
  selected,
  onSelect,
  onDismiss,
}: Props<T>) {
  const colors = useM3Colors();

  return (
    <MaterialDialogSurface visible onDismiss={onDismiss}>
      <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 16}}>
        {title}
      </AppText>
      <View style={{gap: 8}}>
        {choices.map(choice => {
          const checked = choice.value === selected;
          return (
            <TVFocusable
              key={choice.value}
              registerScreenFocus={false}
              hasTVPreferredFocus={checked}
              accessibilityRole="radio"
              accessibilityLabel={`${choice.label}. ${choice.description}`}
              accessibilityState={{checked}}
              borderRadius={12}
              onPress={() => onSelect(choice.value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: checked ? colors.secondaryContainer : colors.surfaceContainerHighest,
              }}>
              <MaterialIcons
                name={checked ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={24}
                color={colors.primary}
              />
              <View style={{flex: 1}}>
                <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                  {choice.label}
                </AppText>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
                  {choice.description}
                </AppText>
              </View>
            </TVFocusable>
          );
        })}
      </View>
    </MaterialDialogSurface>
  );
}
