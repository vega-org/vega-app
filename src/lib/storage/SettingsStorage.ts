import {mainStorage} from './StorageService';
import {
  DownloadLocationConfig,
  getDownloadLocationDisplayValue,
  parseDownloadLocation,
  serializeDownloadLocation,
} from '../downloadLocation';

/**
 * Storage keys for settings
 */
export enum SettingsKeys {
  // UI preferences
  PRIMARY_COLOR = 'primaryColor',
  IS_CUSTOM_THEME = 'isCustomTheme',
  SHOW_TAB_BAR_LABELS = 'showTabBarLabels',
  HIDE_DOWNLOADS_TAB = 'hideDownloadsTab',
  SHOW_CONTINUE_WATCHING = 'showContinueWatching',
  CUSTOM_COLOR = 'customColor',
  ACCENT_SOURCE = 'accentSource',
  LAUNCHER_ICON = 'launcherIcon',
  DYNAMIC_INFO_ACCENT = 'dynamicInfoAccent',
  // Feedback settings
  HAPTIC_FEEDBACK = 'hapticFeedback',
  NOTIFICATIONS_ENABLED = 'notificationsEnabled',

  // Update settings
  AUTO_CHECK_UPDATE = 'autoCheckUpdate',
  AUTO_DOWNLOAD = 'autoDownload',

  // Player settings
  SHOW_MEDIA_CONTROLS = 'showMediaControls',
  SHOW_HAMBURGER_MENU = 'showHamburgerMenu',
  HIDE_SEEK_BUTTONS = 'hideSeekButtons',
  SHOW_PLAYER_EPISODE_SIDEBAR = 'showPlayerEpisodeSidebar',
  AUTO_PLAY_NEXT_EPISODE = 'autoPlayNextEpisode',
  SHOW_SLEEP_TIMER = 'showSleepTimer',
  ENABLE_2X_GESTURE = 'enable2xGesture',
  ENABLE_SWIPE_GESTURE = 'enableSwipeGesture',
  FORWARD_BUFFER_MB = 'forwardBufferMB',
  BACK_BUFFER_MB = 'backBufferMB',
  SEEK_INTERVAL = 'seekInterval',
  PLAYBACK_SPEED = 'playbackSpeed',

  // Quality settings
  EXCLUDED_QUALITIES = 'excludedQualities',

  // Provider list order picked in the provider drawer
  PROVIDER_ORDER = 'providerOrder',

  // Download settings
  DOWNLOAD_LOCATION = 'downloadLocation',
  DOWNLOAD_CONCURRENCY = 'downloadConcurrency',
  DOWNLOAD_CONNECTIONS = 'downloadConnections',
  PARALLEL_STREAMING = 'parallelStreaming',

  // Subtitle settings
  SUBTITLE_FONT_SIZE = 'subtitleFontSize',
  SUBTITLE_OPACITY = 'subtitleOpacity',
  SUBTITLE_TEXT_OPACITY = 'subtitleTextOpacity',
  SUBTITLE_BOTTOM_PADDING = 'subtitleBottomPadding',
  SUBTITLE_TEXT_COLOR = 'subtitleTextColor',
  SUBTITLE_FONT_FAMILY = 'subtitleFontFamily',
  SUBTITLE_EDGE_TYPE = 'subtitleEdgeType',
  SUBTITLE_EDGE_COLOR = 'subtitleEdgeColor',
  SUBTITLE_OUTLINE_WIDTH = 'subtitleOutlineWidth',

  LIST_VIEW_TYPE = 'viewType',

  // Telemetry (privacy)
  TELEMETRY_OPT_IN = 'telemetryOptIn',

  // Metadata services
  TMDB_API_KEY = 'tmdbApiKey',
  TMDB_API_KEY_REVISION = 'tmdbApiKeyRevision',

  // DNS over HTTPS
  DOH_ENABLED = 'dohEnabled',
  DOH_PROVIDER = 'dohProvider',
  DOH_CUSTOM_URL = 'dohCustomUrl',

  // Cloudflare WARP
  WARP_ENABLED = 'warpEnabled',

  // ByeDPI Anti-DPI
  BYEDPI_ENABLED = 'byedpiEnabled',
  BYEDPI_CMD_ARGS = 'byedpiCmdArgs',

  // Webview
  SKIP_IN_APP_WEBVIEW = 'skipInAppWebview',

  // Remote Playback
  ALWAYS_CAST_MODE = 'alwaysCastMode',
  ASK_LOCAL_FILE_FIRST = 'askLocalFileFirst',
  TORRENT_FULL_DOWNLOAD = 'torrentFullDownload',
}

/**
 * Settings storage manager
 */
/**
 * Buffer size choices in MB. Size, not time: a minute of a 50 GB remux is far
 * bigger than a minute of a small encode. The patched native load control
 * enforces both caps (and never exceeds 35% of the app heap).
 */
export const BUFFER_LIMITS = {
  forwardMin: 16,
  forwardMax: 256,
  backMax: 128,
  step: 16,
} as const;
/** Connections one download may open; servers that refuse extra ones lower it. */
export const MIN_DOWNLOAD_CONNECTIONS = 1;
export const MAX_DOWNLOAD_CONNECTIONS = 16;
const DEFAULT_DOWNLOAD_CONNECTIONS = 4;

const isValidConnectionCount = (value: number | undefined): value is number =>
  Number.isInteger(value) &&
  (value as number) >= MIN_DOWNLOAD_CONNECTIONS &&
  (value as number) <= MAX_DOWNLOAD_CONNECTIONS;

/** Seek step choices in seconds; 85 skips a typical anime opening. */
export const SEEK_INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 85] as const;
const DEFAULT_SEEK_INTERVAL = 10;

const isValidSeekInterval = (value: number | undefined): value is number =>
  (SEEK_INTERVAL_OPTIONS as readonly number[]).includes(value as number);
/** Speeds offered by the player speed picker. */
export const PLAYBACK_SPEEDS = [
  0.25, 0.5, 1.0, 1.25, 1.35, 1.5, 1.75, 2,
] as const;
const DEFAULT_PLAYBACK_SPEED = 1.0;

const isAllowedPlaybackSpeed = (value: unknown): value is number =>
  typeof value === 'number' &&
  (PLAYBACK_SPEEDS as readonly number[]).includes(value);

const DEFAULT_FORWARD_BUFFER_MB = 64;
const DEFAULT_BACK_BUFFER_MB = 0;

/** Rounds to the slider step and clamps; falls back for missing values. */
const clampBufferMB = (
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / BUFFER_LIMITS.step) * BUFFER_LIMITS.step;
  return Math.min(Math.max(stepped, min), max);
};

export class SettingsStorage {
  isAlwaysCastMode(): boolean {
    return mainStorage.getBool(SettingsKeys.ALWAYS_CAST_MODE);
  }

  setAlwaysCastMode(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ALWAYS_CAST_MODE, enabled);
  }

  /**
   * Opt-in (off by default): when on, tapping a movie/episode first offers to
   * play a file from this device, and only loads online streams if the user
   * declines.
   */
  isAskLocalFileFirst(): boolean {
    return mainStorage.getBool(SettingsKeys.ASK_LOCAL_FILE_FIRST, false);
  }

  setAskLocalFileFirst(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ASK_LOCAL_FILE_FIRST, enabled);
  }

  /** Off: a torrent downloads only about a minute ahead of playback. */
  isTorrentFullDownload(): boolean {
    return mainStorage.getBool(SettingsKeys.TORRENT_FULL_DOWNLOAD, true);
  }

  setTorrentFullDownload(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.TORRENT_FULL_DOWNLOAD, enabled);
  }

  // Theme settings
  getPrimaryColor(): string {
    return mainStorage.getString(SettingsKeys.PRIMARY_COLOR) || '#FFFFFF';
  }

  setPrimaryColor(color: string): void {
    mainStorage.setString(SettingsKeys.PRIMARY_COLOR, color);
  }

  isCustomTheme(): boolean {
    return mainStorage.getBool(SettingsKeys.IS_CUSTOM_THEME);
  }

  setCustomTheme(isCustom: boolean): void {
    mainStorage.setBool(SettingsKeys.IS_CUSTOM_THEME, isCustom);
  }

  getCustomColor(): string {
    return mainStorage.getString(SettingsKeys.CUSTOM_COLOR) || '#FFFFFF';
  }

  setCustomColor(color: string): void {
    mainStorage.setString(SettingsKeys.CUSTOM_COLOR, color);
  }

  /**
   * Accent source for the Material 3 palette. `wallpaper` follows Material You
   * (Android 12+), `custom` derives the palette from the stored seed color.
   */
  getAccentSource(): 'wallpaper' | 'custom' {
    return mainStorage.getString(SettingsKeys.ACCENT_SOURCE) === 'wallpaper'
      ? 'wallpaper'
      : 'custom';
  }

  setAccentSource(source: 'wallpaper' | 'custom'): void {
    mainStorage.setString(SettingsKeys.ACCENT_SOURCE, source);
  }

  isDynamicInfoAccentEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.DYNAMIC_INFO_ACCENT, true);
  }

  setDynamicInfoAccentEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.DYNAMIC_INFO_ACCENT, enabled);
  }

  getLauncherIcon(): 'white' | 'tomato' | 'gray' | 'blue' | 'lavender' {
    const icon = mainStorage.getString(SettingsKeys.LAUNCHER_ICON);
    return icon === 'white' ||
      icon === 'gray' ||
      icon === 'blue' ||
      icon === 'lavender'
      ? icon
      : 'white';
  }

  setLauncherIcon(
    icon: 'white' | 'tomato' | 'gray' | 'blue' | 'lavender',
  ): void {
    mainStorage.setString(SettingsKeys.LAUNCHER_ICON, icon);
  }

  // UI preferences
  showTabBarLabels(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_TAB_BAR_LABELS, true);
  }

  setShowTabBarLabels(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_TAB_BAR_LABELS, show);
  }

  hideDownloadsTab(): boolean {
    return mainStorage.getBool(SettingsKeys.HIDE_DOWNLOADS_TAB, false);
  }

  setHideDownloadsTab(hide: boolean): void {
    mainStorage.setBool(SettingsKeys.HIDE_DOWNLOADS_TAB, hide);
  }

  /** Continue watching row on Home. Playback positions are saved either way. */
  showContinueWatching(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_CONTINUE_WATCHING, true);
  }

  setShowContinueWatching(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_CONTINUE_WATCHING, show);
  }

  isHapticFeedbackEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.HAPTIC_FEEDBACK, true);
  }
  setHapticFeedbackEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.HAPTIC_FEEDBACK, enabled);
  }

  isNotificationsEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.NOTIFICATIONS_ENABLED, true);
  }

  setNotificationsEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.NOTIFICATIONS_ENABLED, enabled);
  }

  // Update settings
  isAutoCheckUpdateEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_CHECK_UPDATE, true);
  }

  setAutoCheckUpdateEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.AUTO_CHECK_UPDATE, enabled);
  }

  isAutoDownloadEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_DOWNLOAD, false);
  }

  setAutoDownloadEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.AUTO_DOWNLOAD, enabled);
  }

  // Player settings
  showMediaControls(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_MEDIA_CONTROLS, true);
  }

  setShowMediaControls(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_MEDIA_CONTROLS, show);
  }

  showHamburgerMenu(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_HAMBURGER_MENU, true);
  }

  setShowHamburgerMenu(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_HAMBURGER_MENU, show);
  }

  hideSeekButtons(): boolean {
    return mainStorage.getBool(SettingsKeys.HIDE_SEEK_BUTTONS, false);
  }

  setHideSeekButtons(hide: boolean): void {
    mainStorage.setBool(SettingsKeys.HIDE_SEEK_BUTTONS, hide);
  }

  showPlayerEpisodeSidebar(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_PLAYER_EPISODE_SIDEBAR, true);
  }

  setShowPlayerEpisodeSidebar(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_PLAYER_EPISODE_SIDEBAR, show);
  }

  isAutoPlayNextEpisodeEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_PLAY_NEXT_EPISODE, true);
  }

  setAutoPlayNextEpisode(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.AUTO_PLAY_NEXT_EPISODE, enabled);
  }

  showSleepTimer(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_SLEEP_TIMER, true);
  }

  setShowSleepTimer(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_SLEEP_TIMER, show);
  }

  isEnable2xGestureEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.ENABLE_2X_GESTURE, false);
  }

  setEnable2xGesture(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ENABLE_2X_GESTURE, enabled);
  }

  isSwipeGestureEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.ENABLE_SWIPE_GESTURE, true);
  }

  setSwipeGestureEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ENABLE_SWIPE_GESTURE, enabled);
  }

  getSeekInterval(): number {
    const value = mainStorage.getNumber(SettingsKeys.SEEK_INTERVAL);
    return isValidSeekInterval(value) ? value : DEFAULT_SEEK_INTERVAL;
  }

  setSeekInterval(seconds: number): void {
    if (isValidSeekInterval(seconds)) {
      mainStorage.setNumber(SettingsKeys.SEEK_INTERVAL, seconds);
    }
  }

  // Quality settings
  getExcludedQualities(): string[] {
    return mainStorage.getArray<string>(SettingsKeys.EXCLUDED_QUALITIES) || [];
  }

  setExcludedQualities(qualities: string[]): void {
    mainStorage.setArray(SettingsKeys.EXCLUDED_QUALITIES, qualities);
  }

  /** Installed provider keys in the user's order (see providerOrderKey). */
  getProviderOrder(): string[] {
    return mainStorage.getArray<string>(SettingsKeys.PROVIDER_ORDER) || [];
  }

  setProviderOrder(keys: string[]): void {
    mainStorage.setArray(SettingsKeys.PROVIDER_ORDER, keys);
  }

  getDownloadLocationConfig(): DownloadLocationConfig | null {
    return parseDownloadLocation(
      mainStorage.getString(SettingsKeys.DOWNLOAD_LOCATION),
    );
  }

  getDownloadLocation(): string {
    return getDownloadLocationDisplayValue(this.getDownloadLocationConfig());
  }

  setDownloadLocation(location: DownloadLocationConfig): void {
    mainStorage.setString(
      SettingsKeys.DOWNLOAD_LOCATION,
      serializeDownloadLocation(location),
    );
  }

  resetDownloadLocation(): void {
    mainStorage.delete(SettingsKeys.DOWNLOAD_LOCATION);
  }

  getForwardBufferMB(): number {
    return clampBufferMB(
      mainStorage.getNumber(SettingsKeys.FORWARD_BUFFER_MB),
      BUFFER_LIMITS.forwardMin,
      BUFFER_LIMITS.forwardMax,
      DEFAULT_FORWARD_BUFFER_MB,
    );
  }

  setForwardBufferMB(mb: number): void {
    mainStorage.setNumber(
      SettingsKeys.FORWARD_BUFFER_MB,
      clampBufferMB(
        mb,
        BUFFER_LIMITS.forwardMin,
        BUFFER_LIMITS.forwardMax,
        DEFAULT_FORWARD_BUFFER_MB,
      ),
    );
  }

  getBackBufferMB(): number {
    return clampBufferMB(
      mainStorage.getNumber(SettingsKeys.BACK_BUFFER_MB),
      0,
      BUFFER_LIMITS.backMax,
      DEFAULT_BACK_BUFFER_MB,
    );
  }

  setBackBufferMB(mb: number): void {
    mainStorage.setNumber(
      SettingsKeys.BACK_BUFFER_MB,
      clampBufferMB(mb, 0, BUFFER_LIMITS.backMax, DEFAULT_BACK_BUFFER_MB),
    );
  }

  getPlaybackSpeed(): number {
    const value = mainStorage.getNumber(SettingsKeys.PLAYBACK_SPEED);
    return isAllowedPlaybackSpeed(value) ? value : DEFAULT_PLAYBACK_SPEED;
  }

  setPlaybackSpeed(speed: number): void {
    if (isAllowedPlaybackSpeed(speed)) {
      mainStorage.setNumber(SettingsKeys.PLAYBACK_SPEED, speed);
    }
  }

  getDownloadConcurrency(): number {
    const value = mainStorage.getNumber(SettingsKeys.DOWNLOAD_CONCURRENCY);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.round(value), 1), 5)
      : 2;
  }

  setDownloadConcurrency(value: number): void {
    mainStorage.setNumber(
      SettingsKeys.DOWNLOAD_CONCURRENCY,
      Math.min(Math.max(Math.round(value), 1), 5),
    );
  }

  getDownloadConnections(): number {
    const value = mainStorage.getNumber(SettingsKeys.DOWNLOAD_CONNECTIONS);
    return isValidConnectionCount(value) ? value : DEFAULT_DOWNLOAD_CONNECTIONS;
  }

  setDownloadConnections(value: number): void {
    if (isValidConnectionCount(value)) {
      mainStorage.setNumber(SettingsKeys.DOWNLOAD_CONNECTIONS, value);
    }
  }

  getParallelStreaming(): boolean {
    return mainStorage.getBool(SettingsKeys.PARALLEL_STREAMING, false);
  }

  setParallelStreaming(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.PARALLEL_STREAMING, enabled);
  }

  // Subtitle settings
  getSubtitleFontSize(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_FONT_SIZE) ?? 16;
  }

  setSubtitleFontSize(size: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_FONT_SIZE, size);
  }

  getSubtitleOpacity(): number {
    const opacityStr = mainStorage.getString(SettingsKeys.SUBTITLE_OPACITY);
    return opacityStr !== undefined && opacityStr !== ''
      ? parseFloat(opacityStr)
      : 1;
  }

  setSubtitleOpacity(opacity: number): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_OPACITY, opacity.toString());
  }

  getSubtitleTextOpacity(): number {
    const value = mainStorage.getNumber(SettingsKeys.SUBTITLE_TEXT_OPACITY);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(value, 0.2), 1)
      : 1;
  }

  setSubtitleTextOpacity(opacity: number): void {
    mainStorage.setNumber(
      SettingsKeys.SUBTITLE_TEXT_OPACITY,
      Math.min(Math.max(opacity, 0.2), 1),
    );
  }

  getSubtitleBottomPadding(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING) ?? 10;
  }

  setSubtitleBottomPadding(padding: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING, padding);
  }

  getSubtitleTextColor(): string {
    return mainStorage.getString(SettingsKeys.SUBTITLE_TEXT_COLOR) || '#FFFFFF';
  }

  setSubtitleTextColor(color: string): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_TEXT_COLOR, color);
  }

  getSubtitleFontFamily(): string {
    return (
      mainStorage.getString(SettingsKeys.SUBTITLE_FONT_FAMILY) || 'default'
    );
  }

  setSubtitleFontFamily(font: string): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_FONT_FAMILY, font);
  }

  getSubtitleEdgeType():
    | 'outline'
    | 'dropShadow'
    | 'raised'
    | 'depressed'
    | 'none' {
    const val = mainStorage.getString(SettingsKeys.SUBTITLE_EDGE_TYPE);
    if (
      val === 'dropShadow' ||
      val === 'raised' ||
      val === 'depressed' ||
      val === 'none'
    ) {
      return val;
    }
    return 'outline';
  }

  setSubtitleEdgeType(
    edgeType: 'outline' | 'dropShadow' | 'raised' | 'depressed' | 'none',
  ): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_EDGE_TYPE, edgeType);
  }

  getSubtitleEdgeColor(): string {
    return mainStorage.getString(SettingsKeys.SUBTITLE_EDGE_COLOR) || '#000000';
  }

  setSubtitleEdgeColor(color: string): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_EDGE_COLOR, color);
  }

  getSubtitleOutlineWidth(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_OUTLINE_WIDTH) ?? 2;
  }

  setSubtitleOutlineWidth(width: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_OUTLINE_WIDTH, width);
  }

  getListViewType(): number {
    return parseInt(
      mainStorage.getString(SettingsKeys.LIST_VIEW_TYPE) || '1',
      10,
    );
  }

  setListViewType(type: number): void {
    mainStorage.setString(SettingsKeys.LIST_VIEW_TYPE, type.toString());
  }

  // Telemetry / Privacy
  isTelemetryOptIn(): boolean {
    return mainStorage.getBool(SettingsKeys.TELEMETRY_OPT_IN, true);
  }

  setTelemetryOptIn(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.TELEMETRY_OPT_IN, enabled);
  }

  getTmdbApiKey(): string {
    return mainStorage.getString(SettingsKeys.TMDB_API_KEY)?.trim() || '';
  }

  setTmdbApiKey(apiKey: string): void {
    const normalizedKey = apiKey.trim();
    if (normalizedKey) {
      mainStorage.setString(SettingsKeys.TMDB_API_KEY, normalizedKey);
    } else {
      mainStorage.delete(SettingsKeys.TMDB_API_KEY);
    }
    mainStorage.setNumber(
      SettingsKeys.TMDB_API_KEY_REVISION,
      this.getTmdbApiKeyRevision() + 1,
    );
  }

  getTmdbApiKeyRevision(): number {
    return mainStorage.getNumber(SettingsKeys.TMDB_API_KEY_REVISION) || 0;
  }

  // Generic get/set methods for settings not covered by specific methods
  getBool(key: string, defaultValue = false): boolean {
    return mainStorage.getBool(key, defaultValue);
  }

  setBool(key: string, value: boolean): void {
    mainStorage.setBool(key, value);
  }
  // DNS over HTTPS
  isDohEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.DOH_ENABLED, true);
  }

  setDohEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.DOH_ENABLED, enabled);
  }

  getDohProvider(): string {
    return mainStorage.getString(SettingsKeys.DOH_PROVIDER) || 'cloudflare';
  }

  setDohProvider(provider: string): void {
    mainStorage.setString(SettingsKeys.DOH_PROVIDER, provider);
  }

  getDohCustomUrl(): string {
    return mainStorage.getString(SettingsKeys.DOH_CUSTOM_URL) || '';
  }

  setDohCustomUrl(url: string): void {
    mainStorage.setString(SettingsKeys.DOH_CUSTOM_URL, url);
  }

  // Cloudflare WARP
  isWarpEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.WARP_ENABLED, false);
  }

  setWarpEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.WARP_ENABLED, enabled);
  }

  // ByeDPI Anti-DPI
  isByeDpiEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.BYEDPI_ENABLED, true);
  }

  setByeDpiEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.BYEDPI_ENABLED, enabled);
  }

  getByeDpiCmdArgs(): string {
    return mainStorage.getString(SettingsKeys.BYEDPI_CMD_ARGS) || '';
  }

  setByeDpiCmdArgs(args: string): void {
    mainStorage.setString(SettingsKeys.BYEDPI_CMD_ARGS, args);
  }

  // Webview
  isSkipInAppWebview(): boolean {
    return mainStorage.getBool(SettingsKeys.SKIP_IN_APP_WEBVIEW, false);
  }

  setSkipInAppWebview(skip: boolean): void {
    mainStorage.setBool(SettingsKeys.SKIP_IN_APP_WEBVIEW, skip);
  }
}

// Export a singleton instance
export const settingsStorage = new SettingsStorage();
