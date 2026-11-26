import React, {useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import {
  getDownloadLocationDisplayValue,
  RESTRICTED_DOWNLOAD_LOCATION_MESSAGE,
  selectDownloadLocation,
  UNREADABLE_DOWNLOAD_LOCATION_MESSAGE,
  validateDownloadLocationAccess,
} from '../../../lib/downloadLocation';
import {settingsStorage} from '../../../lib/storage';
import {syncFromSharedFolder} from '../../../lib/sync/syncService';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSection from '../../../components/ui/SettingsSection';
import {isTV} from '../../../lib/tv';
import {getTVDefaultDownloadLocation} from '../../../lib/downloadLocation';

type DownloadLocationPreferenceProps = {
  primary: string;
};

const DownloadLocationPreference = ({
  primary: _primary,
}: DownloadLocationPreferenceProps) => {
  const [downloadLocation, setDownloadLocation] = useState(
    settingsStorage.getDownloadLocation(),
  );
  const [isPickingFolder, setIsPickingFolder] = useState(false);

  const saveDownloadLocation = (
    location: NonNullable<
      ReturnType<typeof settingsStorage.getDownloadLocationConfig>
    >,
  ) => {
    settingsStorage.setDownloadLocation(location);
    setDownloadLocation(getDownloadLocationDisplayValue(location));
    syncFromSharedFolder().catch(e =>
      console.warn('[VegaSync] Folder change sync failed:', e),
    );
    ToastAndroid.show('Download location updated', ToastAndroid.SHORT);
  };

  const pickDownloadLocation = async () => {
    if (isPickingFolder) {
      return;
    }

    setIsPickingFolder(true);
    try {
      const picked = await selectDownloadLocation();
      if (picked.status === 'selected') {
        if (!(await validateDownloadLocationAccess(picked.location))) {
          ToastAndroid.show(
            UNREADABLE_DOWNLOAD_LOCATION_MESSAGE,
            ToastAndroid.LONG,
          );
          return;
        }
        saveDownloadLocation(picked.location);
        return;
      }
      if (picked.status === 'restricted') {
        ToastAndroid.show(
          RESTRICTED_DOWNLOAD_LOCATION_MESSAGE,
          ToastAndroid.LONG,
        );
        return;
      }

      ToastAndroid.show(
        isTV
          ? 'Install a TV file manager with a folder picker to change the location'
          : 'No folder selected',
        ToastAndroid.LONG,
      );
    } catch (error) {
      console.log('Error picking download folder:', error);
      ToastAndroid.show(
        isTV
          ? 'Install a TV file manager with a folder picker to change the location'
          : 'Unable to open folder picker',
        ToastAndroid.LONG,
      );
    } finally {
      setIsPickingFolder(false);
    }
  };

  return (
    <View className="mb-6">
      <SettingsSection title="Downloads">
        <SettingsRow
          title="Download location"
          description={downloadLocation}
          divider
          icon="folder-open-outline"
          onPress={pickDownloadLocation}
        />
        <SettingsRow
          title="Reset download location"
          description={isTV ? 'Use Vega app storage' : 'Choose a folder again on the next download'}
          divider={false}
          icon="restore"
          onPress={() => {
            settingsStorage.resetDownloadLocation();
            setDownloadLocation(
              isTV ? getTVDefaultDownloadLocation().label! : 'Select a download folder',
            );
            ToastAndroid.show(
              'Download location cleared',
              ToastAndroid.SHORT,
            );
          }}
        />
      </SettingsSection>
    </View>
  );
};

export default DownloadLocationPreference;
