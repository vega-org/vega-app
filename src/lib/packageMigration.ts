import {DevSettings, NativeModules, Platform, ToastAndroid} from 'react-native';
import * as Updates from 'expo-updates';
import {
  createBackup,
  getBackupSectionLabels,
  parseBackup,
  restoreBackup,
  type VegaBackup,
} from './backup';
import {ExtensionKeys} from './storage/extensionStorage';
import {followedShowsStorage} from './storage/FollowedShowsStorage';
import {mainStorage} from './storage/StorageService';
import {
  DEFAULT_COLLECTION_ID,
  watchListStorage,
  type LibraryCollection,
} from './storage/WatchListStorage';
import {watchProgressStorage} from './storage/WatchProgressStorage';
import useAppDialogStore, {showAppDialog} from './zustand/appDialogStore';
import useContinueWatchingStore from './zustand/continueWatchingStore';

export const LEGACY_MIGRATION_HANDLED_KEY = 'legacy-package-migration-handled';
const DEFAULT_LEGACY_PACKAGE = 'com.vega';

interface NativeDataMigrationModule {
  packageName?: string;
  legacyPackageName?: string;
  getConstants?: () => {
    packageName?: string;
    legacyPackageName?: string;
  };
  writeMigrationSnapshot?: (content: string) => Promise<boolean>;
  clearMigrationSnapshot?: () => Promise<boolean>;
  hasLegacyMigrationSnapshot?: () => Promise<boolean>;
  readLegacyMigrationSnapshot?: () => Promise<string | null>;
}

let lastSyncedFingerprint: string | null = null;
let migrationCheckInFlight = false;
let promptShownThisSession = false;

export const resetMigrationStateForTests = (): void => {
  lastSyncedFingerprint = null;
  migrationCheckInFlight = false;
  promptShownThisSession = false;
};

const getNativeModule = (): NativeDataMigrationModule | undefined => {
  if (Platform.OS !== 'android') {
    return undefined;
  }
  return (NativeModules as {VegaDataMigration?: NativeDataMigrationModule})
    .VegaDataMigration;
};

const getPackageInfo = (): {
  packageName?: string;
  legacyPackageName: string;
} => {
  const native = getNativeModule();
  if (!native) {
    return {legacyPackageName: DEFAULT_LEGACY_PACKAGE};
  }
  const constants =
    native.packageName !== undefined ? native : native.getConstants?.();
  return {
    packageName: constants?.packageName ?? native.packageName,
    legacyPackageName:
      constants?.legacyPackageName ??
      native.legacyPackageName ??
      DEFAULT_LEGACY_PACKAGE,
  };
};

export const isMigrationProducer = (): boolean => {
  const {packageName, legacyPackageName} = getPackageInfo();
  return Boolean(packageName && packageName === legacyPackageName);
};

export const isMigrationConsumer = (): boolean => {
  const {packageName, legacyPackageName} = getPackageInfo();
  return Boolean(packageName && packageName !== legacyPackageName);
};

const hasNonDefaultCollections = (collections?: LibraryCollection[]): boolean =>
  Boolean(collections?.some(collection => collection.id !== DEFAULT_COLLECTION_ID));

export const hasUserDataToMigrate = (backup: VegaBackup): boolean =>
  Object.keys(backup.settings ?? {}).length > 0 ||
  (backup.library?.items?.length ?? 0) > 0 ||
  hasNonDefaultCollections(backup.library?.collections) ||
  (backup.providers?.installed?.length ?? 0) > 0 ||
  (backup.providers?.sources?.length ?? 0) > 0 ||
  (backup.history?.length ?? 0) > 0 ||
  Object.keys(backup.progress ?? {}).length > 0 ||
  (backup.followedShows?.shows?.length ?? 0) > 0;

export const hasLocalUserData = (): boolean =>
  (mainStorage.getArray(ExtensionKeys.INSTALLED_PROVIDERS) || []).length > 0 ||
  (mainStorage.getArray(ExtensionKeys.PROVIDER_SOURCES) || []).length > 0 ||
  watchListStorage.getWatchList().length > 0 ||
  hasNonDefaultCollections(watchListStorage.getCollections()) ||
  useContinueWatchingStore.getState().items.length > 0 ||
  Object.keys(watchProgressStorage.getAllProgress()).length > 0 ||
  followedShowsStorage.getFollowedShows().length > 0;

const getPopulatedMigrationLabels = (backup: VegaBackup): string[] => {
  const labels = [
    Object.keys(backup.settings ?? {}).length > 0 && 'settings',
    ((backup.library?.items?.length ?? 0) > 0 ||
      hasNonDefaultCollections(backup.library?.collections)) &&
      'library',
    ((backup.providers?.installed?.length ?? 0) > 0 ||
      (backup.providers?.sources?.length ?? 0) > 0) &&
      'providers',
    (backup.history?.length ?? 0) > 0 && 'watch history',
    Object.keys(backup.progress ?? {}).length > 0 && 'watch progress',
    (backup.followedShows?.shows?.length ?? 0) > 0 && 'followed shows',
  ].filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels : getBackupSectionLabels(backup);
};

const reloadAfterMigration = async (): Promise<void> => {
  if (Updates.isEnabled) {
    await Updates.reloadAsync();
    return;
  }
  DevSettings.reload('Legacy data migrated');
};

export async function clearMigrationSnapshot(): Promise<void> {
  lastSyncedFingerprint = null;
  const native = getNativeModule();
  if (native?.clearMigrationSnapshot) {
    await native.clearMigrationSnapshot();
  }
}

export async function syncMigrationSnapshot(force = false): Promise<boolean> {
  if (!isMigrationProducer()) {
    return false;
  }
  const native = getNativeModule();
  if (!native?.writeMigrationSnapshot) {
    return false;
  }
  const backup = createBackup();
  if (!hasUserDataToMigrate(backup)) {
    if (lastSyncedFingerprint !== '' || force) {
      await clearMigrationSnapshot();
      lastSyncedFingerprint = '';
    }
    return false;
  }
  const comparable: Omit<VegaBackup, 'createdAt'> & {createdAt?: string} = {
    ...backup,
  };
  delete comparable.createdAt;
  const fingerprint = JSON.stringify(comparable);
  if (!force && fingerprint === lastSyncedFingerprint) {
    return false;
  }
  await native.writeMigrationSnapshot(JSON.stringify(backup));
  lastSyncedFingerprint = fingerprint;
  return true;
}

export async function hasLegacyMigrationData(): Promise<boolean> {
  if (!isMigrationConsumer()) {
    return false;
  }
  const native = getNativeModule();
  if (!native?.hasLegacyMigrationSnapshot) {
    return false;
  }
  return Boolean(await native.hasLegacyMigrationSnapshot());
}

export async function readLegacyMigrationBackup(): Promise<VegaBackup | null> {
  if (!isMigrationConsumer()) {
    return null;
  }
  const native = getNativeModule();
  if (!native?.readLegacyMigrationSnapshot) {
    return null;
  }
  const raw = await native.readLegacyMigrationSnapshot();
  if (!raw) {
    return null;
  }
  const backup = parseBackup(raw);
  return hasUserDataToMigrate(backup) ? backup : null;
}

export async function promptLegacyPackageMigration(options?: {
  manual?: boolean;
}): Promise<boolean> {
  const manual = Boolean(options?.manual);
  if (migrationCheckInFlight || !isMigrationConsumer()) {
    return false;
  }
  migrationCheckInFlight = true;
  try {
    if (!manual) {
      if (mainStorage.getBool(LEGACY_MIGRATION_HANDLED_KEY, false)) {
        return false;
      }
      if (hasLocalUserData()) {
        mainStorage.setBool(LEGACY_MIGRATION_HANDLED_KEY, true);
        return false;
      }
      if (
        promptShownThisSession ||
        useAppDialogStore.getState().dialog !== undefined
      ) {
        return false;
      }
      if (!(await hasLegacyMigrationData())) {
        return false;
      }
    }

    let backup: VegaBackup | null = null;
    try {
      backup = await readLegacyMigrationBackup();
    } catch (error) {
      if (manual) {
        showAppDialog({
          title: 'Could not import data',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to read data from the previous Vega app.',
          variant: 'error',
          actions: [{label: 'OK'}],
        });
      }
      return false;
    }

    if (!backup) {
      if (manual) {
        showAppDialog({
          title: 'No data found to import',
          message:
            'Open your previous Vega app once on this device so it can prepare your data, or import a backup file instead.',
          actions: [{label: 'OK'}],
        });
      }
      return false;
    }

    promptShownThisSession = true;
    const labels = getPopulatedMigrationLabels(backup).join(', ');
    showAppDialog({
      title: 'Import data from Vega?',
      message: `Found saved data from your previous Vega installation (${labels}). Import it into this app?`,
      actions: [
        {
          label: manual ? 'Cancel' : 'Start fresh',
          onPress: () => {
            if (!manual) {
              mainStorage.setBool(LEGACY_MIGRATION_HANDLED_KEY, true);
            }
          },
        },
        {
          label: 'Import data',
          variant: 'primary',
          onPress: async () => {
            try {
              restoreBackup(backup);
              mainStorage.setBool(LEGACY_MIGRATION_HANDLED_KEY, true);
              ToastAndroid.show('Data imported', ToastAndroid.SHORT);
              await reloadAfterMigration();
            } catch (error) {
              await Promise.resolve();
              showAppDialog({
                title: 'Could not import data',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Failed to restore migrated data.',
                variant: 'error',
                actions: [{label: 'OK'}],
              });
            }
          },
        },
      ],
    });
    return true;
  } finally {
    migrationCheckInFlight = false;
  }
}

export const checkLegacyPackageMigration = (): Promise<boolean> =>
  promptLegacyPackageMigration({manual: false});
