const mockCancelDownload = jest.fn(async () => undefined);
const mockPauseDownload = jest.fn(async () => undefined);
const mockResumeDownload = jest.fn(async () => undefined);
const mockStartQueuedDownloadNow = jest.fn(async () => undefined);
const mockWaitForDownloadsHydration = jest.fn(async () => undefined);
const mockOpenDownloadsScreen = jest.fn();

jest.mock('../src/App', () => ({
  openDownloadsScreen: mockOpenDownloadsScreen,
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(async ({id}: {id: string}) => id),
    displayNotification: jest.fn(async () => undefined),
    cancelNotification: jest.fn(async () => undefined),
    cancelAllNotifications: jest.fn(async () => undefined),
    stopForegroundService: jest.fn(async () => undefined),
    getNotificationSettings: jest.fn(async () => ({authorizationStatus: 1})),
    requestPermission: jest.fn(async () => ({authorizationStatus: 1})),
  },
  AndroidImportance: {DEFAULT: 3, HIGH: 4},
  AndroidGroupAlertBehavior: {ALL: 0, SUMMARY: 1, CHILDREN: 2},
  AndroidStyle: {INBOX: 2},
  AndroidForegroundServiceType: {
    FOREGROUND_SERVICE_TYPE_DATA_SYNC: 1,
  },
  AndroidLaunchActivityFlag: {
    SINGLE_TOP: 1,
    NEW_TASK: 2,
    CLEAR_TOP: 4,
  },
  EventType: {PRESS: 1, ACTION_PRESS: 2},
  AuthorizationStatus: {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  },
}));

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getPrimaryColor: () => '#ffffff'},
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  __esModule: true,
  exists: jest.fn(async () => false),
}));

jest.mock('@himanshu8443/react-native-apk-installer', () => ({
  __esModule: true,
  default: {
    packageName: 'com.vega.test',
    install: jest.fn(async () => undefined),
    haveUnknownAppSourcesPermission: jest.fn(async () => true),
  },
}));

jest.mock('expo-intent-launcher', () => ({
  ActivityAction: {
    MANAGE_UNKNOWN_APP_SOURCES: 'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
  },
  startActivityAsync: jest.fn(async () => ({resultCode: 0})),
}));

jest.mock('expo-file-system/legacy', () => ({
  getContentUriAsync: jest.fn(
    async () => 'content://com.vega.test.FileSystemFileProvider/update.apk',
  ),
}));

jest.mock('../src/lib/downloadManager', () => ({
  cancelDownload: mockCancelDownload,
  pauseDownload: mockPauseDownload,
  resumeDownload: mockResumeDownload,
  startQueuedDownloadNow: mockStartQueuedDownloadNow,
  waitForDownloadsHydration: mockWaitForDownloadsHydration,
}));

import {AndroidStyle, EventType} from '@notifee/react-native';
import notifee from '@notifee/react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import RNApkInstaller from '@himanshu8443/react-native-apk-installer';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system/legacy';
import {notificationService} from '../src/lib/services/Notification';

const mockDisplayNotification = notifee.displayNotification as jest.Mock;
const mockStopForegroundService = notifee.stopForegroundService as jest.Mock;
const mockGetNotificationSettings =
  notifee.getNotificationSettings as jest.Mock;
const mockRequestPermission = notifee.requestPermission as jest.Mock;
const mockFileExists = RNFS.exists as jest.Mock;
const mockHaveUnknownAppSourcesPermission =
  RNApkInstaller.haveUnknownAppSourcesPermission as jest.Mock;
const mockStartActivityAsync = IntentLauncher.startActivityAsync as jest.Mock;
const mockGetContentUriAsync = FileSystem.getContentUriAsync as jest.Mock;

const flushAsyncWork = () =>
  new Promise<void>(resolve => setImmediate(resolve));

it('lists each new episode from a newest-first provider in the expanded alert', async () => {
  await notificationService.displayEpisodeNotification({
    show: {id: 'p::show', title: 'Show', link: 'https://example.com/show', provider: 'p', poster: '', seasonTitle: 'Season 2'},
    newEpisodes: [{title: 'Episode 12'}, {title: 'Episode 11'}],
  });

  expect(mockDisplayNotification).toHaveBeenLastCalledWith(expect.objectContaining({
    body: 'Season 2 • Episode 12, Episode 11',
    android: expect.objectContaining({
      style: {type: AndroidStyle.INBOX, lines: ['Episode 12', 'Episode 11'], summary: 'Season 2'},
    }),
  }));
});

describe('notification service download lifecycle', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFileExists.mockResolvedValue(false);
    mockHaveUnknownAppSourcesPermission.mockResolvedValue(true);
    await notificationService.resetDownloadForegroundState();
    mockStopForegroundService.mockClear();
  });

  it('includes stable download identity and backend in progress payloads', async () => {
    await notificationService.showDownloadProgress(
      'Movie',
      'movie_direct_0',
      0.5,
      '50 / 100 MB',
      'http',
      'pause',
    );

    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'movie_direct_0',
        data: {
          downloadId: 'movie_direct_0',
          sourceType: 'http',
          navigationTarget: 'downloads',
        },
        android: expect.objectContaining({
          smallIcon: 'ic_download_notification_system',
          pressAction: {
            id: 'default',
            launchActivity: 'com.vega.test.MainActivity',
            launchActivityFlags: [2, 4, 1],
          },
          groupId: 'vega-downloads',
          sortKey: 'movie_direct_0',
          actions: [
            expect.objectContaining({pressAction: {id: 'pause-download'}}),
            expect.objectContaining({pressAction: {id: 'cancel-download'}}),
          ],
        }),
      }),
    );
  });

  it('uses the show artwork accent for download notification tint', async () => {
    await notificationService.showDownloadProgress(
      'Episode 1',
      'show_s1_e1',
      0.25,
      '25 / 100 MB',
      'http',
      'pause',
      '#C98A54',
    );

    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        android: expect.objectContaining({
          color: '#C98A54',
          smallIcon: 'ic_download_notification_system',
        }),
      }),
    );
  });

  it('uses a static icon when a download is paused', async () => {
    await notificationService.showDownloadProgress(
      'Episode 1',
      'show_s1_e1',
      0.25,
      'Paused',
      'http',
      'resume',
    );

    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        android: expect.objectContaining({
          smallIcon: 'ic_download_notification',
        }),
      }),
    );
  });

  it('shows queued downloads with Start now and Cancel actions', async () => {
    await notificationService.showDownloadQueued(
      'Movie',
      'movie_direct_0',
      'http',
    );

    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'movie_direct_0',
        body: 'Queued',
        data: {
          downloadId: 'movie_direct_0',
          sourceType: 'http',
          navigationTarget: 'downloads',
        },
        android: expect.objectContaining({
          groupId: 'vega-downloads-queued',
          sortKey: 'movie_direct_0',
          actions: [
            expect.objectContaining({
              pressAction: {
                id: 'start-now-download',
                launchActivity: 'com.vega.test.MainActivity',
                launchActivityFlags: [2, 4, 1],
              },
            }),
            expect.objectContaining({pressAction: {id: 'cancel-download'}}),
          ],
          smallIcon: 'ic_download_queued',
        }),
      }),
    );
  });

  it('shows completed downloads with a complete check icon in the completed group', async () => {
    await notificationService.showDownloadComplete(
      'Movie',
      'movie_direct_0',
      'http',
    );

    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'downloadCompletemovie_direct_0',
        title: 'Download complete',
        body: 'Movie',
        android: expect.objectContaining({
          smallIcon: 'ic_download_complete',
          groupId: 'vega-downloads-completed',
          sortKey: 'movie_direct_0',
        }),
      }),
    );
  });

  it('does not let an older queued update replace a starting notification', async () => {
    let releaseQueued: (() => void) | undefined;
    mockDisplayNotification.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseQueued = resolve;
        }),
    );

    const queued = notificationService.showDownloadQueued(
      'Movie',
      'movie_direct_0',
      'http',
    );
    await flushAsyncWork();
    const cancel = notificationService.cancelNotification('movie_direct_0');
    const starting = notificationService.showDownloadStarting(
      'Movie',
      'movie_direct_0',
      'http',
    );

    expect(mockDisplayNotification).toHaveBeenCalledTimes(1);
    releaseQueued?.();
    await Promise.all([queued, cancel, starting]);

    expect(mockDisplayNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'movie_direct_0',
        body: 'Starting download',
      }),
    );
  });

  it('does not request permission when notifications are already authorized', async () => {
    await expect(notificationService.ensureDownloadPermission()).resolves.toBe(
      true,
    );
    expect(mockGetNotificationSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('requests permission when notifications are not authorized', async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({authorizationStatus: 0});

    await expect(notificationService.ensureDownloadPermission()).resolves.toBe(
      true,
    );

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('keeps the foreground service while another download remains active', async () => {
    await notificationService.startForegroundTask('first');

    const foregroundNotification = mockDisplayNotification.mock.calls[0][0];
    expect(foregroundNotification.android).toMatchObject({
      groupId: 'vega-downloads',
      sortKey: '0000-summary',
      groupSummary: true,
      groupAlertBehavior: 2,
    });
    expect(foregroundNotification.android).not.toHaveProperty('progress');
    expect(foregroundNotification.android).not.toHaveProperty('actions');

    await notificationService.startForegroundTask('second');

    expect(mockDisplayNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'downloadForegroundService',
        body: '2 active downloads',
        android: expect.objectContaining({asForegroundService: true}),
      }),
    );

    await notificationService.stopForegroundTask('first');
    expect(mockStopForegroundService).not.toHaveBeenCalled();
    expect(mockDisplayNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'downloadForegroundService',
        body: '1 active download',
      }),
    );

    await notificationService.stopForegroundTask('second');
    expect(mockStopForegroundService).toHaveBeenCalledTimes(1);
  });

  it('keeps simultaneous episode progress notifications separate', async () => {
    await notificationService.showDownloadProgress(
      'Episode 1',
      'show_s1_e1',
      0.25,
      '25 / 100 MB',
      'http',
    );
    await notificationService.showDownloadProgress(
      'Episode 2',
      'show_s1_e2',
      0.5,
      '50 / 100 MB',
      'http',
    );

    expect(mockDisplayNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'show_s1_e1',
        android: expect.objectContaining({
          asForegroundService: false,
          groupId: 'vega-downloads',
          sortKey: 'show_s1_e1',
        }),
      }),
    );
    expect(mockDisplayNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'show_s1_e2',
        android: expect.objectContaining({
          asForegroundService: false,
          groupId: 'vega-downloads',
          sortKey: 'show_s1_e2',
        }),
      }),
    );
  });

  it('routes stable download cancellation through the global manager', async () => {
    await notificationService.actionHandler({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'cancel-download'},
        notification: {
          data: {downloadId: 'movie_direct_0', sourceType: 'torrent'},
        },
      } as never,
    });

    expect(mockCancelDownload).toHaveBeenCalledWith('movie_direct_0');
  });

  it('opens Downloads when a download notification body is pressed', async () => {
    await notificationService.actionHandler({
      type: EventType.PRESS,
      detail: {
        pressAction: {id: 'default'},
        notification: {
          data: {navigationTarget: 'downloads'},
        },
      } as never,
    });

    expect(mockOpenDownloadsScreen).toHaveBeenCalledTimes(1);
  });

  it('requests unknown-app permission before installing an update', async () => {
    mockFileExists.mockResolvedValueOnce(true);
    mockHaveUnknownAppSourcesPermission
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await notificationService.actionHandler({
      type: EventType.PRESS,
      detail: {
        pressAction: {id: 'default'},
        notification: {
          data: {action: 'install', filePath: '/cache/vega-update.apk'},
        },
      } as never,
    });

    expect(mockStartActivityAsync).toHaveBeenCalledWith(
      'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
      {data: 'package:com.vega.test'},
    );
    expect(mockGetContentUriAsync).toHaveBeenCalledWith(
      'file:///cache/vega-update.apk',
    );
    expect(mockStartActivityAsync).toHaveBeenCalledWith(
      'android.intent.action.VIEW',
      {
        data: 'content://com.vega.test.FileSystemFileProvider/update.apk',
        flags: 1,
        type: 'application/vnd.android.package-archive',
      },
    );
  });

  it('does not install when unknown-app permission remains denied', async () => {
    mockFileExists.mockResolvedValueOnce(true);
    mockHaveUnknownAppSourcesPermission.mockResolvedValue(false);

    await notificationService.actionHandler({
      type: EventType.PRESS,
      detail: {
        pressAction: {id: 'default'},
        notification: {
          data: {action: 'install', filePath: '/cache/vega-update.apk'},
        },
      } as never,
    });

    expect(mockGetContentUriAsync).not.toHaveBeenCalled();
    expect(mockDisplayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'downloadComplete',
        title: 'Install permission required',
        data: {
          action: 'install',
          filePath: '/cache/vega-update.apk',
        },
      }),
    );
  });

  it('routes pause and resume actions through the global manager', async () => {
    await notificationService.actionHandler({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'pause-download'},
        notification: {
          data: {downloadId: 'movie_direct_0', sourceType: 'http'},
        },
      } as never,
    });
    await notificationService.actionHandler({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'resume-download'},
        notification: {
          data: {downloadId: 'movie_direct_0', sourceType: 'http'},
        },
      } as never,
    });

    expect(mockPauseDownload).toHaveBeenCalledWith('movie_direct_0');
    expect(mockResumeDownload).toHaveBeenCalledWith('movie_direct_0');
  });

  it('routes Start now through the global manager', async () => {
    await notificationService.actionHandler({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'start-now-download'},
        notification: {
          data: {downloadId: 'movie_direct_0', sourceType: 'http'},
        },
      } as never,
    });

    expect(mockStartQueuedDownloadNow).toHaveBeenCalledWith('movie_direct_0');
    expect(mockWaitForDownloadsHydration).toHaveBeenCalledTimes(1);
  });

  it('temporarily supports legacy filename cancellation payloads', async () => {
    await notificationService.actionHandler({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'legacy-file'},
        notification: {
          data: {fileName: 'legacy-file', jobId: 42},
        },
      } as never,
    });

    expect(mockCancelDownload).toHaveBeenCalledWith('legacy-file');
  });
});
