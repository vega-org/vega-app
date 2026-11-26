import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockValues = new Map<string, unknown>();
const mockProgress = new Map<string, {position: number; duration: number}>();
const mockHistoryState = {items: [] as any[]};
const mockContentState = {
  provider: {value: ''} as any,
  setProvider: jest.fn((provider: any) => {
    mockContentState.provider = provider;
  }),
  setInstalledProviders: jest.fn(),
};
const mockLibraryState = {watchList: [] as any[], collections: [] as any[]};
const mockDialogState: {dialog?: any} = {dialog: undefined};

const mockWriteMigrationSnapshot = jest.fn(async (_json: string) => true);
const mockClearMigrationSnapshot = jest.fn(async () => true);
const mockHasLegacyMigrationSnapshot = jest.fn(async () => false);
const mockReadLegacyMigrationSnapshot = jest.fn<() => Promise<string | null>>(
  async () => null,
);

const mockNativeModule: {
  packageName: string;
  legacyPackageName: string;
  writeMigrationSnapshot: typeof mockWriteMigrationSnapshot;
  clearMigrationSnapshot: typeof mockClearMigrationSnapshot;
  hasLegacyMigrationSnapshot: typeof mockHasLegacyMigrationSnapshot;
  readLegacyMigrationSnapshot: typeof mockReadLegacyMigrationSnapshot;
} = {
  packageName: 'com.vega',
  legacyPackageName: 'com.vega',
  writeMigrationSnapshot: mockWriteMigrationSnapshot,
  clearMigrationSnapshot: mockClearMigrationSnapshot,
  hasLegacyMigrationSnapshot: mockHasLegacyMigrationSnapshot,
  readLegacyMigrationSnapshot: mockReadLegacyMigrationSnapshot,
};

const mockDevReload = jest.fn();
const mockUpdatesReloadAsync = jest.fn(async () => {});
const mockToastShow = jest.fn();
const mockUpdates = {
  isEnabled: false,
  reloadAsync: () => mockUpdatesReloadAsync(),
};

const RN = require('react-native');
RN.Platform.OS = 'android';
RN.NativeModules.VegaDataMigration = mockNativeModule;

jest.mock('expo-updates', () => ({
  __esModule: true,
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  reloadAsync: () => mockUpdatesReloadAsync(),
}));
jest.mock('expo-document-picker', () => ({getDocumentAsync: jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {},
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    hasKey: (key: string) => mockValues.has(key),
    getBool: (key: string, defaultValue = false) =>
      mockValues.has(key) ? Boolean(mockValues.get(key)) : defaultValue,
    setBool: (key: string, value: boolean) => mockValues.set(key, value),
    getString: (key: string) => mockValues.get(key),
    setString: (key: string, value: string) => mockValues.set(key, value),
    getNumber: (key: string) => mockValues.get(key),
    setNumber: (key: string, value: number) => mockValues.set(key, value),
    getObject: (key: string) => mockValues.get(key),
    setObject: (key: string, value: unknown) => mockValues.set(key, value),
    getArray: (key: string) => mockValues.get(key),
    setArray: (key: string, value: unknown[]) => mockValues.set(key, value),
    delete: (key: string) => mockValues.delete(key),
  },
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

jest.mock('../src/lib/storage/WatchProgressStorage', () => ({
  watchProgressStorage: {
    getProgress: (key: string) => mockProgress.get(key) ?? null,
    getAllProgress: () => Object.fromEntries(mockProgress),
    setAllProgress: (
      entries: Record<string, {position: number; duration: number}>,
    ) =>
      Object.entries(entries).forEach(([key, value]) =>
        mockProgress.set(key, value),
      ),
  },
}));

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: {getState: () => mockContentState},
}));

jest.mock('../src/lib/zustand/themeStore', () => ({
  __esModule: true,
  default: {setState: jest.fn()},
}));

jest.mock('../src/lib/zustand/watchListStore', () => ({
  __esModule: true,
  default: {
    setState: (state: {watchList: any[]; collections: any[]}) => {
      mockLibraryState.watchList = state.watchList;
      mockLibraryState.collections = state.collections;
    },
  },
}));

jest.mock('../src/lib/zustand/continueWatchingStore', () => ({
  __esModule: true,
  default: {
    getState: () => mockHistoryState,
    setState: (state: {items: any[]}) => {
      mockHistoryState.items = state.items;
    },
  },
}));

jest.mock('../src/lib/zustand/followedShowsStore', () => ({
  __esModule: true,
  default: {getState: () => ({reloadFromStorage: jest.fn()})},
  syncEpisodeCheckSchedule: jest.fn(async () => {}),
}));

const mockShowAppDialog = jest.fn((dialog: any) => {
  mockDialogState.dialog = dialog;
});
jest.mock('../src/lib/zustand/appDialogStore', () => ({
  __esModule: true,
  default: {
    getState: () => mockDialogState,
  },
  showAppDialog: (dialog: any) => mockShowAppDialog(dialog),
}));

import {BACKUP_VERSION, parseBackup} from '../src/lib/backup';
import {
  checkLegacyPackageMigration,
  clearMigrationSnapshot,
  isMigrationConsumer,
  isMigrationProducer,
  LEGACY_MIGRATION_HANDLED_KEY,
  promptLegacyPackageMigration,
  resetMigrationStateForTests,
  syncMigrationSnapshot,
} from '../src/lib/packageMigration';

const sampleProvider = {
  value: 'vega',
  display_name: 'Vega',
  type: 'global',
  installed: true,
  disabled: false,
  version: '1.0.0',
  icon: '',
  source: {author: 'vega', url: 'https://example.com'},
};

const sampleSnapshot = JSON.stringify({
  app: 'vega',
  version: BACKUP_VERSION,
  createdAt: '2026-11-26T00:00:00.000Z',
  settings: {hapticFeedback: false},
  providers: {
    installed: [sampleProvider],
    sources: [{author: 'vega', url: 'https://example.com'}],
    modules: [],
  },
  library: {
    items: [
      {
        title: 'Saved Title',
        poster: '',
        link: 'https://example.com/title',
        provider: 'vega',
      },
    ],
    collections: [],
  },
  followedShows: {
    shows: [
      {
        id: 'vega::https://example.com/show',
        link: 'https://example.com/show',
        provider: 'vega',
        providerName: 'Vega',
        title: 'Followed Series',
        poster: '',
        seasonTitle: 'Season 1',
        seasonIndex: 0,
        knownEpisodeKeys: ['ep1'],
        knownEpisodeTitles: ['Episode 1'],
        knownEpisodeCount: 1,
        createdAt: 100,
        updatedAt: 200,
      },
    ],
  },
});

describe('packageMigration', () => {
  beforeEach(() => {
    RN.Platform.OS = 'android';
    RN.NativeModules.VegaDataMigration = mockNativeModule;
    mockNativeModule.packageName = 'com.vega';
    mockNativeModule.legacyPackageName = 'com.vega';
    mockValues.clear();
    mockProgress.clear();
    mockHistoryState.items = [];
    mockLibraryState.watchList = [];
    mockLibraryState.collections = [];
    mockContentState.provider = {value: ''};
    mockDialogState.dialog = undefined;
    mockUpdates.isEnabled = false;
    resetMigrationStateForTests();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(RN.ToastAndroid, 'show').mockImplementation(mockToastShow);
    jest.spyOn(RN.DevSettings, 'reload').mockImplementation(mockDevReload);
  });

  describe('producer (com.vega)', () => {
    it('writes, deduplicates across createdAt changes, updates on changes, and clears when empty', async () => {
      expect(isMigrationProducer()).toBe(true);
      expect(isMigrationConsumer()).toBe(false);

      // Default collection alone counts as empty (clears any stale snapshot once)
      mockValues.set('library-collections', [
        {id: 'watchlist', name: 'Watchlist', icon: 'bookmark', createdAt: 0, updatedAt: 0},
      ]);
      expect(await syncMigrationSnapshot()).toBe(false);
      expect(mockWriteMigrationSnapshot).not.toHaveBeenCalled();
      expect(mockClearMigrationSnapshot).toHaveBeenCalledTimes(1);

      // Subsequent empty sync is skipped once already cleared
      expect(await syncMigrationSnapshot()).toBe(false);
      expect(mockClearMigrationSnapshot).toHaveBeenCalledTimes(1);

      // Populating user data writes snapshot
      mockValues.set('hapticFeedback', false);
      expect(await syncMigrationSnapshot()).toBe(true);
      expect(mockWriteMigrationSnapshot).toHaveBeenCalledTimes(1);
      const written = parseBackup(mockWriteMigrationSnapshot.mock.calls[0][0]);
      expect(written.settings).toEqual({hapticFeedback: false});

      // Repeat sync without data changes is deduplicated (ignores createdAt)
      expect(await syncMigrationSnapshot()).toBe(false);
      expect(mockWriteMigrationSnapshot).toHaveBeenCalledTimes(1);

      // Changing data triggers a fresh snapshot write
      mockValues.set('installedProviders', [sampleProvider]);
      expect(await syncMigrationSnapshot()).toBe(true);
      expect(mockWriteMigrationSnapshot).toHaveBeenCalledTimes(2);

      // Clearing all data deletes the stale snapshot
      mockValues.clear();
      expect(await syncMigrationSnapshot()).toBe(false);
      expect(mockClearMigrationSnapshot).toHaveBeenCalledTimes(2);
    });

    it('never prompts for legacy migration on com.vega', async () => {
      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockReadLegacyMigrationSnapshot.mockResolvedValue(sampleSnapshot);
      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockShowAppDialog).not.toHaveBeenCalled();
    });
  });

  describe('consumer (renamed package)', () => {
    beforeEach(() => {
      mockNativeModule.packageName = 'vega.app';
    });

    it('never writes snapshots and asks explicit user confirmation before importing data', async () => {
      expect(isMigrationProducer()).toBe(false);
      expect(isMigrationConsumer()).toBe(true);
      expect(await syncMigrationSnapshot()).toBe(false);
      expect(mockWriteMigrationSnapshot).not.toHaveBeenCalled();

      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockReadLegacyMigrationSnapshot.mockResolvedValue(sampleSnapshot);

      expect(await checkLegacyPackageMigration()).toBe(true);
      expect(mockShowAppDialog).toHaveBeenCalledTimes(1);

      // Strictly obeys AGENTS.md: nothing is restored before user explicitly confirms
      expect(mockValues.get('installedProviders')).toBeUndefined();
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBeUndefined();

      const dialog = mockShowAppDialog.mock.calls[0][0];
      expect(dialog.title).toBe('Import data from Vega?');
      expect(dialog.message).toContain('settings');
      expect(dialog.message).toContain('library');
      expect(dialog.message).toContain('providers');
      expect(dialog.message).toContain('followed shows');
      expect(dialog.actions.map((a: any) => a.label)).toEqual([
        'Start fresh',
        'Import data',
      ]);

      // Confirming restores all sections, marks handled, and reloads the app
      await dialog.actions[1].onPress();
      expect(mockValues.get('hapticFeedback')).toBe(false);
      expect(mockValues.get('installedProviders')).toEqual([sampleProvider]);
      expect(mockValues.get('watchlist')).toHaveLength(1);
      expect(mockValues.get('followed-shows')).toHaveLength(1);
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBe(true);
      expect(mockToastShow).toHaveBeenCalled();
      expect(mockDevReload).toHaveBeenCalledWith('Legacy data migrated');
    });

    it('marks handled without restoring when user chooses Start fresh', async () => {
      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockReadLegacyMigrationSnapshot.mockResolvedValue(sampleSnapshot);

      expect(await checkLegacyPackageMigration()).toBe(true);
      const dialog = mockShowAppDialog.mock.calls[0][0];
      dialog.actions[0].onPress();

      expect(mockValues.get('installedProviders')).toBeUndefined();
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBe(true);

      resetMigrationStateForTests();
      mockShowAppDialog.mockClear();
      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockShowAppDialog).not.toHaveBeenCalled();
    });

    it('skips prompting and marks handled when local app already has user data', async () => {
      mockValues.set('installedProviders', [sampleProvider]);
      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);

      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockShowAppDialog).not.toHaveBeenCalled();
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBe(true);
    });

    it('does not mark handled when no snapshot is available yet or another dialog is open', async () => {
      mockHasLegacyMigrationSnapshot.mockResolvedValue(false);
      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBeUndefined();

      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockDialogState.dialog = {title: 'Other dialog'};
      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockValues.get(LEGACY_MIGRATION_HANDLED_KEY)).toBeUndefined();
      expect(mockShowAppDialog).not.toHaveBeenCalled();
    });

    it('handles corrupted snapshot gracefully in both automatic and manual flows', async () => {
      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockReadLegacyMigrationSnapshot.mockResolvedValue('{not valid json');

      expect(await checkLegacyPackageMigration()).toBe(false);
      expect(mockShowAppDialog).not.toHaveBeenCalled();

      expect(await promptLegacyPackageMigration({manual: true})).toBe(false);
      expect(mockShowAppDialog).toHaveBeenCalledTimes(1);
      expect(mockShowAppDialog.mock.calls[0][0].variant).toBe('error');
    });

    it('uses clearMigrationSnapshot and supports Updates.reloadAsync when enabled', async () => {
      await clearMigrationSnapshot();
      expect(mockClearMigrationSnapshot).toHaveBeenCalledTimes(1);

      mockUpdates.isEnabled = true;
      mockHasLegacyMigrationSnapshot.mockResolvedValue(true);
      mockReadLegacyMigrationSnapshot.mockResolvedValue(sampleSnapshot);
      expect(await checkLegacyPackageMigration()).toBe(true);
      await mockShowAppDialog.mock.calls[0][0].actions[1].onPress();
      expect(mockUpdatesReloadAsync).toHaveBeenCalledTimes(1);
      expect(mockDevReload).not.toHaveBeenCalled();
    });
  });
});
