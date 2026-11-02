import React, {useState} from 'react';
import {ScrollView, useWindowDimensions, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {BackupSelection} from '../lib/backup';
import {useM3Colors} from '../theme/M3PaletteContext';
import MaterialDialogSurface from './ui/MaterialDialogSurface';
import SettingsSwitchRow from './ui/SettingsSwitchRow';
import AppText from './ui/Text';
import {TVFocusable} from './tv';

export default function BackupExportDialog({onClose, onExport}: {
  onClose: () => void;
  onExport: (selection: BackupSelection) => void;
}) {
  const colors = useM3Colors();
  const {height} = useWindowDimensions();
  const [selection, setSelection] = useState<BackupSelection>({
    settings: true, library: true, providers: true, history: true, progress: true,
  });
  const canExport = Object.values(selection).some(Boolean);
  return (
    <MaterialDialogSurface visible onDismiss={onClose} style={{maxHeight: Math.max(200, height - 48)}}>
      <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
        <AppText role="titleLarge" style={{flex: 1, color: colors.onSurface}}>Export backup</AppText>
        <TVFocusable registerScreenFocus={false} accessibilityRole="button"
          accessibilityLabel="Close backup options" onPress={onClose} borderRadius={22}
          style={{width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceVariant} />
        </TVFocusable>
      </View>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
        Choose what to include in the backup file.
      </AppText>
      {([
        ['settings', 'Settings', 'Preferences, appearance and player settings'],
        ['library', 'Library', 'Saved titles, categories and assignments'],
        ['providers', 'Providers', 'Installed providers, sources and provider code'],
        ['history', 'Watch history', 'Continue watching titles and resume positions'],
        ['progress', 'Watch progress', 'Watched and partly watched episodes'],
      ] as const).map(([key, title, description]) => (
        <SettingsSwitchRow key={key} title={title} description={description}
          value={selection[key]} divider={key !== 'progress'}
          onValueChange={checked => setSelection(previous => ({...previous, [key]: checked}))} />
      ))}
      {!canExport && <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
        Select at least one section.
      </AppText>}
      <TVFocusable registerScreenFocus={false} accessibilityRole="button"
        accessibilityLabel="Export selected sections" accessibilityState={{disabled: !canExport}}
        disabled={!canExport} onPress={() => {if (canExport) onExport(selection);}}
        borderRadius={24} style={{marginTop: 20, padding: 14, borderRadius: 24,
          alignItems: 'center', backgroundColor: canExport ? colors.primary : colors.surfaceContainerHighest}}>
        <AppText role="labelLarge" style={{color: canExport ? colors.onPrimary : colors.onSurfaceVariant}}>Export</AppText>
      </TVFocusable>
      </ScrollView>
    </MaterialDialogSurface>
  );
}
