import React, {useCallback, useState} from 'react';
import {
  BackHandler,
  DevSettings,
  ToastAndroid,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import * as Updates from 'expo-updates';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import type {SettingsStackParamList} from '../../App';
import BackupExportDialog from '../../components/BackupExportDialog';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import AppText from '../../components/ui/Text';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import {exportBackup, pickBackup, restoreBackup, type BackupSelection} from '../../lib/backup';
import {clearAppCache} from '../../lib/clearAppCache';
import {
  clearAllMMKVStorage,
  settingsStorage,
  watchProgressStorage,
} from '../../lib/storage';
import {syncFromSharedFolder} from '../../lib/sync/syncService';
import {isTV} from '../../lib/tv';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Props = NativeStackScreenProps<SettingsStackParamList, 'DataManagement'>;

export default function DataManagement({navigation}: Props) {
  const colors = useM3Colors();
  const [backupOptionsVisible, setBackupOptionsVisible] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(() => settingsStorage.isSyncEnabled());

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation.canGoBack()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  const handleSyncToggle = useCallback((next: boolean) => {
    settingsStorage.setSyncEnabled(next);
    setSyncEnabled(next);
    if (next) {
      syncFromSharedFolder().catch(error =>
        console.warn('[VegaSync] Sync on toggle failed:', error),
      );
    }
  }, []);

  const confirmClearWatchProgress = useCallback(() => {
    showAppDialog({
      title: 'Clear watch progress?',
      message:
        'This clears saved episode and video playback positions. Watchlist, downloads, providers, and Continue watching will not be cleared.',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Clear',
          variant: 'destructive',
          onPress: () => {
            watchProgressStorage.clearAllProgress();
            ToastAndroid.show('Watch progress cleared', ToastAndroid.SHORT);
          },
        },
      ],
    });
  }, []);

  const clearCacheHandler = useCallback(async () => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('virtualKey', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    await clearAppCache();
    ToastAndroid.show('App cache cleared', ToastAndroid.SHORT);
  }, []);

  const reloadApp = useCallback(async (reason: string) => {
    if (Updates.isEnabled) {
      await Updates.reloadAsync();
      return;
    }
    DevSettings.reload(reason);
  }, []);

  const eraseAllLocalData = useCallback(async () => {
    clearAllMMKVStorage();
    await reloadApp('All MMKV storage erased');
  }, [reloadApp]);

  const confirmEraseAllLocalData = useCallback(() => {
    showAppDialog({
      title: 'Erase all local data?',
      message:
        'This permanently erases every Vega MMKV store, including settings, installed provider data, Library, Continue watching, download records, and cached state. This cannot be undone. Downloaded media files on disk are not deleted.',
      variant: 'error',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Erase everything',
          variant: 'destructive',
          onPress: eraseAllLocalData,
        },
      ],
    });
  }, [eraseAllLocalData]);

  const exportBackupHandler = useCallback(async (selection: BackupSelection) => {
    setBackupOptionsVisible(false);
    try {
      if (await exportBackup(selection)) {
        ToastAndroid.show('Backup saved', ToastAndroid.SHORT);
      }
    } catch (error) {
      console.error('Failed to export backup:', error);
      ToastAndroid.show('Failed to save backup', ToastAndroid.SHORT);
    }
  }, []);

  const importBackupHandler = useCallback(async () => {
    try {
      const backup = await pickBackup();
      if (!backup) {
        return;
      }
      showAppDialog({
        title: 'Restore backup?',
        message:
          `This restores ${[
            backup.settings !== undefined && 'settings',
            backup.library !== undefined && 'library',
            backup.providers !== undefined && 'providers',
            backup.history !== undefined && 'watch history',
            backup.progress !== undefined && 'watch progress',
          ].filter(Boolean).join(', ')}. Sections absent from the backup stay unchanged. Vega will restart after restoring.`,
        actions: [
          {label: 'Cancel'},
          {
            label: 'Restore',
            variant: 'primary',
            onPress: async () => {
              restoreBackup(backup);
              await reloadApp('Backup restored');
            },
          },
        ],
      });
    } catch (error) {
      showAppDialog({
        title: 'Could not restore backup',
        message:
          error instanceof Error ? error.message : 'Failed to read the file',
        variant: 'error',
        actions: [{label: 'OK'}],
      });
    }
  }, [reloadApp]);

  return (
    <TVFocusGuide
      autoFocus={true}
      trapFocusRight={true}
      trapFocusDown={true}
      style={{flex: 1}}>
      <SettingsPage>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}>
          <TVFocusable
            hasTVPreferredFocus={isTV}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() => navigation.goBack()}
            borderRadius={22}
            style={{
              alignItems: 'center',
              height: 44,
              justifyContent: 'center',
              marginRight: 10,
              width: 44,
            }}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={28}
              color={colors.onBackground}
            />
          </TVFocusable>
          <AppText
            role="headlineLargeEmphasized"
            className="text-m3-on-background">
            Data management
          </AppText>
        </View>
        <AppText
          role="bodyLarge"
          className="mb-7 mt-1 text-m3-on-surface-variant">
          Backups, cache, watch progress, and sync
        </AppText>

        <SettingsSection title="Sync">
          <SettingsSwitchRow
            title="Sync"
            description="Sync watch history, watchlist, and downloads across devices via the download folder"
            value={syncEnabled}
            divider={false}
            onValueChange={handleSyncToggle}
          />
        </SettingsSection>

        <SettingsSection title="Watch Progress">
          <SettingsRow
            title="Clear watch progress"
            description="Reset playback progress for all episodes and videos"
            icon="history"
            divider={false}
            onPress={confirmClearWatchProgress}
          />
        </SettingsSection>

        <SettingsSection title="Backup & Cache">
          <SettingsRow
            title="Clear Cache"
            description="Clear temporary cache and images"
            icon="delete-outline"
            onPress={clearCacheHandler}
          />
          <SettingsRow
            title="Export backup"
            description="Save settings, providers and library to a file"
            icon="content-save-outline"
            onPress={() => setBackupOptionsVisible(true)}
          />
          <SettingsRow
            title="Import backup"
            description="Restore settings, providers and library from a file"
            icon="backup-restore"
            onPress={importBackupHandler}
          />
          <SettingsRow
            title="Erase all local data"
            description="Erase all local data"
            icon="delete-alert-outline"
            divider={false}
            onPress={confirmEraseAllLocalData}
          />
        </SettingsSection>
      </SettingsPage>
      {backupOptionsVisible && (
        <BackupExportDialog
          onClose={() => setBackupOptionsVisible(false)}
          onExport={exportBackupHandler}
        />
      )}
    </TVFocusGuide>
  );
}
