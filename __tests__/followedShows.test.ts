import {DeviceEventEmitter} from 'react-native';

jest.mock('../src/lib/storage/StorageService', () => {
  const store = new Map<string, unknown>();
  return {
    createZustandStorage: () => ({getItem: () => null, setItem: jest.fn(), removeItem: jest.fn()}),
    mainStorage: {
      __clear: () => store.clear(),
      getArray: jest.fn((key: string) => store.get(key)),
      setArray: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
      getString: jest.fn((key: string) => store.get(key)),
      getObject: jest.fn((key: string) => store.get(key)),
      setObject: jest.fn((key: string, value: unknown) => {store.set(key, value);}),
      setString: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
      getBool: jest.fn((key: string, fallback = false) =>
        store.has(key) ? Boolean(store.get(key)) : fallback,
      ),
      setBool: jest.fn((key: string, value: boolean) => {
        store.set(key, value);
      }),
      getNumber: jest.fn((key: string) => store.get(key)),
      setNumber: jest.fn((key: string, value: number) => {
        store.set(key, value);
      }),
    },
  };
});

jest.mock('../src/lib/zustand/localContentStore', () => ({
  __esModule: true,
  default: {getState: () => ({titles: []})},
}));

const mockGetProviderModules = jest.fn();
jest.mock('../src/lib/services/ExtensionManager', () => ({
  extensionManager: {
    getProviderModules: (...args: unknown[]) => mockGetProviderModules(...args),
  },
}));

const mockGetEpisodes = jest.fn();
const mockGetMetaData = jest.fn();
jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {
    getEpisodes: (...args: unknown[]) => mockGetEpisodes(...args),
    getMetaData: (...args: unknown[]) => mockGetMetaData(...args),
  },
}));

const mockDisplayEpisodeNotification = jest.fn(async () => 'notif-id');
jest.mock('../src/lib/services/Notification', () => ({
  __esModule: true,
  default: {
    displayEpisodeNotification: (...args: unknown[]) =>
      mockDisplayEpisodeNotification(...args),
  },
}));

const mockSyncDohSettings = jest.fn(async () => {});
jest.mock('../src/lib/services/dohService', () => ({
  syncDohSettings: () => mockSyncDohSettings(),
}));

jest.mock('../src/lib/sandbox/sandboxBridge', () => ({
  sandboxBridge: {
    isRegistered: jest.fn(() => true),
    register: jest.fn(),
    unregister: jest.fn(),
    handleSandboxMessage: jest.fn(),
  },
}));

jest.mock('../src/lib/sandbox/generated/sandboxRuntime.generated', () => ({
  SANDBOX_RUNTIME: '/* test runtime */',
}));

jest.mock('../src/lib/services/episodeCheckNative', () => ({
  BACKGROUND_SANDBOX_MESSAGE_EVENT: 'VegaBackgroundSandboxMessage',
  episodeCheckNative: {
    isAvailable: jest.fn(() => true),
    schedule: jest.fn(async () => true),
    scheduleAt: jest.fn(async () => true),
    cancel: jest.fn(async () => true),
    startBackgroundSandbox: jest.fn(async () => true),
    injectBackgroundSandbox: jest.fn(),
    stopBackgroundSandbox: jest.fn(async () => true),
  },
}));

import {sandboxBridge} from '../src/lib/sandbox/sandboxBridge';
import {episodeCheckNative} from '../src/lib/services/episodeCheckNative';
import {getNextEpisodeCheckAt} from '../src/lib/episodeCheckSchedule';
import useFollowedShowsStore from '../src/lib/zustand/followedShowsStore';
import useWatchListStore from '../src/lib/zustand/watchListStore';
import useContinueWatchingStore from '../src/lib/zustand/continueWatchingStore';
import {
  buildEpisodeSnapshot,
  checkFollowedShowsIfDue,
  checkFollowedShows,
  diffNewEpisodes,
  runHeadlessEpisodeCheck,
  syncEpisodeCheckSchedule,
} from '../src/lib/services/episodeCheckService';

const mockSandboxBridge = sandboxBridge as jest.Mocked<typeof sandboxBridge>;
const mockEpisodeCheckNative = episodeCheckNative as jest.Mocked<
  typeof episodeCheckNative
>;

beforeEach(() => {
  (require('../src/lib/storage/StorageService').mainStorage as any).__clear();
  jest.clearAllMocks();
  mockSandboxBridge.isRegistered.mockReturnValue(true);
  mockEpisodeCheckNative.isAvailable.mockReturnValue(true);
  useFollowedShowsStore.getState().reloadFromStorage();
  useFollowedShowsStore.getState().setChecking(false);
  useWatchListStore.setState({watchList: [], collections: []});
  useContinueWatchingStore.setState({items: []});
});

describe('custom background schedules', () => {
  const fridayAtNine = {days: [5], hour: 9, minute: 0};
  const show = {
    link: 'https://p.test/custom-show',
    provider: 'provA',
    providerName: 'Provider A',
    title: 'Custom Show',
    poster: '',
    seasonTitle: 'Season 1',
    seasonIndex: 0,
    episodesLink: 'https://p.test/custom-show/s1',
    ...buildEpisodeSnapshot([{title: 'Episode 1', link: 'https://p.test/custom-show/e1'}]),
  };

  afterEach(() => jest.restoreAllMocks());

  it('skips unselected days and a selected time that has already passed', () => {
    const fridayMorning = new Date(2026, 10, 27, 9, 0).getTime();
    expect(getNextEpisodeCheckAt(fridayAtNine, new Date(2026, 10, 24, 12, 0).getTime())).toBe(fridayMorning);
    expect(getNextEpisodeCheckAt(fridayAtNine, fridayMorning)).toBe(new Date(2026, 11, 4, 9, 0).getTime());
  });

  it('keeps the saved slot, skips early checks, and schedules the next weekday after a background run', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 24, 12, 0).getTime());
    const store = useFollowedShowsStore.getState();
    store.followShow(show);
    store.setWifiOnly(true);
    store.setCustomSchedule(fridayAtNine);
    store.reloadFromStorage();
    const firstSlot = new Date(2026, 10, 27, 9, 0).getTime();
    await syncEpisodeCheckSchedule();
    expect(mockEpisodeCheckNative.scheduleAt).toHaveBeenLastCalledWith(firstSlot, true);

    await checkFollowedShowsIfDue();
    await runHeadlessEpisodeCheck();
    expect(mockGetEpisodes).not.toHaveBeenCalled();

    mockGetProviderModules.mockReturnValue({modules: {episodes: 'code'}});
    mockGetEpisodes.mockResolvedValue([{title: 'Episode 1', link: 'https://p.test/custom-show/e1'}]);
    await checkFollowedShows({trigger: 'manual'});
    expect(useFollowedShowsStore.getState().lastBackgroundCheckAt).toBeUndefined();
    expect(useFollowedShowsStore.getState().customSchedule?.nextAt).toBe(firstSlot);

    clock.mockReturnValue(firstSlot + 60_000);
    await runHeadlessEpisodeCheck();
    const nextSlot = new Date(2026, 11, 4, 9, 0).getTime();
    expect(mockGetEpisodes).toHaveBeenCalledTimes(2);
    expect(mockEpisodeCheckNative.scheduleAt).toHaveBeenLastCalledWith(nextSlot, true);
    store.reloadFromStorage();
    expect(useFollowedShowsStore.getState().lastBackgroundCheckAt).toBe(firstSlot + 60_000);
    expect(useFollowedShowsStore.getState().customSchedule?.nextAt).toBe(nextSlot);
  });
});

describe('auto-unfollow', () => {
  const show = {
    link: 'https://p.test/show',
    provider: 'provA',
    providerName: 'Provider A',
    title: 'Show',
    poster: '',
    seasonTitle: 'Season 1',
    seasonIndex: 0,
    ...buildEpisodeSnapshot([{title: 'Episode 1', link: 'https://p.test/ep1'}]),
  };
  const watching = {
    id: 'history-entry',
    title: show.title,
    type: 'series',
    episode: {title: 'Episode 1', link: 'https://p.test/ep1'},
    infoUrl: show.link,
    providerValue: show.provider,
    position: 60,
    duration: 1200,
    updatedAt: 1,
  };

  it('keeps following after either removal by default', () => {
    const followed = useFollowedShowsStore.getState().followShow(show);
    useWatchListStore.getState().addItem(show);
    useContinueWatchingStore.getState().upsertItem(watching);

    useWatchListStore.getState().removeItem(show.link);
    useContinueWatchingStore.getState().removeItem(watching.id);

    expect(useFollowedShowsStore.getState().shows).toEqual([followed]);
  });

  it('unfollows only when the title leaves its last Library collection', () => {
    const store = useFollowedShowsStore.getState();
    store.setUnfollowOnLibraryRemoval(true);
    store.reloadFromStorage();
    const followed = store.followShow(show);
    const library = useWatchListStore.getState();
    const a = library.createCollection({name: 'A', icon: 'star'});
    const b = library.createCollection({name: 'B', icon: 'star'});
    library.setItemCollections(show, [a.id, b.id]);

    library.removeFromCollection([show.link], a.id);
    expect(useFollowedShowsStore.getState().shows).toEqual([followed]);

    library.removeFromCollection([show.link], b.id);
    expect(useFollowedShowsStore.getState().shows).toEqual([]);
    expect(mockEpisodeCheckNative.cancel).toHaveBeenCalledTimes(1);
  });

  it('unfollows only the matching provider when removed from Continue Watching', () => {
    const store = useFollowedShowsStore.getState();
    store.setUnfollowOnContinueWatchingRemoval(true);
    store.reloadFromStorage();
    store.followShow(show);
    const other = store.followShow({...show, provider: 'provB'});
    const history = useContinueWatchingStore.getState();
    history.upsertItem(watching);

    const library = useWatchListStore.getState();
    library.addItem(show);
    library.removeItem(show.link);
    expect(useFollowedShowsStore.getState().shows).toHaveLength(2);

    history.removeItem(watching.id);
    expect(useFollowedShowsStore.getState().shows).toEqual([other]);
    expect(mockEpisodeCheckNative.cancel).not.toHaveBeenCalled();
  });

  it('skips an episode alert when the show is removed during a check', async () => {
    const store = useFollowedShowsStore.getState();
    store.setUnfollowOnLibraryRemoval(true);
    store.followShow({...show, episodesLink: `${show.link}/season-1`});
    const library = useWatchListStore.getState();
    library.addItem(show);

    const episodes = [{title: 'Episode 2', link: 'https://p.test/ep2'}];
    let finishFetch!: (result: typeof episodes) => void;
    mockGetProviderModules.mockReturnValue({modules: {episodes: 'code'}});
    mockGetEpisodes.mockImplementationOnce(() => new Promise(resolve => {
      finishFetch = resolve;
    }));

    const checking = checkFollowedShows({trigger: 'manual'});
    library.setItemCollections(show, []);
    finishFetch(episodes);
    await checking;

    expect(useFollowedShowsStore.getState().shows).toEqual([]);
    expect(mockDisplayEpisodeNotification).not.toHaveBeenCalled();
  });
});

describe('episode diffing', () => {
  it('finds the same new episodes after the provider reverses its listing', () => {
    const first = {id: 'e1', title: 'Episode 1', link: 'https://p.test/e1'};
    const second = {id: 'e2', title: 'Episode 2', link: 'https://p.test/e2'};
    const third = {id: 'e3', title: 'Episode 3', link: 'https://p.test/e3'};
    const fourth = {id: 'e4', title: 'Episode 4', link: 'https://p.test/e4'};
    const {knownEpisodeKeys, knownEpisodeTitles} = buildEpisodeSnapshot([first, second]);

    expect(diffNewEpisodes([second, first], knownEpisodeKeys, knownEpisodeTitles)).toEqual([]);
    expect(diffNewEpisodes([fourth, third, second, first, third], knownEpisodeKeys, knownEpisodeTitles)).toEqual([fourth, third]);
  });

  it('rebuilds a truncated legacy snapshot and tracks long seasons in either order', () => {
    const episodes = Array.from({length: 501}, (_, index) => ({
      id: `e${index + 1}`,
      title: `Episode ${index + 1}`,
    }));
    const newest = {id: 'e502', title: 'Episode 502'};
    const snapshot = buildEpisodeSnapshot(episodes);
    expect(snapshot.knownEpisodeCount).toBe(501);
    expect(diffNewEpisodes(
      [...episodes].reverse(),
      snapshot.knownEpisodeKeys.slice(-500),
      snapshot.knownEpisodeTitles.slice(-500),
      snapshot.knownEpisodeCount,
    )).toEqual([]);
    expect(diffNewEpisodes(
      [newest, ...[...episodes].reverse()],
      snapshot.knownEpisodeKeys,
      snapshot.knownEpisodeTitles,
      snapshot.knownEpisodeCount,
    )).toEqual([newest]);
  });

  it('ignores initial empty baseline and detects genuinely new episodes', () => {
    const initial = [
      {title: 'Episode 1', link: 'https://p.test/ep1'},
      {title: 'Episode 2', link: 'https://p.test/ep2'},
    ];
    expect(diffNewEpisodes(initial, [], [])).toEqual([]);

    const snapshot = buildEpisodeSnapshot(initial);
    const withNew = [
      ...initial,
      {title: 'Episode 3', link: 'https://p.test/ep3'},
    ];
    expect(
      diffNewEpisodes(
        withNew,
        snapshot.knownEpisodeKeys,
        snapshot.knownEpisodeTitles,
      ),
    ).toEqual([{title: 'Episode 3', link: 'https://p.test/ep3'}]);
  });

  it('avoids false positives when provider rotates episode URLs but keeps titles', () => {
    const snapshot = buildEpisodeSnapshot([
      {title: 'Episode 1', link: 'https://old-domain.test/ep1'},
      {title: 'Episode 2', link: 'https://old-domain.test/ep2'},
    ]);

    const rotated = [
      {title: 'Episode 1', link: 'https://new-domain.test/ep1'},
      {title: 'Episode 2', link: 'https://new-domain.test/ep2'},
      {title: 'Episode 3', link: 'https://new-domain.test/ep3'},
    ];

    expect(
      diffNewEpisodes(
        rotated,
        snapshot.knownEpisodeKeys,
        snapshot.knownEpisodeTitles,
      ),
    ).toEqual([{title: 'Episode 3', link: 'https://new-domain.test/ep3'}]);
  });
});

describe('followed shows checks and background runner', () => {
  it('checks episodesLink and directLinks seasons and notifies on new episodes', async () => {
    const store = useFollowedShowsStore.getState();
    store.followShow({
      link: 'https://p.test/show-a',
      provider: 'provA',
      providerName: 'Provider A',
      title: 'Show A',
      poster: 'https://p.test/a.jpg',
      seasonTitle: 'Season 1',
      seasonIndex: 0,
      episodesLink: 'https://p.test/show-a/s1',
      ...buildEpisodeSnapshot([
        {title: 'Episode 1', link: 'https://p.test/a/e1'},
      ]),
    });
    store.followShow({
      link: 'https://p.test/show-b',
      provider: 'provB',
      providerName: 'Provider B',
      title: 'Show B',
      poster: 'https://p.test/b.jpg',
      seasonTitle: 'Season 2',
      seasonIndex: 1,
      ...buildEpisodeSnapshot([
        {title: 'Episode 1', link: 'https://p.test/b/e1'},
      ]),
    });

    mockGetProviderModules.mockImplementation((provider: string) =>
      provider === 'provA'
        ? {modules: {episodes: 'code', meta: 'code'}}
        : {modules: {meta: 'code'}},
    );
    mockGetEpisodes.mockResolvedValue([
      {title: 'Episode 1', link: 'https://p.test/a/e1'},
      {title: 'Episode 2', link: 'https://p.test/a/e2'},
    ]);
    mockGetMetaData.mockResolvedValue({
      title: 'Show B',
      linkList: [
        {title: 'Season 1', directLinks: []},
        {
          title: 'Season 2',
          directLinks: [
            {title: 'Episode 1', link: 'https://p.test/b/e1'},
            {title: 'Episode 2', link: 'https://p.test/b/e2'},
          ],
        },
      ],
    });

    const summary = await checkFollowedShows({trigger: 'manual'});

    expect(summary).toEqual({
      checkedCount: 2,
      updatedShows: 2,
      newEpisodeCount: 2,
      errors: 0,
    });
    expect(mockDisplayEpisodeNotification).toHaveBeenCalledTimes(2);
    expect(
      useFollowedShowsStore.getState().shows.every(s => s.knownEpisodeCount === 2),
    ).toBe(true);
  });

  it('records error when provider is uninstalled and continues checking', async () => {
    useFollowedShowsStore.getState().followShow({
      link: 'https://p.test/missing',
      provider: 'removedProv',
      providerName: 'Removed Provider',
      title: 'Missing Show',
      poster: '',
      seasonTitle: 'Season 1',
      seasonIndex: 0,
      episodesLink: 'https://p.test/missing/s1',
      knownEpisodeKeys: ['https://p.test/m/e1'],
      knownEpisodeTitles: ['episode 1'],
      knownEpisodeCount: 1,
    });
    mockGetProviderModules.mockReturnValue(undefined);

    const summary = await checkFollowedShows({trigger: 'manual'});

    expect(summary.errors).toBe(1);
    expect(useFollowedShowsStore.getState().shows[0].lastError).toContain(
      'not installed',
    );
  });

  it('boots and tears down native offscreen sandbox during headless background check', async () => {
    const store = useFollowedShowsStore.getState();
    store.setUpdateInterval('24h');
    store.setWifiOnly(true);
    store.followShow({
      link: 'https://p.test/show-bg',
      provider: 'provBg',
      providerName: 'Provider BG',
      title: 'BG Show',
      poster: '',
      seasonTitle: 'Season 1',
      seasonIndex: 0,
      episodesLink: 'https://p.test/bg/s1',
      ...buildEpisodeSnapshot([
        {title: 'Episode 1', link: 'https://p.test/bg/e1'},
      ]),
    });

    await syncEpisodeCheckSchedule();
    expect(mockEpisodeCheckNative.schedule).toHaveBeenCalledWith(24, true);

    mockSandboxBridge.isRegistered.mockReturnValue(false);
    mockGetProviderModules.mockReturnValue({modules: {episodes: 'code'}});
    mockGetEpisodes.mockResolvedValue([
      {title: 'Episode 1', link: 'https://p.test/bg/e1'},
    ]);

    const addListenerSpy = jest.spyOn(DeviceEventEmitter, 'addListener');
    await runHeadlessEpisodeCheck();

    expect(mockEpisodeCheckNative.startBackgroundSandbox).toHaveBeenCalledTimes(
      1,
    );
    expect(mockSandboxBridge.register).toHaveBeenCalledTimes(1);
    expect(mockSyncDohSettings).toHaveBeenCalledTimes(1);
    expect(mockSandboxBridge.unregister).toHaveBeenCalledTimes(1);
    expect(mockEpisodeCheckNative.stopBackgroundSandbox).toHaveBeenCalledTimes(
      1,
    );
    addListenerSpy.mockRestore();
  });

  it('cancels background work when automatic updates are turned off', async () => {
    useFollowedShowsStore.getState().setUpdateInterval('off');
    await syncEpisodeCheckSchedule();
    expect(mockEpisodeCheckNative.cancel).toHaveBeenCalledTimes(1);

    mockSandboxBridge.isRegistered.mockReturnValue(false);
    await runHeadlessEpisodeCheck();
    expect(
      mockEpisodeCheckNative.startBackgroundSandbox,
    ).not.toHaveBeenCalled();
  });
});
