import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockValues = new Map<string, unknown>();
const mockContentState = {
  provider: {value: ''} as any,
  setProvider: jest.fn((provider: any) => {
    mockContentState.provider = provider;
  }),
  setInstalledProviders: jest.fn(),
};
const mockSetThemeState = jest.fn();
const mockSetLibraryState = jest.fn();
jest.mock('../src/lib/zustand/watchListStore', () => ({
  __esModule: true, default: {setState: (state: unknown) => mockSetLibraryState(state)},
}));

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    hasKey: (key: string) => mockValues.has(key),
    getBool: (key: string, defaultValue = false) =>
      mockValues.has(key) ? mockValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockValues.set(key, value),
    getString: (key: string) => mockValues.get(key),
    setString: (key: string, value: string) => mockValues.set(key, value),
    getNumber: (key: string) => mockValues.get(key),
    setNumber: (key: string, value: number) => mockValues.set(key, value),
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

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: {getState: () => mockContentState},
}));

jest.mock('../src/lib/zustand/themeStore', () => ({
  __esModule: true,
  default: {setState: (state: unknown) => mockSetThemeState(state)},
}));

const mockProgress = new Map<string, {position: number; duration: number}>();
jest.mock('../src/lib/storage/WatchProgressStorage', () => ({
  watchProgressStorage: {
    getProgress: (key: string) => mockProgress.get(key) ?? null,
    getAllProgress: () => Object.fromEntries(mockProgress),
    setAllProgress: (entries: Record<string, {position: number; duration: number}>) =>
      Object.entries(entries).forEach(([key, value]) => mockProgress.set(key, value)),
  },
}));

const mockHistoryState = {items: [] as any[]};
jest.mock('../src/lib/zustand/continueWatchingStore', () => ({
  __esModule: true,
  default: {
    getState: () => mockHistoryState,
    setState: (state: {items: any[]}) => {
      mockHistoryState.items = state.items;
    },
  },
}));

jest.mock('expo-document-picker', () => ({getDocumentAsync: jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {},
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

import {
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  restoreBackup,
} from '../src/lib/backup';

const provider = {
  value: 'vega',
  display_name: 'Vega',
  type: 'global',
  installed: true,
  disabled: false,
  version: '1.0.0',
  icon: '',
  source: {author: 'vega', url: 'https://example.com'},
};

describe('backup', () => {
  beforeEach(() => {
    mockValues.clear();
    mockProgress.clear();
    mockHistoryState.items = [];
    mockContentState.provider = {value: ''};
    jest.clearAllMocks();
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('exports only selected sections for selection %i', mask => {
    const selection = {settings: Boolean(mask & 1), library: Boolean(mask & 2), providers: Boolean(mask & 4)};
    mockValues.set('hapticFeedback', false);
    const backup = parseBackup(JSON.stringify(createBackup(selection)));
    expect(Object.prototype.hasOwnProperty.call(backup, 'settings')).toBe(selection.settings);
    expect(Object.prototype.hasOwnProperty.call(backup, 'library')).toBe(selection.library);
    expect(Object.prototype.hasOwnProperty.call(backup, 'providers')).toBe(selection.providers);

    mockValues.clear();
    mockValues.set('hapticFeedback', true);
    mockValues.set('installedProviders', [provider]);
    mockValues.set('providerSources', [{author: 'mine', url: 'https://example.com/mine'}]);
    mockValues.set('watchlist', ['existing library']);
    mockSetThemeState.mockClear();
    mockSetLibraryState.mockClear();
    mockContentState.setInstalledProviders.mockClear();
    restoreBackup(backup);
    expect(mockValues.get('hapticFeedback')).toBe(!selection.settings);
    expect(mockSetThemeState).toHaveBeenCalledTimes(selection.settings ? 1 : 0);
    expect(mockSetLibraryState).toHaveBeenCalledTimes(selection.library ? 1 : 0);
    expect(mockContentState.setInstalledProviders).toHaveBeenCalledTimes(selection.providers ? 1 : 0);
    if (!selection.providers) {
      expect(mockValues.get('installedProviders')).toEqual([provider]);
      expect(mockValues.get('providerSources')).toEqual([{author: 'mine', url: 'https://example.com/mine'}]);
    }
    if (!selection.library) expect(mockValues.get('watchlist')).toEqual(['existing library']);
  });

  it('rejects an empty selection and malformed optional sections', () => {
    expect(() => createBackup({settings: false, library: false, providers: false})).toThrow('Select at least one');
    const header = {app: 'vega', version: BACKUP_VERSION, createdAt: ''};
    for (const sections of [{}, {settings: null}, {providers: {}}, {settings: {}, providers: null}]) {
      expect(() => parseBackup(JSON.stringify({...header, ...sections}))).toThrow('incomplete');
    }
  });

  it('still accepts version 1 full backups', () => {
    const backup = createBackup();
    backup.version = 1;
    expect(parseBackup(JSON.stringify(backup)).version).toBe(1);
  });

  it('includes only saved settings and skips device specific ones', () => {
    mockValues.set('hapticFeedback', false);
    mockValues.set('useExternalPlayer', true);
    mockValues.set('subtitleFontSize', 20);
    mockValues.set('seekInterval', 30);
    mockValues.set('playbackSpeed', 1.5);
    mockValues.set('excludedQualities', ['480p']);
    mockValues.set('autoPlayNextEpisode', true);
    mockValues.set('forwardBufferMB', 128);
    mockValues.set('backBufferMB', 32);
    mockValues.set('downloadConnections', 8);
    mockValues.set('parallelStreaming', true);
    mockValues.set('subtitleTextOpacity', 0.8);
    mockValues.set('alwaysCastMode', true);
    mockValues.set('askLocalFileFirst', true);
    mockValues.set('downloadLocation', 'content://tree/primary');
    mockValues.set('launcherIcon', 'dark');

    const backup = createBackup();

    expect(backup.app).toBe('vega');
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.settings).toEqual({
      hapticFeedback: false,
      useExternalPlayer: true,
      subtitleFontSize: 20,
      seekInterval: 30,
      playbackSpeed: 1.5,
      excludedQualities: ['480p'],
      autoPlayNextEpisode: true,
      downloadConnections: 8,
      parallelStreaming: true,
      subtitleTextOpacity: 0.8,
      alwaysCastMode: true,
      askLocalFileFirst: true,
    });
  });

  it('round trips player appearance, arrangement, ambient and download preferences', () => {
    const saved = {
      playerControlStyle: JSON.stringify({backgroundOpacity: 0.3,
        titleBackground: true, scale: 1.2, seekbarScale: 1.5}),
      playerControlLayout: JSON.stringify({top: ['settings'], bottom: ['audio', 'subtitle']}),
      hiddenPlayerControls: ['speed', 'pip'],
      ambientVideo: true,
      ambientIntensity: 0.45,
      ambientSpread: 1.25,
      ambientResponseMs: 120,
      enableVolumeBoost: false,
      autoDownloadServerFallback: false,
    };
    Object.entries(saved).forEach(([key, value]) => mockValues.set(key, value));
    const backup = parseBackup(JSON.stringify(createBackup()));
    expect(backup.settings).toEqual(saved);
    mockValues.clear();
    restoreBackup(backup);
    Object.entries(saved).forEach(([key, value]) => expect(mockValues.get(key)).toEqual(value));
  });

  it('restores settings, providers and the selected provider', () => {
    mockValues.set('hapticFeedback', false);
    mockValues.set('installedProviders', [provider]);
    mockValues.set('providerSources', [
      {author: 'vega', url: 'https://example.com'},
    ]);
    mockValues.set('providerModules', [
      {value: 'vega', version: '1.0.0', modules: {posts: 'code'}, cachedAt: 1},
    ]);
    mockValues.set('disabledProviders', ['other']);
    mockContentState.provider = provider;

    const backup = parseBackup(JSON.stringify(createBackup()));
    mockValues.clear();
    mockContentState.provider = {value: ''};

    restoreBackup(backup);

    expect(mockValues.get('hapticFeedback')).toBe(false);
    expect(mockValues.get('installedProviders')).toEqual([provider]);
    expect(mockValues.get('providerSources')).toHaveLength(1);
    expect(mockValues.get('providerModules')).toHaveLength(1);
    expect(mockValues.get('disabledProviders')).toEqual(['other']);
    expect(mockContentState.setInstalledProviders).toHaveBeenCalledWith([
      provider,
    ]);
    expect(mockContentState.provider).toEqual(provider);
    expect(mockSetThemeState.mock.invocationCallOrder[0]).toBeLessThan(
      mockContentState.setProvider.mock.invocationCallOrder[0],
    );
  });

  it('ignores settings with the wrong type and unknown keys', () => {
    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      settings: {
        hapticFeedback: 'yes',
        subtitleFontSize: 18,
        playbackSpeed: 1.25,
        downloadLocation: 'content://tree/primary',
        somethingElse: true,
      },
      providers: {installed: [], sources: [], modules: []},
    });

    expect(mockValues.has('hapticFeedback')).toBe(false);
    expect(mockValues.get('subtitleFontSize')).toBe(18);
    expect(mockValues.get('playbackSpeed')).toBe(1.25);
    expect(mockValues.has('downloadLocation')).toBe(false);
    expect(mockValues.has('somethingElse')).toBe(false);
  });

  it('skips providers missing fields the UI needs', () => {
    const withoutType = {...provider, type: undefined};

    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      settings: {},
      providers: {
        installed: [provider, withoutType as any],
        sources: [],
        modules: [],
      },
    });

    expect(mockValues.get('installedProviders')).toEqual([provider]);
  });

  it('round trips titles, categories and assignments and updates the live library', () => {
    const library = {
      items: [{title: 'Saved show', poster: 'poster', link: 'episode', provider: 'vega', collections: ['custom']}],
      collections: [{id: 'custom', name: 'Favorites', icon: 'star', color: '#123456', createdAt: 1, updatedAt: 2}],
    };
    mockValues.set('watchlist', library.items);
    mockValues.set('library-collections', library.collections);
    mockValues.set('library-default-collection-added', true);
    const backup = parseBackup(JSON.stringify(createBackup()));
    expect(backup.library).toEqual(library);
    mockValues.clear();
    restoreBackup(backup);
    expect(mockValues.get('watchlist')).toEqual(library.items);
    expect(mockValues.get('library-collections')).toEqual(library.collections);
    expect(mockValues.get('library-default-collection-added')).toBe(true);
    expect(mockSetLibraryState).toHaveBeenCalledWith({watchList: library.items, collections: library.collections});
  });

  it('leaves the library alone when restoring an older backup', () => {
    const backup = createBackup();
    delete backup.library;
    mockValues.set('watchlist', ['existing']);
    restoreBackup(backup);
    expect(mockValues.get('watchlist')).toEqual(['existing']);
    expect(mockSetLibraryState).not.toHaveBeenCalled();
  });

  it('restores an empty library without recreating the default category', () => {
    const backup = createBackup();
    backup.library = {items: [], collections: []};
    restoreBackup(backup);
    expect(mockValues.get('library-collections')).toEqual([]);
    expect(mockValues.get('library-default-collection-added')).toBe(true);
  });

  it('rejects malformed library before changing settings', () => {
    const backup = createBackup();
    backup.library = {items: [null], collections: []} as any;
    backup.settings.hapticFeedback = true;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('invalid library');
    expect(() => restoreBackup(backup)).toThrow('invalid library');
    expect(mockValues.has('hapticFeedback')).toBe(false);
  });

  it('rejects files that are not a Vega backup', () => {
    expect(() => parseBackup('not json')).toThrow('not a Vega backup');
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow(
      'not a Vega backup',
    );
    expect(() =>
      parseBackup(JSON.stringify({app: 'vega', version: BACKUP_VERSION + 1})),
    ).toThrow('newer version');
    expect(() =>
      parseBackup(JSON.stringify({app: 'vega', version: BACKUP_VERSION})),
    ).toThrow('incomplete');
  });

  const historyItem = (id: string, updatedAt: number) => ({
    id,
    title: `Show ${id}`,
    episode: {title: 'Episode 1', link: `https://example.com/${id}/1`},
    type: 'series',
    providerValue: 'demo',
    infoUrl: `https://example.com/${id}`,
    position: 120,
    duration: 1200,
    updatedAt,
  });
  const only = (section: 'history' | 'progress') => ({
    settings: false,
    library: false,
    providers: false,
    history: section === 'history',
    progress: section === 'progress',
  });

  it('exports watch history and progress only when selected', () => {
    mockHistoryState.items = [historyItem('a', 10)];
    mockProgress.set('https://example.com/a/1', {position: 120, duration: 1200});
    const full = parseBackup(JSON.stringify(createBackup()));
    expect(full.history).toEqual([historyItem('a', 10)]);
    expect(full.progress).toEqual({
      'https://example.com/a/1': {position: 120, duration: 1200},
    });
    const historyOnly = createBackup(only('history'));
    expect(historyOnly.history).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(historyOnly, 'progress')).toBe(false);
    const progressOnly = createBackup(only('progress'));
    expect(Object.prototype.hasOwnProperty.call(progressOnly, 'history')).toBe(false);
  });

  it('merges history by id and keeps the newer entry', () => {
    mockHistoryState.items = [historyItem('a', 50), historyItem('b', 5)];
    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      history: [historyItem('a', 10), historyItem('b', 90), historyItem('c', 30)],
    });
    expect(mockHistoryState.items.map(item => [item.id, item.updatedAt])).toEqual([
      ['b', 90],
      ['a', 50],
      ['c', 30],
    ]);
  });

  it('only overwrites progress that is missing or less watched', () => {
    mockProgress.set('kept', {position: 900, duration: 1000});
    mockProgress.set('raised', {position: 100, duration: 1000});
    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      progress: {
        kept: {position: 100, duration: 1000},
        raised: {position: 1, duration: 1},
        added: {position: 50, duration: 100},
      },
    });
    expect(mockProgress.get('kept')).toEqual({position: 900, duration: 1000});
    expect(mockProgress.get('raised')).toEqual({position: 1, duration: 1});
    expect(mockProgress.get('added')).toEqual({position: 50, duration: 100});
  });

  it('rejects invalid history or progress without restoring anything', () => {
    const header = {app: 'vega', version: BACKUP_VERSION, createdAt: ''};
    expect(() =>
      parseBackup(JSON.stringify({...header, history: [{id: 'a'}]})),
    ).toThrow('invalid watch history');
    expect(() =>
      parseBackup(JSON.stringify({...header, progress: {a: {position: 'x', duration: 1}}})),
    ).toThrow('invalid watch progress');
    expect(() =>
      restoreBackup({
        ...header,
        history: [historyItem('a', 1)],
        progress: {a: {position: NaN, duration: 1}},
      } as any),
    ).toThrow('invalid watch progress');
    expect(mockHistoryState.items).toEqual([]);
    expect(mockProgress.size).toBe(0);
  });

  it('keeps version 2 and ignores unknown sections so apps stay compatible', () => {
    expect(BACKUP_VERSION).toBe(2);
    const parsed = parseBackup(
      JSON.stringify({
        app: 'vega',
        version: 2,
        createdAt: '',
        settings: {hapticFeedback: true},
        futureSection: {anything: 1},
      }),
    );
    expect(() => restoreBackup(parsed)).not.toThrow();
    expect(mockValues.get('hapticFeedback')).toBe(true);
  });

  it('still imports version 2 backups without history or progress', () => {
    mockValues.set('hapticFeedback', true);
    const v2 = {...createBackup(only('history')), version: 2, history: undefined};
    delete (v2 as any).history;
    const parsed = parseBackup(JSON.stringify({...v2, settings: {hapticFeedback: true}}));
    expect(parsed.version).toBe(2);
    expect(() => restoreBackup(parsed)).not.toThrow();
    expect(mockHistoryState.items).toEqual([]);
  });
});
