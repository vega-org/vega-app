const mockBooleanValues = new Map<string, boolean>();
const mockNumberValues = new Map<string, number>();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getBool: (key: string, defaultValue = false) =>
      mockBooleanValues.has(key) ? mockBooleanValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockBooleanValues.set(key, value),
    getString: () => undefined,
    setString: jest.fn(),
    getNumber: (key: string) => mockNumberValues.get(key),
    setNumber: (key: string, value: number) => mockNumberValues.set(key, value),
    getArray: () => undefined,
    setArray: jest.fn(),
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
  });

  it('enables default-on preferences when no value is stored', () => {
    expect(settingsStorage.isHapticFeedbackEnabled()).toBe(true);
    expect(settingsStorage.isNotificationsEnabled()).toBe(true);
    expect(settingsStorage.isAutoCheckUpdateEnabled()).toBe(true);
    expect(settingsStorage.showMediaControls()).toBe(true);
    expect(settingsStorage.showHamburgerMenu()).toBe(true);
    expect(settingsStorage.isSwipeGestureEnabled()).toBe(true);
    expect(settingsStorage.isTelemetryOptIn()).toBe(true);
    expect(settingsStorage.isDohEnabled()).toBe(true);
    expect(settingsStorage.showTabBarLabels()).toBe(true);
    expect(settingsStorage.showPlayerEpisodeSidebar()).toBe(true);
    expect(settingsStorage.isAutoPlayNextEpisodeEnabled()).toBe(true);
  });

  it('keeps intentional default-off preferences disabled', () => {
    expect(settingsStorage.hideDownloadsTab()).toBe(false);
    expect(settingsStorage.isAutoDownloadEnabled()).toBe(false);
    expect(settingsStorage.hideSeekButtons()).toBe(false);
    expect(settingsStorage.isEnable2xGestureEnabled()).toBe(false);
    expect(settingsStorage.isSkipInAppWebview()).toBe(false);
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
    for (const seconds of [5, 10, 15, 30, 60, 85]) {
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

  it('defaults playback speed to 1x when nothing is saved', () => {
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
  });

  it('remembers a playback speed from the picker list', () => {
    settingsStorage.setPlaybackSpeed(1.5);

    expect(settingsStorage.getPlaybackSpeed()).toBe(1.5);
    expect(mockNumberValues.get(SettingsKeys.PLAYBACK_SPEED)).toBe(1.5);
  });

  it('ignores playback speeds that the picker does not offer', () => {
    settingsStorage.setPlaybackSpeed(3);
    settingsStorage.setPlaybackSpeed(Number.NaN);

    expect(mockNumberValues.has(SettingsKeys.PLAYBACK_SPEED)).toBe(false);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
  });

  it('falls back to 1x for invalid saved playback speeds', () => {
    mockNumberValues.set(SettingsKeys.PLAYBACK_SPEED, 1.1);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);

    mockNumberValues.set(SettingsKeys.PLAYBACK_SPEED, Number.NaN);
    expect(settingsStorage.getPlaybackSpeed()).toBe(1);
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
