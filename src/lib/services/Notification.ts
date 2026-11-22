import notifee, {
  AndroidImportance,
  AndroidGroupAlertBehavior,
  EventDetail,
  EventType,
  AndroidForegroundServiceType,
  AndroidLaunchActivityFlag,
  AuthorizationStatus,
} from '@notifee/react-native';
import {settingsStorage} from '../storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import RNApkInstaller from '@himanshu8443/react-native-apk-installer';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system/legacy';
import type {DownloadSourceType} from '../zustand/downloadsStore';

type NotificationData = Record<string, string | number | object>;

interface DownloadNotificationData extends NotificationData {
  downloadId: string;
  sourceType: DownloadSourceType;
  navigationTarget: 'downloads';
}

export interface NotificationOptions {
  id: string;
  title: string;
  body: string;
  smallIcon?: string;
  color?: string;
  data?: NotificationData;
  progress?: {
    max: number;
    current: number;
    indeterminate?: boolean;
  };
  actions?: Array<{
    title: string;
    pressAction: {
      id: string;
      launchActivity?: string;
      launchActivityFlags?: AndroidLaunchActivityFlag[];
    };
  }>;
  onlyAlertOnce?: boolean;
  asForegroundService?: boolean;
  groupId?: string;
  sortKey?: string;
  groupSummary?: boolean;
  groupAlertBehavior?: AndroidGroupAlertBehavior;
}

export interface ChannelOptions {
  id: string;
  name: string;
  importance?: AndroidImportance;
  description?: string;
}

class NotificationService {
  private _defaultChannelId = 'default';
  private _downloadChannelId = 'download';
  private _updateChannelId = 'update';
  private _downloadForegroundId = 'downloadForegroundService';
  private initialized = false;
  private permissionRequest?: Promise<boolean>;
  private pendingApkInstall?: Promise<void>;
  private readonly notificationOperations = new Map<string, Promise<void>>();

  private getAppLaunchPressAction(id = 'default') {
    return {
      id,
      // The app launcher is an activity alias, so Notifee's `default`
      // resolution is not reliable. Launch the real activity explicitly.
      launchActivity: `${RNApkInstaller.packageName}.MainActivity`,
      launchActivityFlags: [
        AndroidLaunchActivityFlag.NEW_TASK,
        AndroidLaunchActivityFlag.CLEAR_TOP,
        AndroidLaunchActivityFlag.SINGLE_TOP,
      ],
    };
  }

  constructor() {
    this.initialize();
  }
  private async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Create default channels
      await this.createDefaultChannels();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize notification service:', error);
    }
  }

  private async createDefaultChannels() {
    // Default channel
    await notifee.createChannel({
      id: this._defaultChannelId,
      name: 'Default Notifications',
      importance: AndroidImportance.DEFAULT,
    });

    // Download channel
    await notifee.createChannel({
      id: this._downloadChannelId,
      name: 'Download Notifications',
      importance: AndroidImportance.HIGH,
      description: 'Notifications for download progress and completion',
    });

    // Update channel
    await notifee.createChannel({
      id: this._updateChannelId,
      name: 'Update Notifications',
      importance: AndroidImportance.DEFAULT,
      description: 'Notifications for app and provider updates',
    });
  }

  /**
   * Request notification permission
   */
  async requestPermission(): Promise<any> {
    await this.ensureInitialized();
    return await notifee.requestPermission();
  }

  async ensureDownloadPermission(): Promise<boolean> {
    if (this.permissionRequest) {
      return this.permissionRequest;
    }

    this.permissionRequest = (async () => {
      await this.ensureInitialized();
      const current = await notifee.getNotificationSettings();
      if (
        current.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        current.authorizationStatus === AuthorizationStatus.PROVISIONAL
      ) {
        return true;
      }
      const requested = await notifee.requestPermission();
      return (
        requested.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        requested.authorizationStatus === AuthorizationStatus.PROVISIONAL
      );
    })();

    try {
      return await this.permissionRequest;
    } finally {
      this.permissionRequest = undefined;
    }
  }

  /**
   * Create a custom channel
   */
  async createChannel(options: ChannelOptions): Promise<string> {
    await this.ensureInitialized();
    return await notifee.createChannel({
      id: options.id,
      name: options.name,
      importance: options.importance || AndroidImportance.DEFAULT,
      description: options.description,
    });
  }

  /**
   * Display a notification with common settings
   */
  async displayNotification(
    options: NotificationOptions,
    channelId?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const isDownloadNotification = channelId === this._downloadChannelId;
    const notificationColor = isDownloadNotification
      ? options.color || settingsStorage.getPrimaryColor()
      : options.color || '#FFFFFF';

    await notifee.displayNotification({
      id: options.id,
      title: options.title,
      body: options.body,
      data: options.data,
      android: {
        smallIcon:
          options.smallIcon ||
          (isDownloadNotification
            ? 'ic_download_notification'
            : 'ic_notification'),
        channelId: channelId || this._defaultChannelId,
        color: notificationColor,
        pressAction: this.getAppLaunchPressAction(),
        ...(options.progress ? {progress: options.progress} : {}),
        ...(options.actions ? {actions: options.actions} : {}),
        ...(options.groupId ? {groupId: options.groupId} : {}),
        ...(options.sortKey ? {sortKey: options.sortKey} : {}),
        ...(options.groupSummary !== undefined
          ? {groupSummary: options.groupSummary}
          : {}),
        ...(options.groupAlertBehavior !== undefined
          ? {groupAlertBehavior: options.groupAlertBehavior}
          : {}),
        onlyAlertOnce: options.onlyAlertOnce || false,
        asForegroundService: options.asForegroundService ?? false,
        ...(options.asForegroundService
          ? {
              foregroundServiceTypes: [
                AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
              ],
            }
          : {}),
      },
    });
  }

  /**
   * Display a download notification
   */
  async displayDownloadNotification(
    options: NotificationOptions,
  ): Promise<void> {
    await this.enqueueNotificationOperation(options.id, () =>
      this.displayNotification(options, this._downloadChannelId),
    );
  }

  /**
   * Display an update notification
   */
  async displayUpdateNotification(options: NotificationOptions): Promise<void> {
    await this.displayNotification(options, this._updateChannelId);
  }

  /**
   * Cancel a notification
   */
  async cancelNotification(notificationId: string): Promise<void> {
    await this.enqueueNotificationOperation(notificationId, async () => {
      await this.ensureInitialized();
      await notifee.cancelNotification(notificationId);
    });
  }

  /**
   * Cancel all notifications
   */
  async cancelAllNotifications(): Promise<void> {
    await this.ensureInitialized();
    await notifee.cancelAllNotifications();
  }

  private readonly _activeForegroundTasks = new Set<string>();

  private async updateDownloadForegroundNotification(): Promise<void> {
    const count = this._activeForegroundTasks.size;
    if (count === 0) {
      return;
    }
    await this.displayDownloadNotification({
      id: this._downloadForegroundId,
      title: count === 1 ? 'Download in progress' : 'Downloads in progress',
      body: count === 1 ? '1 active download' : `${count} active downloads`,
      smallIcon: 'ic_download_notification_system',
      data: {navigationTarget: 'downloads'},
      onlyAlertOnce: true,
      asForegroundService: true,
      groupId: 'vega-downloads',
      sortKey: '0000-summary',
      groupSummary: true,
      groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
    });
  }

  async startForegroundTask(downloadId: string): Promise<void> {
    this._activeForegroundTasks.add(downloadId);
    await this.updateDownloadForegroundNotification();
  }

  async stopForegroundTask(downloadId: string) {
    this._activeForegroundTasks.delete(downloadId);
    if (this._activeForegroundTasks.size === 0) {
      await notifee.stopForegroundService();
      return;
    }
    await this.updateDownloadForegroundNotification();
  }

  async resetDownloadForegroundState(): Promise<void> {
    this._activeForegroundTasks.clear();
    await notifee.stopForegroundService();
  }

  private getDownloadData(
    downloadId: string,
    sourceType: DownloadSourceType,
  ): DownloadNotificationData {
    return {downloadId, sourceType, navigationTarget: 'downloads'};
  }

  private getNotificationSortKey(downloadId: string): string {
    return downloadId.replace(/_E(\d+)$/, (_, num) => `_E${num.padStart(5, '0')}`);
  }

  /**
   * Helper method to show download starting notification
   */
  async showDownloadStarting(
    title: string,
    downloadId: string,
    sourceType: DownloadSourceType,
    color?: string,
  ): Promise<void> {
    await this.displayDownloadNotification({
      id: downloadId,
      title: title,
      body: 'Starting download',
      smallIcon: 'ic_download_notification_system',
      color,
      data: this.getDownloadData(downloadId, sourceType),
      groupId: 'vega-downloads',
      sortKey: this.getNotificationSortKey(downloadId),
      progress: {
        max: 100,
        current: 0,
        indeterminate: true,
      },
    });
  }

  async showDownloadQueued(
    title: string,
    downloadId: string,
    sourceType: DownloadSourceType,
    color?: string,
  ): Promise<void> {
    await this.displayDownloadNotification({
      id: downloadId,
      title,
      body: 'Queued',
      smallIcon: 'ic_download_queued',
      color,
      data: this.getDownloadData(downloadId, sourceType),
      groupId: 'vega-downloads-queued',
      sortKey: this.getNotificationSortKey(downloadId),
      actions: [
        {
          title: 'Start now',
          pressAction: this.getAppLaunchPressAction('start-now-download'),
        },
        {title: 'Cancel', pressAction: {id: 'cancel-download'}},
      ],
      onlyAlertOnce: true,
    });
  }

  /**
   * Helper method to show download progress notification
   */
  async showDownloadProgress(
    title: string,
    downloadId: string,
    progress: number,
    progressText: string,
    sourceType: DownloadSourceType,
    action: 'pause' | 'resume' | 'none' = 'none',
    color?: string,
    indeterminate = false,
  ): Promise<void> {
    const actions: NotificationOptions['actions'] = [];
    if (action === 'pause') {
      actions.push({title: 'Pause', pressAction: {id: 'pause-download'}});
    } else if (action === 'resume') {
      actions.push({title: 'Resume', pressAction: {id: 'resume-download'}});
    }
    actions.push({title: 'Cancel', pressAction: {id: 'cancel-download'}});

    await this.displayDownloadNotification({
      id: downloadId,
      title: title,
      body: progressText,
      smallIcon:
        action === 'pause'
          ? 'ic_download_notification_system'
          : 'ic_download_notification',
      color,
      data: this.getDownloadData(downloadId, sourceType),
      groupId: 'vega-downloads',
      sortKey: this.getNotificationSortKey(downloadId),
      progress: {
        max: 100,
        current: Math.min(Math.max(progress * 100, 0), 100),
        indeterminate,
      },
      actions,
      onlyAlertOnce: true,
    });
  }

  /**
   * Helper method to show download complete notification
   */
  async showDownloadComplete(
    title: string,
    downloadId: string,
    sourceType: DownloadSourceType,
    color?: string,
  ): Promise<void> {
    await this.cancelNotification(downloadId);
    await this.displayDownloadNotification({
      id: `downloadComplete${downloadId}`,
      title: 'Download complete',
      body: title,
      smallIcon: 'ic_download_complete',
      color,
      data: this.getDownloadData(downloadId, sourceType),
      groupId: 'vega-downloads-completed',
      sortKey: this.getNotificationSortKey(downloadId),
    });
  }

  /**
   * Helper method to show download failed notification
   */
  async showDownloadFailed(
    title: string,
    downloadId: string,
    sourceType: DownloadSourceType,
    color?: string,
  ): Promise<void> {
    await this.cancelNotification(downloadId);
    await this.displayDownloadNotification({
      id: `downloadFailed${downloadId}`,
      title: 'Download failed',
      body: title,
      color,
      data: this.getDownloadData(downloadId, sourceType),
    });
  }

  /**
   * Helper method to show update available notification
   */
  async showUpdateAvailable(
    title: string,
    body: string,
    actions?: Array<{title: string; pressAction: {id: string}}>,
  ): Promise<void> {
    await this.displayUpdateNotification({
      id: 'updateAvailable',
      title: title,
      body: body,
      actions: actions,
    });
  }

  async hasUnknownAppSourcesPermission(): Promise<boolean> {
    const permission =
      (await RNApkInstaller.haveUnknownAppSourcesPermission()) as unknown;
    if (typeof permission === 'boolean') {
      return permission;
    }
    return typeof permission === 'number' && permission < 26;
  }

  async requestUnknownAppSourcesPermission(): Promise<boolean> {
    const packageName = RNApkInstaller.packageName;
    if (!packageName) {
      throw new Error('Unable to determine the Vega Android package name');
    }

    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
      {data: `package:${packageName}`},
    );
    return this.hasUnknownAppSourcesPermission();
  }

  async launchApkInstaller(apkPath: string): Promise<void> {
    const fileUri = apkPath.startsWith('file://')
      ? apkPath
      : `file://${apkPath}`;
    const contentUri = await FileSystem.getContentUriAsync(fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  }

  private installUpdateApk(apkPath: string): Promise<void> {
    if (this.pendingApkInstall) {
      return this.pendingApkInstall;
    }

    const installRequest = (async () => {
      try {
        let canInstall = await this.hasUnknownAppSourcesPermission();
        if (!canInstall) {
          canInstall = await this.requestUnknownAppSourcesPermission();
        }

        if (!canInstall) {
          await this.displayUpdateNotification({
            id: 'downloadComplete',
            title: 'Install permission required',
            body: 'Allow Vega to install unknown apps, then tap to retry',
            data: {filePath: apkPath, action: 'install'},
          });
          return;
        }

        await this.launchApkInstaller(apkPath);
        console.log('APK installation initiated successfully');
      } catch (error) {
        console.error('APK installation error:', error);
        await this.displayUpdateNotification({
          id: 'downloadComplete',
          title: 'Update installation failed',
          body: 'Tap to try installing the update again',
          data: {filePath: apkPath, action: 'install'},
        });
      }
    })();

    this.pendingApkInstall = installRequest.finally(() => {
      this.pendingApkInstall = undefined;
    });
    return this.pendingApkInstall;
  }

  async actionHandler({type, detail}: {type: EventType; detail: EventDetail}) {
    const downloadAction = detail.pressAction?.id;
    if (
      type === EventType.PRESS &&
      detail.notification?.data?.navigationTarget === 'downloads'
    ) {
      const {openDownloadsScreen} =
        require('../../App') as typeof import('../../App');
      openDownloadsScreen();
      return;
    }
    if (
      type === EventType.ACTION_PRESS &&
      (downloadAction === 'cancel-download' ||
        downloadAction === 'pause-download' ||
        downloadAction === 'resume-download' ||
        downloadAction === 'start-now-download' ||
        Boolean(detail.notification?.data?.jobId) ||
        (Boolean(detail.notification?.data?.fileName) &&
          downloadAction !== 'default'))
    ) {
      const notificationData = detail.notification?.data;
      const downloadId =
        notificationData?.downloadId ||
        notificationData?.fileName ||
        (downloadAction !== 'cancel-download' &&
        downloadAction !== 'pause-download' &&
        downloadAction !== 'resume-download' &&
        downloadAction !== 'start-now-download'
          ? downloadAction
          : undefined);
      if (downloadId) {
        const {
          cancelDownload,
          pauseDownload,
          resumeDownload,
          startQueuedDownloadNow,
          waitForDownloadsHydration,
        } =
          require('../downloadManager') as typeof import('../downloadManager');
        await waitForDownloadsHydration();
        if (downloadAction === 'pause-download') {
          await pauseDownload(String(downloadId));
        } else if (downloadAction === 'resume-download') {
          await resumeDownload(String(downloadId));
        } else if (downloadAction === 'start-now-download') {
          await startQueuedDownloadNow(String(downloadId));
        } else {
          await cancelDownload(String(downloadId));
        }
      }
      return;
    }

    // Handle app update installation - check for both PRESS and ACTION_PRESS
    if (
      (type === EventType.PRESS || type === EventType.ACTION_PRESS) &&
      (detail.pressAction?.id === 'install' ||
        detail.notification?.data?.action === 'install')
    ) {
      console.log('Install action pressed');
      const filePath = detail.notification?.data?.filePath;
      const apkPath = typeof filePath === 'string' ? filePath : undefined;
      console.log('APK path:', apkPath);
      const res = apkPath ? await RNFS.exists(apkPath) : false;
      console.log('APK exists:', res);
      if (apkPath && res) {
        console.log('Starting APK installation...');
        await this.installUpdateApk(apkPath);
      } else {
        console.error('APK file not found at path:', apkPath);
      }
    }
  }

  /**
   * Helper method to show update progress notification
   */
  async showUpdateProgress(
    title: string,
    body: string,
    progress?: {max: number; current: number; indeterminate?: boolean},
  ): Promise<void> {
    await this.displayUpdateNotification({
      id: 'updateProgress',
      title: title,
      body: body,
      progress: progress,
    });
  }

  /**
   * Get the default download channel ID
   */
  getDownloadChannelId(): string {
    return this._downloadChannelId;
  }

  /**
   * Get the default update channel ID
   */
  getUpdateChannelId(): string {
    return this._updateChannelId;
  }

  /**
   * Get the default channel ID
   */
  getDefaultChannelId(): string {
    return this._defaultChannelId;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async enqueueNotificationOperation(
    notificationId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.notificationOperations.get(notificationId);
    const current = (previous || Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.notificationOperations.set(notificationId, current);
    try {
      await current;
    } finally {
      if (this.notificationOperations.get(notificationId) === current) {
        this.notificationOperations.delete(notificationId);
      }
    }
  }
}

// Export a singleton instance
export const notificationService = new NotificationService();
export default notificationService;
