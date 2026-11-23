const mockBooleanValues = new Map<string, boolean>();
const mockNumberValues = new Map<string, number>();
const mockStringValues = new Map<string, string>();
const mockArrayValues = new Map<string, string[]>();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getBool: (key: string, defaultValue = false) =>
      mockBooleanValues.has(key) ? mockBooleanValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockBooleanValues.set(key, value),
    getString: (key: string) => mockStringValues.get(key),
    setString: (key: string, value: string) => mockStringValues.set(key, value),
    getNumber: (key: string) => mockNumberValues.get(key),
    setNumber: (key: string, value: number) => mockNumberValues.set(key, value),
    getArray: (key: string) => mockArrayValues.get(key),
    setArray: (key: string, value: string[]) => mockArrayValues.set(key, value),
    delete: jest.fn(),
  },
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

import {
  SettingsKeys,
  settingsStorage,
} from '../src/lib/storage/SettingsStorage';

describe('settings defaults', () => {
  beforeEach(() => {
    mockBooleanValues.clear();
    mockNumberValues.clear();
    mockStringValues.clear();
    mockArrayValues.clear();
  });

  it('enables default-on preferences when no value is stored', () => {
    expect(settingsStorage.isHapticFeedbackEnabled()).toBe(true);
    expect(settingsStorage.isNotificationsEnabled()).toBe(true);
    expect(settingsStorage.isAutoCheckUpdateEnabled()).toBe(true);
    expect(settingsStorage.isProviderAutoUpdateEnabled()).toBe(true);
    expect(settingsStorage.showMediaControls()).toBe(true);
    expect(settingsStorage.showHamburgerMenu()).toBe(true);
    expect(settingsStorage.isSwipeGestureEnabled()).toBe(true);
    expect(settingsStorage.isTelemetryOptIn()).toBe(true);
    expect(settingsStorage.isDohEnabled()).toBe(true);
    expect(settingsStorage.showTabBarLabels()).toBe(true);
    expect(settingsStorage.hideGlassTabBarInSubpages()).toBe(true);
    expect(settingsStorage.showPlayerEpisodeSidebar()).toBe(true);
    expect(settingsStorage.isAutoPlayNextEpisodeEnabled()).toBe(true);
  });

  it('keeps intentional default-off preferences disabled', () => {
    expect(settingsStorage.hideDownloadsTab()).toBe(false);
    expect(settingsStorage.isAutoDownloadEnabled()).toBe(true); // Auto update defaults to on.
    expect(settingsStorage.hideSeekButtons()).toBe(false);
    expect(settingsStorage.isEnable2xGestureEnabled()).toBe(false);
    expect(settingsStorage.isSkipInAppWebview()).toBe(false);
  });

  it('persists provider auto-updates independently from app update preferences', () => {
    settingsStorage.setProviderAutoUpdateEnabled(false);
    expect(settingsStorage.isProviderAutoUpdateEnabled()).toBe(false);
    expect(mockBooleanValues.get(SettingsKeys.AUTO_UPDATE_PROVIDERS)).toBe(false);
    expect(settingsStorage.isAutoCheckUpdateEnabled()).toBe(true);
    settingsStorage.setProviderAutoUpdateEnabled(true);
    expect(settingsStorage.isProviderAutoUpdateEnabled()).toBe(true);
  });

  it('keeps "ask for local file first" strictly opt-in', () => {
    expect(settingsStorage.isAskLocalFileFirst()).toBe(false);

    settingsStorage.setAskLocalFileFirst(true);
    expect(settingsStorage.isAskLocalFileFirst()).toBe(true);
    expect(mockBooleanValues.get(SettingsKeys.ASK_LOCAL_FILE_FIRST)).toBe(true);

    settingsStorage.setAskLocalFileFirst(false);
    expect(settingsStorage.isAskLocalFileFirst()).toBe(false);
  });

  it('defaults download concurrency to two and clamps saved values', () => {
    expect(settingsStorage.getDownloadConcurrency()).toBe(2);

    settingsStorage.setDownloadConcurrency(8);
    expect(settingsStorage.getDownloadConcurrency()).toBe(5);

    settingsStorage.setDownloadConcurrency(0);
    expect(settingsStorage.getDownloadConcurrency()).toBe(1);
  });

  it('defaults the seek interval to ten seconds', () => {
    expect(settingsStorage.getSeekInterval()).toBe(10);
  });

  it('saves every allowed seek interval', () => {
    for (let seconds = 5; seconds <= 90; seconds += 5) {
      settingsStorage.setSeekInterval(seconds);
      expect(settingsStorage.getSeekInterval()).toBe(seconds);
      expect(mockNumberValues.get(SettingsKeys.SEEK_INTERVAL)).toBe(seconds);
    }
  });

  it('ignores seek intervals outside the allowed list', () => {
    settingsStorage.setSeekInterval(30);
    settingsStorage.setSeekInterval(7);
    expect(settingsStorage.getSeekInterval()).toBe(30);

    for (const stored of [0, -10, 7, 10.5, 120, NaN]) {
      mockNumberValues.set(SettingsKeys.SEEK_INTERVAL, stored);
      expect(settingsStorage.getSeekInterval()).toBe(10);
    }
  });

  it('defaults the video fit to Fit and saves the picked mode', () => {
    expect(settingsStorage.getDefaultResizeMode()).toBe('none');
    for (const mode of ['cover', 'stretch', 'contain', 'none'] as const) {
      settingsStorage.setDefaultResizeMode(mode);
      expect(settingsStorage.getDefaultResizeMode()).toBe(mode);
      expect(mockStringValues.get(SettingsKeys.DEFAULT_RESIZE_MODE)).toBe(mode);
    }
  });

  it('falls back to Fit for an unknown saved video fit', () => {
    mockStringValues.set(SettingsKeys.DEFAULT_RESIZE_MODE, 'zoom');
    expect(settingsStorage.getDefaultResizeMode()).toBe('none');
  });

  it('defaults playback speed to 1x when nothing is saved', () => {
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
  });

  it('reuses the existing sleep and episode visibility keys while persisting other hidden controls', () => {
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['rotate']);
    settingsStorage.setHiddenPlayerControls(['speed', 'sleep', 'episodes', 'rotate']);
    expect(settingsStorage.showSleepTimer()).toBe(false);
    expect(settingsStorage.showPlayerEpisodeSidebar()).toBe(false);
    expect(mockArrayValues.get(SettingsKeys.HIDDEN_PLAYER_CONTROLS)).toEqual(['speed']);
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['speed', 'sleep', 'episodes', 'rotate']);
    settingsStorage.setShowSleepTimer(true);
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['speed', 'episodes', 'rotate']);
    settingsStorage.setHiddenPlayerControls(['audio', 'rotate']);
    expect(settingsStorage.showPlayerEpisodeSidebar()).toBe(true);
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['audio', 'rotate']);
  });

  it('keeps Rotate hidden for older layouts and persists the explicit visibility and auto-rotate settings', () => {
    mockArrayValues.set(SettingsKeys.HIDDEN_PLAYER_CONTROLS, ['audio']);
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['audio', 'rotate']);
    expect(settingsStorage.isPlayerAutoRotateEnabled()).toBe(false);
    expect(settingsStorage.getPlayerManualOrientation()).toBe('landscape');
    settingsStorage.setPlayerManualOrientation('portrait_up');
    expect(settingsStorage.getPlayerManualOrientation()).toBe('portrait_up');

    settingsStorage.setHiddenPlayerControls(['audio']);
    settingsStorage.setPlayerAutoRotateEnabled(true);
    expect(settingsStorage.getHiddenPlayerControls()).toEqual(['audio']);
    expect(settingsStorage.isPlayerAutoRotateEnabled()).toBe(true);
  });

  it('defaults ambient lighting off and persists a bounded intensity', () => {
    expect(settingsStorage.isAmbientVideoEnabled()).toBe(false);
    expect(settingsStorage.getAmbientIntensity()).toBe(0.35);
    settingsStorage.setAmbientVideoEnabled(true);
    settingsStorage.setAmbientIntensity(0.6);
    expect(settingsStorage.isAmbientVideoEnabled()).toBe(true);
    expect(settingsStorage.getAmbientIntensity()).toBe(0.6);
    settingsStorage.setAmbientIntensity(5);
    expect(settingsStorage.getAmbientIntensity()).toBe(1);
    settingsStorage.setAmbientIntensity(NaN);
    expect(settingsStorage.getAmbientIntensity()).toBe(1);
    mockNumberValues.set(SettingsKeys.AMBIENT_INTENSITY, NaN);
    expect(settingsStorage.getAmbientIntensity()).toBe(0.35);
  });

  it('persists player styling, validates saved values, and defaults corrupt JSON', () => {
    const defaults = settingsStorage.getPlayerControlStyle();
    expect(defaults).toEqual({labels: 'full', rightLabels: 'full', alignment: 'distributed', scale: 1, backgroundOpacity: 0, titleBackground: false, seekbarScale: 1});
    const style = {...defaults, titleBackground: true, labels: 'hidden' as const, alignment: 'right' as const, scale: 1.2, backgroundOpacity: 0.4, seekbarScale: 1.5};
    settingsStorage.setPlayerControlStyle(style);
    expect(settingsStorage.getPlayerControlStyle()).toEqual(style);
    mockStringValues.set(SettingsKeys.PLAYER_CONTROL_STYLE, JSON.stringify({labels: 'bad', alignment: 'bad', scale: 100, backgroundOpacity: -1, seekbarScale: 999}));
    expect(settingsStorage.getPlayerControlStyle()).toEqual({...defaults, scale: 1.4, seekbarScale: 2});
    mockStringValues.set(SettingsKeys.PLAYER_CONTROL_STYLE, '{broken');
    expect(settingsStorage.getPlayerControlStyle()).toEqual(defaults);
  });

  it('persists the player toolbar layout and recovers from invalid stored JSON', () => {
    const layout = settingsStorage.getPlayerControlLayout();
    layout.top = layout.top.filter(id => id !== 'lock');
    layout.bottom.unshift('lock');
    settingsStorage.setPlayerControlLayout(layout);
    expect(settingsStorage.getPlayerControlLayout()).toEqual(layout);
    mockStringValues.set(SettingsKeys.PLAYER_CONTROL_LAYOUT, '{broken');
    expect(settingsStorage.getPlayerControlLayout().top).toEqual(['sleep', 'lock', 'cast', 'decoder']);
  });

  it('remembers a playback speed from the picker list', () => {
    settingsStorage.setPlaybackSpeed(1.5);

    expect(settingsStorage.getPlaybackSpeed()).toBe(1.5);
    expect(mockNumberValues.get(SettingsKeys.PLAYBACK_SPEED)).toBe(1.5);
  });

  it.each([0.25, 0.3, 0.75, 1.1, 1.35, 1.95, 2])('persists stepped playback speed %s', speed => {
    settingsStorage.setPlaybackSpeed(speed);
    expect(settingsStorage.getPlaybackSpeed()).toBe(speed);
  });

  it('ignores playback speeds that the picker does not offer', () => {
    settingsStorage.setPlaybackSpeed(3);
    settingsStorage.setPlaybackSpeed(Number.NaN);

    expect(mockNumberValues.has(SettingsKeys.PLAYBACK_SPEED)).toBe(false);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
  });

  it('falls back to 1x for invalid saved playback speeds', () => {
    mockNumberValues.set(SettingsKeys.PLAYBACK_SPEED, 1.13);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);

    mockNumberValues.set(SettingsKeys.PLAYBACK_SPEED, Number.NaN);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
  });

  it('persists the hide glass bar on subpages preference', () => {
    expect(settingsStorage.hideGlassTabBarInSubpages()).toBe(true);

    settingsStorage.setHideGlassTabBarInSubpages(false);
    expect(settingsStorage.hideGlassTabBarInSubpages()).toBe(false);
    expect(
      mockBooleanValues.get(SettingsKeys.HIDE_GLASS_TAB_BAR_IN_SUBPAGES),
    ).toBe(false);

    settingsStorage.setHideGlassTabBarInSubpages(true);
    expect(settingsStorage.hideGlassTabBarInSubpages()).toBe(true);
    expect(
      mockBooleanValues.get(SettingsKeys.HIDE_GLASS_TAB_BAR_IN_SUBPAGES),
    ).toBe(true);
  });

  it('persists the Downloads tab preference', () => {
    settingsStorage.setHideDownloadsTab(true);

    expect(settingsStorage.hideDownloadsTab()).toBe(true);
    expect(mockBooleanValues.get(SettingsKeys.HIDE_DOWNLOADS_TAB)).toBe(true);
  });

  it('persists the auto play next episode preference', () => {
    settingsStorage.setAutoPlayNextEpisode(false);

    expect(settingsStorage.isAutoPlayNextEpisodeEnabled()).toBe(false);
    expect(mockBooleanValues.get(SettingsKeys.AUTO_PLAY_NEXT_EPISODE)).toBe(
      false,
    );
  });

  it('shows the sleep timer button by default and can hide it', () => {
    expect(settingsStorage.showSleepTimer()).toBe(true);

    settingsStorage.setShowSleepTimer(false);

    expect(settingsStorage.showSleepTimer()).toBe(false);
    expect(mockBooleanValues.get(SettingsKeys.SHOW_SLEEP_TIMER)).toBe(false);
  });

  it('persists the skip in-app webview preference', () => {
    settingsStorage.setSkipInAppWebview(true);

    expect(settingsStorage.isSkipInAppWebview()).toBe(true);
    expect(mockBooleanValues.get(SettingsKeys.SKIP_IN_APP_WEBVIEW)).toBe(true);
  });

  it('preserves explicit user opt-outs', () => {
    mockBooleanValues.set(SettingsKeys.HAPTIC_FEEDBACK, false);
    mockBooleanValues.set(SettingsKeys.NOTIFICATIONS_ENABLED, false);
    mockBooleanValues.set(SettingsKeys.SHOW_MEDIA_CONTROLS, false);
    mockBooleanValues.set(SettingsKeys.DOH_ENABLED, false);

    expect(settingsStorage.isHapticFeedbackEnabled()).toBe(false);
    expect(settingsStorage.isNotificationsEnabled()).toBe(false);
    expect(settingsStorage.showMediaControls()).toBe(false);
    expect(settingsStorage.isDohEnabled()).toBe(false);
  });
});


describe('provider verification window preference', () => {
  beforeEach(() => mockStringValues.clear());
  it('asks by default, including when a saved value is invalid', () => {
    expect(settingsStorage.getVerificationWindowPolicy()).toBe('ask');
    mockStringValues.set(SettingsKeys.VERIFICATION_WINDOWS, 'unexpected');
    expect(settingsStorage.getVerificationWindowPolicy()).toBe('ask');
  });
  it('persists Ask, Allow and Block', () => {
    for (const policy of ['allow', 'block', 'ask'] as const) {
      settingsStorage.setVerificationWindowPolicy(policy);
      expect(settingsStorage.getVerificationWindowPolicy()).toBe(policy);
      expect(mockStringValues.get(SettingsKeys.VERIFICATION_WINDOWS)).toBe(policy);
    }
  });
});
