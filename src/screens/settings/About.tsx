import {SettingsSearchScrollView} from '../../components/ui/SettingsSearchTarget';
import {useFocusEffect} from '@react-navigation/native';
import {View, ToastAndroid, Linking, BackHandler, findNodeHandle} from 'react-native';
// import pkg from '../../../package.json';
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {settingsStorage} from '../../lib/storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {notificationService} from '../../lib/services/Notification';
import SettingsChoiceDialog from '../../components/ui/SettingsChoiceDialog';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import LoadingIndicator from '../../components/ui/LoadingIndicator';
import useAppDialogStore, {
  showAppDialog,
  type GlobalAppDialog,
} from '../../lib/zustand/appDialogStore';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import {
  isDetailedLoggingEnabled,
  setDetailedLogging,
  shareLogs,
  clearLogs,
} from '../../lib/logging/vegaLog';
import {selectUpdate, type AppRelease} from '../../lib/services/appUpdateReleases';
import {useRemoteStore} from '../../lib/remote/remoteStore';

const deletePartialFile = async (filePath: string) => {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch {}
};

const downloadUpdate = async (url: string, name: string) => {
  let currentDialog: GlobalAppDialog | undefined;
  let cancelDownload: (() => void) | undefined;

  const show = (dialog: GlobalAppDialog) => {
    if (currentDialog && useAppDialogStore.getState().dialog !== currentDialog) {
      return;
    }
    currentDialog = dialog;
    showAppDialog(dialog);
  };

  const updateId = `update-${Date.now()}`;
  const filePath = `${RNFS.CachesDirectoryPath}/${updateId}-${name}`;
  const showInstall = (allowed: boolean, error?: string) => {
    let opening = false;
    show({
      title: 'Update downloaded',
      message: error ?? (allowed
        ? 'The update is ready to install.'
        : 'Allow Vega to install unknown apps in Android settings, then return here to install the update.'),
      actions: [
        {label: 'Close'},
        {
          label: allowed ? 'Install' : 'Allow permission',
          variant: 'primary',
          dismissOnPress: false,
          onPress: async () => {
            if (opening || useAppDialogStore.getState().dialog !== currentDialog) {
              return;
            }
            opening = true;
            show({
              title: 'Update downloaded',
              message: allowed ? 'Opening installerâ€¦' : 'Opening Android settingsâ€¦',
              actions: [{label: 'Close'}],
            });
            try {
              const hasPermission = await notificationService.hasUnknownAppSourcesPermission();
              if (useAppDialogStore.getState().dialog !== currentDialog) {
                return;
              }
              if (allowed && hasPermission) {
                await notificationService.launchApkInstaller(filePath);
                showInstall(true);
              } else {
                showInstall(hasPermission || (!allowed &&
                  await notificationService.requestUnknownAppSourcesPermission()));
              }
            } catch (error) {
              console.warn('[update] Install action failed:', error);
              showInstall(allowed, allowed
                ? 'Could not open the installer. Try again.'
                : 'Could not open Android settings. Try again.');
            }
          },
        },
      ],
    });
  };

  let expectedSize = 0;
  let cancelled = false;
  let notificationsAllowed = false;
  let lastNotificationAt = 0;
  let progressNotifications = Promise.resolve();

  const showProgress = (written: number, total: number) => {
    if (cancelled) return;

    const progress = total > 0 ? Math.min(written / total, 1) : null;
    const message = progress === null
      ? written > 0 ? `${(written / 1048576).toFixed(1)} MB downloaded` : 'Preparing download…'
      : `${Math.floor(progress * 100)}% downloaded`;
    show({
      title: 'Downloading update',
      message,
      progress,
      onDismiss: () => {
        cancelled = true;
        cancelDownload?.();
      },
      actions: [{label: 'Cancel'}],
    });

    const now = Date.now();
    if (!notificationsAllowed || now - lastNotificationAt < 1000) return;
    lastNotificationAt = now;
    progressNotifications = progressNotifications
      .then(() => notificationService.displayUpdateNotification({
        id: updateId,
        title: 'Downloading update',
        body: message,
        onlyAlertOnce: true,
        progress: {current: Math.floor((progress ?? 0) * 100), max: 100, indeterminate: progress === null},
      }))
      .catch(error => console.warn('[update] Progress notification failed:', error));
  };

  showProgress(0, 0);
  try {
    notificationsAllowed = await notificationService.ensureDownloadPermission().catch(() => false);
    if (cancelled || useAppDialogStore.getState().dialog !== currentDialog) return;
    showProgress(0, 0);
    const {jobId, promise} = RNFS.downloadFile({
      fromUrl: url,
      progressInterval: 250,
      toFile: filePath,
      begin: res => {
        expectedSize = res.contentLength;
        showProgress(0, expectedSize);
      },
      progress: res => showProgress(res.bytesWritten, res.contentLength),
    });
    cancelDownload = () => {
      RNFS.stopDownload(jobId);
    };

    const res = await promise;
    if (res.statusCode !== 200 || res.bytesWritten <= 0 ||
        (expectedSize > 0 && res.bytesWritten !== expectedSize)) {
      throw new Error(`Incomplete APK download (HTTP ${res.statusCode})`);
    }
    cancelDownload = undefined;
    if (cancelled || useAppDialogStore.getState().dialog !== currentDialog) {
      await deletePartialFile(filePath);
      return;
    }
  } catch (error) {
    await deletePartialFile(filePath);
    if (!cancelled) {
      console.warn('[update] Download failed:', error);
      show({
        title: 'Update download failed',
        message: 'Check your connection and try again.',
        variant: 'error',
        actions: [
          {label: 'Close'},
          {
            label: 'Retry',
            variant: 'primary',
            dismissOnPress: false,
            onPress: () => void downloadUpdate(url, name),
          },
        ],
      });
    }
    return;
  } finally {
    if (notificationsAllowed && lastNotificationAt > 0) {
      void progressNotifications
        .then(() => notificationService.cancelNotification(updateId))
        .catch(error => console.warn('[update] Could not clear progress notification:', error));
    }
  }

  if (notificationsAllowed) {
    void notificationService.displayUpdateNotification({
      id: 'downloadComplete',
      title: 'Update downloaded',
      body: 'Tap to install',
      data: {filePath, action: 'install'},
    }).catch(error => console.warn('[update] Completion notification failed:', error));
  }

  const allowed = await notificationService.hasUnknownAppSourcesPermission().catch(error => {
    console.warn('[update] Permission check failed:', error);
    return false;
  });
  showInstall(allowed);
};

// handle check for update
export const checkForUpdate = async (
  setUpdateLoading: React.Dispatch<React.SetStateAction<boolean>>,
  autoDownload: boolean,
  showToast: boolean = true,
) => {
  setUpdateLoading(true);
  try {
    const beta = settingsStorage.getUpdateChannel() === 'beta';
    const endpoint = beta ? 'releases?per_page=100' : 'releases/latest';
    const res = await fetch(`https://api.github.com/repos/vega-org/vega-app/${endpoint}`);
    if (res.status === 403 || res.status === 429) {
      ToastAndroid.show(
        'GitHub API rate limit exceeded. Please wait a few minutes before trying again.',
        ToastAndroid.LONG,
      );
      setUpdateLoading(false);
      return;
    }
    if (!res.ok) {
      throw new Error(`GitHub release check failed with status ${res.status}`);
    }
    const response = await res.json();
    const localVersion = Application.nativeApplicationVersion;
    const releases: AppRelease[] = beta ? response : [response];
    if (!Array.isArray(releases) || (!beta && !response?.tag_name)) {
      throw new Error('Invalid release data received from GitHub');
    }
    const data = selectUpdate(releases, localVersion ?? '', beta, isTV);
    if (data) {
      ToastAndroid.show('New update available', ToastAndroid.SHORT);
      const targetKeyword = isTV ? 'tv' : 'mobile';
      const apkAssets = data.assets?.filter((asset: any) =>
        asset.name?.endsWith('.apk') && asset.browser_download_url,
      );
      const apkAsset =
        apkAssets?.find((asset: any) => asset.name.toLowerCase().includes(targetKeyword)) ??
        apkAssets?.find((asset: any) => asset.name.toLowerCase().includes('universal')) ??
        apkAssets?.[0];
      const githubAction = {
        label: 'Open GitHub release',
        onPress: () => {
          void Linking.openURL(data.html_url).catch(() => {
            ToastAndroid.show('Could not open the GitHub release', ToastAndroid.SHORT);
          });
        },
      };
      showAppDialog({
        title: `Update v${localVersion} -> ${data.tag_name}`,
        message: data.body ?? '',
        messageFormat: 'markdown',
        actions: autoDownload && apkAsset
          ? [
              githubAction,
              {
                label: 'Download',
                variant: 'primary',
                dismissOnPress: false,
                onPress: () => void downloadUpdate(apkAsset.browser_download_url, apkAsset.name),
              },
            ]
          : [{label: 'Cancel'}, {...githubAction, variant: 'primary'}],
      });
    } else {
      showToast && ToastAndroid.show('App is up to date', ToastAndroid.SHORT);
    }
  } catch (error) {
    const isRateLimit =
      error instanceof Error &&
      error.message.toLowerCase().includes('rate limit');
    const msg = isRateLimit
      ? 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.'
      : 'Failed to check for update';
    ToastAndroid.show(msg, ToastAndroid.SHORT);
    console.log('Update error', error);
  }
  setUpdateLoading(false);
};

const updateChannels = [
  {value: 'stable', label: 'Stable', description: 'Receive stable releases only.'},
  {value: 'beta', label: 'Beta', description: 'Receive stable releases and prereleases.'},
] as const;

const About = ({navigation}: any) => {
  const isPlayStore = Boolean(Constants.expoConfig?.extra?.isPlayStore);
  const colors = useM3Colors();
  const backRef = useRef<View>(null);
  const autoDownloadRef = useRef<View>(null);
  const [backHandle, setBackHandle] = useState<number | null>(null);
  const [autoDownloadHandle, setAutoDownloadHandle] = useState<number | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [autoDownload, setAutoDownload] = useState(
    settingsStorage.isAutoDownloadEnabled(),
  );
  const [channelChooserOpen, setChannelChooserOpen] = useState(false);
  const [updateChannel, setUpdateChannel] = useState(() => settingsStorage.getUpdateChannel());
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    settingsStorage.isAutoCheckUpdateEnabled(),
  );
  const [detailedLogging, setDetailedLoggingState] = useState(
    isDetailedLoggingEnabled,
  );
  const [exportingLogs, setExportingLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      await clearLogs();
      ToastAndroid.show('Logs cleared', ToastAndroid.SHORT);
    } catch (error: any) {
      ToastAndroid.show(error?.message || 'Could not clear logs', ToastAndroid.SHORT);
    } finally {
      setClearingLogs(false);
    }
  };

  const exportLogs = async () => {
    setExportingLogs(true);
    try {
      const device = useRemoteStore.getState().connectedDevice;
      await shareLogs(
        device
          ? `Receiver ${device.type}: ${[device.manufacturer, device.model, device.name]
              .filter(Boolean)
              .join(' ')}`
          : undefined,
      );
    } catch (error: any) {
      ToastAndroid.show(
        error?.message || 'Could not export logs',
        ToastAndroid.SHORT,
      );
    } finally {
      setExportingLogs(false);
    }
  };

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <SettingsSearchScrollView
        focusable={false}
        accessible={false}
        style={{flex: 1, backgroundColor: colors.background}}
        contentContainerStyle={{padding: 20, paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        <View className="mb-7">
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
            <TVFocusable
              ref={backRef}
              onLayout={() => setBackHandle(findNodeHandle(backRef.current))}
              nextFocusDown={autoDownloadHandle}
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
              {isPlayStore ? 'About Vega' : 'About & updates'}
            </AppText>
          </View>
          <AppText role="bodyLarge" className="mt-1 text-m3-on-surface-variant">
            {isPlayStore ? 'App information' : 'App information and updates'}
          </AppText>
        </View>

        <SettingsSection title="App">
          <SettingsRow
            title="Version"
            description={`Vega ${Application.nativeApplicationVersion || ''}`}
            icon="information-outline"
            divider={isPlayStore}
          />

          {!isPlayStore && (
            <>
              <SettingsSwitchRow
                ref={autoDownloadRef}
                nextFocusUp={backHandle}
                title="Download updates in Vega"
                description="Download releases in Vega when you select Update"
                value={autoDownload}
                onValueChange={next => {
                  setAutoDownload(next);
                  settingsStorage.setAutoDownloadEnabled(next);
                }}
              />
              <SettingsSwitchRow
                title="Check on startup"
                description="Look for a new release when Vega opens"
                value={autoCheckUpdate}
                onValueChange={next => {
                  setAutoCheckUpdate(next);
                  settingsStorage.setAutoCheckUpdateEnabled(next);
                }}
              />
              <SettingsRow
                title="Update channel"
                description={updateChannel === 'beta' ? 'Beta' : 'Stable'}
                icon="source-branch"
                onPress={() => setChannelChooserOpen(true)}
              />
              <SettingsRow
                title="Check for updates"
                description="Compare this build with the latest release"
                icon="update"
                divider={false}
                trailing={
                  updateLoading ? <LoadingIndicator size={14} /> : undefined
                }
                onPress={
                  updateLoading
                    ? undefined
                    : () => checkForUpdate(setUpdateLoading, autoDownload, true)
                }
              />
            </>
          )}
        </SettingsSection>

        {!isTV && (
          <SettingsSection title="Troubleshooting">
            <SettingsSwitchRow
              title="Detailed logging"
              description="Records more detail for bug reports. Keeps up to 2 MB of logs. Turns off after 24 hours."
              value={detailedLogging}
              onValueChange={next => {
                setDetailedLoggingState(next);
                setDetailedLogging(next);
              }}
            />
            <SettingsRow
              title="Export logs"
              description="Share recent app logs with the developer. Links and sign-in data are removed."
              icon="file-document-outline"
              trailing={
                exportingLogs ? <LoadingIndicator size={14} /> : undefined
              }
              onPress={exportingLogs || clearingLogs ? undefined : exportLogs}
            />
            <SettingsRow
              title="Clear logs"
              description="Clear old logs before reproducing a problem."
              icon="delete-outline"
              divider={false}
              trailing={clearingLogs ? <LoadingIndicator size={14} /> : undefined}
              onPress={clearingLogs || exportingLogs ? undefined : handleClearLogs}
            />
          </SettingsSection>
        )}
      </SettingsSearchScrollView>
      {!isPlayStore && channelChooserOpen && (
        <SettingsChoiceDialog
          title="Update channel"
          choices={updateChannels}
          selected={updateChannel}
          onDismiss={() => setChannelChooserOpen(false)}
          onSelect={channel => {
            settingsStorage.setUpdateChannel(channel);
            setUpdateChannel(channel);
            setChannelChooserOpen(false);
          }}
        />
      )}
    </TVFocusGuide>
  );
};

export default About;
