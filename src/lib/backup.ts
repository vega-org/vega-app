import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {mainStorage} from './storage/StorageService';
import {SettingsKeys, settingsStorage} from './storage/SettingsStorage';
import {ProvidersKeys} from './storage/ProvidersStorage';
import {
  ExtensionKeys,
  type ProviderExtension,
  type ProviderModule,
  type ProviderSource,
} from './storage/extensionStorage';
import useContentStore from './zustand/contentStore';
import useThemeStore from './zustand/themeStore';

export const BACKUP_VERSION = 1;

type SettingType = 'bool' | 'string' | 'number' | 'array';

// Download location and launcher icon are left out because they point to
// device state (a folder permission and an activity alias) that a restore
// cannot bring back. Buffer sizes (forwardBufferMB, backBufferMB) are also
// left out because their safe limits depend on the device's physical RAM and heap.
const BACKUP_SETTINGS: Record<string, SettingType> = {
  [SettingsKeys.PRIMARY_COLOR]: 'string',
  [SettingsKeys.IS_CUSTOM_THEME]: 'bool',
  [SettingsKeys.SHOW_TAB_BAR_LABELS]: 'bool',
  [SettingsKeys.HIDE_DOWNLOADS_TAB]: 'bool',
  [SettingsKeys.SHOW_CONTINUE_WATCHING]: 'bool',
  [SettingsKeys.CUSTOM_COLOR]: 'string',
  [SettingsKeys.ACCENT_SOURCE]: 'string',
  [SettingsKeys.DYNAMIC_INFO_ACCENT]: 'bool',
  [SettingsKeys.HAPTIC_FEEDBACK]: 'bool',
  [SettingsKeys.NOTIFICATIONS_ENABLED]: 'bool',
  [SettingsKeys.AUTO_CHECK_UPDATE]: 'bool',
  [SettingsKeys.AUTO_DOWNLOAD]: 'bool',
  [SettingsKeys.SHOW_MEDIA_CONTROLS]: 'bool',
  [SettingsKeys.SHOW_HAMBURGER_MENU]: 'bool',
  [SettingsKeys.HIDE_SEEK_BUTTONS]: 'bool',
  [SettingsKeys.SHOW_PLAYER_EPISODE_SIDEBAR]: 'bool',
  [SettingsKeys.AUTO_PLAY_NEXT_EPISODE]: 'bool',
  [SettingsKeys.SHOW_SLEEP_TIMER]: 'bool',
  [SettingsKeys.ENABLE_2X_GESTURE]: 'bool',
  [SettingsKeys.ENABLE_SWIPE_GESTURE]: 'bool',
  [SettingsKeys.SEEK_INTERVAL]: 'number',
  [SettingsKeys.PLAYBACK_SPEED]: 'number',
  [SettingsKeys.TORRENT_FULL_DOWNLOAD]: 'bool',
  [SettingsKeys.ALWAYS_CAST_MODE]: 'bool',
  [SettingsKeys.ASK_LOCAL_FILE_FIRST]: 'bool',
  [SettingsKeys.EXCLUDED_QUALITIES]: 'array',
  [SettingsKeys.PROVIDER_ORDER]: 'array',
  [SettingsKeys.DOWNLOAD_CONCURRENCY]: 'number',
  [SettingsKeys.DOWNLOAD_CONNECTIONS]: 'number',
  [SettingsKeys.PARALLEL_STREAMING]: 'bool',
  [SettingsKeys.SUBTITLE_FONT_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_OPACITY]: 'string',
  [SettingsKeys.SUBTITLE_TEXT_OPACITY]: 'number',
  [SettingsKeys.SUBTITLE_BOTTOM_PADDING]: 'number',
  [SettingsKeys.SUBTITLE_TEXT_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_FONT_FAMILY]: 'string',
  [SettingsKeys.SUBTITLE_EDGE_TYPE]: 'string',
  [SettingsKeys.SUBTITLE_EDGE_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_OUTLINE_WIDTH]: 'number',
  [SettingsKeys.LIST_VIEW_TYPE]: 'string',
  [SettingsKeys.TELEMETRY_OPT_IN]: 'bool',
  [SettingsKeys.TMDB_API_KEY]: 'string',
  [SettingsKeys.TMDB_API_KEY_REVISION]: 'number',
  [SettingsKeys.DOH_ENABLED]: 'bool',
  [SettingsKeys.DOH_PROVIDER]: 'string',
  [SettingsKeys.DOH_CUSTOM_URL]: 'string',
  [SettingsKeys.WARP_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_CMD_ARGS]: 'string',
  [SettingsKeys.SKIP_IN_APP_WEBVIEW]: 'bool',
  // Saved by the Preferences screen without a SettingsKeys entry.
  disableDrawer: 'bool',
  showRecentlyWatched: 'bool',
  useExternalPlayer: 'bool',
  alwaysExternalDownloader: 'bool',
};

type SettingValue = boolean | string | number | string[];

export interface VegaBackup {
  app: 'vega';
  version: number;
  createdAt: string;
  settings: Record<string, SettingValue>;
  providers: {
    installed: ProviderExtension[];
    sources: ProviderSource[];
    modules: ProviderModule[];
    disabled?: string[];
    selected?: ProviderExtension;
  };
}

const readSetting = (key: string, type: SettingType) => {
  switch (type) {
    case 'bool':
      return mainStorage.getBool(key);
    case 'string':
      return mainStorage.getString(key);
    case 'number':
      return mainStorage.getNumber(key);
    case 'array':
      return mainStorage.getArray<string>(key);
  }
};

const isValidSetting = (value: unknown, type: SettingType) => {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'array':
      return isStringArray(value);
  }
};

const writeSetting = (key: string, type: SettingType, value: SettingValue) => {
  switch (type) {
    case 'bool':
      mainStorage.setBool(key, value as boolean);
      break;
    case 'string':
      mainStorage.setString(key, value as string);
      break;
    case 'number':
      mainStorage.setNumber(key, value as number);
      break;
    case 'array':
      mainStorage.setArray(key, value as string[]);
      break;
  }
};

const isProvider = (value: unknown): value is ProviderExtension => {
  const provider = value as ProviderExtension;
  return (
    typeof provider?.value === 'string' &&
    typeof provider.display_name === 'string' &&
    typeof provider.type === 'string' &&
    typeof provider.version === 'string' &&
    typeof provider.source?.author === 'string' &&
    typeof provider.source?.url === 'string'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isProviderModule = (value: unknown): value is ProviderModule =>
  typeof (value as ProviderModule)?.value === 'string' &&
  !!(value as ProviderModule).modules &&
  typeof (value as ProviderModule).modules === 'object';

const isProviderSource = (value: unknown): value is ProviderSource =>
  typeof (value as ProviderSource)?.author === 'string' &&
  typeof (value as ProviderSource)?.url === 'string';

export const createBackup = (): VegaBackup => {
  const settings: Record<string, SettingValue> = {};
  for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
    // Only saved values are included so defaults stay defaults after restore.
    if (!mainStorage.hasKey(key)) {
      continue;
    }
    const value = readSetting(key, type);
    if (value !== undefined) {
      settings[key] = value;
    }
  }

  const selected = useContentStore.getState().provider;

  return {
    app: 'vega',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    settings,
    providers: {
      installed:
        mainStorage.getArray<ProviderExtension>(
          ExtensionKeys.INSTALLED_PROVIDERS,
        ) || [],
      sources:
        mainStorage.getArray<ProviderSource>(ExtensionKeys.PROVIDER_SOURCES) ||
        [],
      modules:
        mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) ||
        [],
      disabled: mainStorage.getArray<string>(ProvidersKeys.DISABLED_PROVIDERS),
      selected: selected?.value ? selected : undefined,
    },
  };
};

export const parseBackup = (text: string): VegaBackup => {
  let data: VegaBackup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Vega backup');
  }
  if (data?.app !== 'vega' || typeof data.version !== 'number') {
    throw new Error('This file is not a Vega backup');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Vega');
  }
  const {settings, providers} = data;
  if (
    !settings ||
    typeof settings !== 'object' ||
    Array.isArray(settings) ||
    !Array.isArray(providers?.installed) ||
    !Array.isArray(providers.sources) ||
    !Array.isArray(providers.modules)
  ) {
    throw new Error('This backup file is incomplete');
  }
  return data;
};

export const restoreBackup = (backup: VegaBackup): void => {
  const settings = backup.settings || {};
  for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
    const value = settings[key];
    if (isValidSetting(value, type)) {
      writeSetting(key, type, value);
    }
  }

  // The theme store keeps its own persisted copy, so update it too. Do this
  // before selecting the provider so it cannot overwrite it (see #526).
  useThemeStore.setState({
    primary: settingsStorage.getPrimaryColor(),
    isCustom: settingsStorage.isCustomTheme(),
    source: settingsStorage.getAccentSource(),
  });

  const {installed, sources, modules, disabled, selected} =
    backup.providers || {};
  if (Array.isArray(installed)) {
    const providers = installed.filter(isProvider);
    mainStorage.setArray(ExtensionKeys.INSTALLED_PROVIDERS, providers);
    useContentStore.getState().setInstalledProviders(providers);
  }
  if (Array.isArray(sources)) {
    mainStorage.setArray(
      ExtensionKeys.PROVIDER_SOURCES,
      sources.filter(isProviderSource),
    );
  }
  if (Array.isArray(modules)) {
    mainStorage.setArray(
      ExtensionKeys.PROVIDER_MODULES,
      modules.filter(isProviderModule),
    );
  }
  if (isStringArray(disabled)) {
    mainStorage.setArray(ProvidersKeys.DISABLED_PROVIDERS, disabled);
  }
  if (isProvider(selected)) {
    useContentStore.getState().setProvider(selected);
  }
};

const getBackupFileName = () =>
  `vega-backup-${new Date().toISOString().slice(0, 10)}`;

/**
 * Asks for a folder and writes the backup there.
 * Returns false when the user cancels the folder picker.
 */
export const exportBackup = async (): Promise<boolean> => {
  const permission =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    return false;
  }
  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    getBackupFileName(),
    'application/json',
  );
  await FileSystem.StorageAccessFramework.writeAsStringAsync(
    fileUri,
    JSON.stringify(createBackup(), null, 2),
  );
  return true;
};

/**
 * Asks for a backup file and reads it.
 * Returns undefined when the user cancels the file picker.
 */
export const pickBackup = async (): Promise<VegaBackup | undefined> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'application/octet-stream', 'text/plain'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) {
    return undefined;
  }
  const text = await FileSystem.readAsStringAsync(result.assets[0].uri);
  return parseBackup(text);
};
