import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('@dr.pogodin/react-native-fs', () => ({
  ExternalDirectoryPath: '/app-files',
  pickFile: jest.fn(),
  readDir: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    readDirectoryAsync: jest.fn(async () => []),
    deleteAsync: jest.fn(async () => undefined),
    requestDirectoryPermissionsAsync: jest.fn(async () => ({
      granted: true,
      directoryUri: 'content://downloads/tree/primary%3AMovies',
    })),
  },
}));

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: {OS: 'android', isTV: false},
  ToastAndroid: {
    show: jest.fn(),
    LONG: 1,
    SHORT: 0,
  },
}));

import {
  deleteDownloadedFileByBaseName,
  ensureDownloadLocationAccess,
  findDownloadedFileByBaseName,
  isRestrictedDownloadTree,
  LEGACY_SUBTITLE_EXTENSIONS,
  parseDownloadLocation,
  RESTRICTED_DOWNLOAD_LOCATION_MESSAGE,
  selectDownloadLocation,
  serializeDownloadLocation,
  UNREADABLE_DOWNLOAD_LOCATION_MESSAGE,
  validateDownloadLocationAccess,
} from '../src/lib/downloadLocation';
import * as FileSystem from 'expo-file-system/legacy';
import {Platform, ToastAndroid} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

const mockReadDirectory = FileSystem.StorageAccessFramework
  .readDirectoryAsync as jest.Mock;
const mockRequestDirectory = FileSystem.StorageAccessFramework
  .requestDirectoryPermissionsAsync as jest.Mock;
const mockToastShow = ToastAndroid.show as jest.Mock;

describe('Android SAF download location', () => {
  beforeEach(() => {
    (Platform as any).isTV = false;
    (Platform as any).OS = 'android';
    mockReadDirectory.mockReset();
    mockReadDirectory.mockResolvedValue([]);
    mockRequestDirectory.mockReset();
    mockRequestDirectory.mockResolvedValue({
      granted: true,
      directoryUri: 'content://downloads/tree/primary%3AMovies',
    });
    mockToastShow.mockReset();
  });

  afterEach(() => {
    (Platform as any).OS = 'android';
    (Platform as any).isTV = false;
  });

  it('does not activate a legacy raw path', () => {
    expect(
      parseDownloadLocation('/storage/emulated/0/Download/vega'),
    ).toBeNull();
  });

  it('uses Vega app storage by default on TV without opening SAF', async () => {
    (Platform as any).isTV = true;
    const location = parseDownloadLocation(null);
    expect(location).toEqual({
      type: 'path',
      path: '/app-files/Vega Downloads',
      label: 'Vega app storage',
    });
    expect(parseDownloadLocation('/old/phone/downloads')).toEqual(location);
    await expect(ensureDownloadLocationAccess(location)).resolves.toEqual(location);
    expect(mockRequestDirectory).not.toHaveBeenCalled();
  });

  it('restores a persisted SAF tree', () => {
    const location = {
      type: 'saf' as const,
      uri: 'content://downloads/tree',
      label: 'Downloads',
    };
    expect(parseDownloadLocation(serializeDownloadLocation(location))).toEqual(
      location,
    );
  });

  it('opens SAF when no valid location exists', async () => {
    await expect(ensureDownloadLocationAccess(null)).resolves.toEqual({
      type: 'saf',
      uri: 'content://downloads/tree/primary%3AMovies',
      label: 'Internal storage/Movies',
    });
    expect(mockRequestDirectory).toHaveBeenCalledTimes(1);
  });

  it('rejects a granted Downloads root or storage volume', async () => {
    const restrictedUris = [
      'content://downloads/tree/primary%3ADownload',
      'content://downloads/tree/primary%3A',
      'content://downloads/tree/primary%3ADownloads',
      'content://com.android.externalstorage.documents/tree/primary%3ADownload%2F',
      'content://com.android.externalstorage.documents/tree/primary%3Adownload',
      'content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload',
      'content://com.android.externalstorage.documents/tree/1234-5678%3A',
      'content://com.android.providers.downloads.documents/tree/downloads',
      'content://com.android.providers.downloads.documents/tree/raw%3A%2Fstorage%2Femulated%2F0%2FDownload',
      'content://com.android.providers.downloads.documents/tree/raw%3A%2Fstorage%2Femulated%2F0',
    ];

    for (const directoryUri of restrictedUris) {
      mockReadDirectory.mockClear();
      mockToastShow.mockClear();
      mockRequestDirectory.mockResolvedValue({granted: true, directoryUri});

      await expect(selectDownloadLocation()).resolves.toEqual({
        status: 'restricted',
      });
      await expect(ensureDownloadLocationAccess(null)).resolves.toBeUndefined();
      expect(mockReadDirectory).not.toHaveBeenCalled();
      expect(mockToastShow).toHaveBeenCalledWith(
        RESTRICTED_DOWNLOAD_LOCATION_MESSAGE,
        ToastAndroid.LONG,
      );
    }
  });

  it('accepts a folder inside Downloads, non-colon providers, and other granted folders', async () => {
    const grants = [
      {
        uri: 'content://downloads/tree/primary%3ADownload%2FVega',
        label: 'Internal storage/Download/Vega',
      },
      {
        uri: 'content://downloads/tree/primary%3AMovies',
        label: 'Internal storage/Movies',
      },
      {
        uri: 'content://com.android.providers.downloads.documents/tree/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2FVega',
        label: 'raw//storage/emulated/0/Download/Vega',
      },
      {
        uri: 'content://com.android.externalstorage.documents/tree/home%3A',
        label: 'home',
      },
      {
        uri: 'content://com.example.cloud.documents/tree/folder-id-without-colon',
        label: 'folder-id-without-colon',
      },
    ];

    for (const grant of grants) {
      mockRequestDirectory.mockResolvedValue({
        granted: true,
        directoryUri: grant.uri,
      });
      mockRequestDirectory.mockClear();

      await expect(selectDownloadLocation()).resolves.toEqual({
        status: 'selected',
        location: {type: 'saf', uri: grant.uri, label: grant.label},
      });
      expect(mockRequestDirectory).toHaveBeenCalledTimes(1);

      mockRequestDirectory.mockClear();
      await expect(ensureDownloadLocationAccess(null)).resolves.toEqual({
        type: 'saf',
        uri: grant.uri,
        label: grant.label,
      });
      expect(mockRequestDirectory).toHaveBeenCalledTimes(1);
    }

    expect(
      isRestrictedDownloadTree('content://com.example.provider/tree/%E0%A4%A'),
    ).toBe(false);
  });

  it('shows feedback when a selected non-restricted folder cannot be read', async () => {
    mockReadDirectory.mockRejectedValue(new Error('Permission denied'));
    mockRequestDirectory.mockResolvedValue({
      granted: true,
      directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FVega',
    });

    await expect(ensureDownloadLocationAccess(null)).resolves.toBeUndefined();
    expect(mockToastShow).toHaveBeenCalledWith(
      UNREADABLE_DOWNLOAD_LOCATION_MESSAGE,
      ToastAndroid.LONG,
    );
  });

  it('does not treat a stored Downloads root as already accessible', async () => {
    const root = {
      type: 'saf' as const,
      uri: 'content://downloads/tree/primary%3ADownload',
      label: 'Internal storage/Download',
    };
    await expect(validateDownloadLocationAccess(root)).resolves.toBe(false);
    expect(mockReadDirectory).not.toHaveBeenCalled();

    const child = {
      type: 'saf' as const,
      uri: 'content://downloads/tree/primary%3ADownload%2FVega',
      label: 'Internal storage/Download/Vega',
    };
    mockReadDirectory.mockResolvedValue(['content://child']);
    await expect(validateDownloadLocationAccess(child)).resolves.toBe(true);
    expect(mockReadDirectory).toHaveBeenCalledWith(child.uri);
  });

  it('keeps a cancelled folder picker cancelled', async () => {
    mockRequestDirectory.mockResolvedValue({
      granted: false,
      directoryUri: 'content://downloads/tree/primary%3ADownload',
    });
    await expect(selectDownloadLocation()).resolves.toEqual({
      status: 'cancelled',
    });

    (Platform as any).OS = 'ios';
    (RNFS.pickFile as jest.Mock).mockResolvedValue([]);
    await expect(selectDownloadLocation()).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('lets a folder picker failure reject', async () => {
    mockRequestDirectory.mockRejectedValue(new Error('picker failed'));
    await expect(selectDownloadLocation()).rejects.toThrow('picker failed');
  });
});

describe('legacy downloaded file lookup by base name', () => {
  const pathLocation = {type: 'path' as const, path: '/downloads'};
  const safLocation = {
    type: 'saf' as const,
    uri: 'content://downloads/tree/primary%3AMovies',
    label: 'Movies',
  };
  const mockReadDir = RNFS.readDir as jest.Mock;
  const mockUnlink = RNFS.unlink as jest.Mock;
  const mockDeleteAsync = FileSystem.StorageAccessFramework
    .deleteAsync as jest.Mock;
  const safEntry = (name: string) =>
    `content://downloads/tree/primary%3AMovies/document/primary%3AMovies%2F${encodeURIComponent(name)}`;
  const pathEntries = (...names: string[]) =>
    names.map(name => ({name, path: `/downloads/${name}`}));

  beforeEach(() => {
    mockReadDir.mockReset();
    mockUnlink.mockClear();
    mockDeleteAsync.mockClear();
    mockReadDirectory.mockReset();
  });

  it('ignores unrelated files that only share the base name', async () => {
    mockReadDir.mockResolvedValue(
      pathEntries('Inception.nfo', 'Inception.jpg', 'Inception.mkv.part'),
    );
    await expect(
      findDownloadedFileByBaseName(pathLocation, 'Inception'),
    ).resolves.toBe(false);

    mockReadDirectory.mockResolvedValue([
      safEntry('Inception.nfo'),
      safEntry('Inception.jpg'),
    ]);
    await expect(
      findDownloadedFileByBaseName(safLocation, 'Inception'),
    ).resolves.toBe(false);
  });

  it('matches only an exact video file name', async () => {
    mockReadDir.mockResolvedValue(
      pathEntries('Inception.nfo', 'Inception_2.mp4', 'Inception.mkv'),
    );
    await expect(
      findDownloadedFileByBaseName(pathLocation, 'Inception'),
    ).resolves.toBe('/downloads/Inception.mkv');

    mockReadDirectory.mockResolvedValue([
      safEntry('Inception.jpg'),
      safEntry('Inception.mp4'),
    ]);
    await expect(
      findDownloadedFileByBaseName(safLocation, 'Inception'),
    ).resolves.toBe(safEntry('Inception.mp4'));
  });

  it('never deletes non-video files that share the base name', async () => {
    mockReadDir.mockResolvedValue(pathEntries('Inception.nfo'));
    await expect(
      deleteDownloadedFileByBaseName(pathLocation, 'Inception'),
    ).resolves.toBe(false);
    expect(mockUnlink).not.toHaveBeenCalled();

    mockReadDirectory.mockResolvedValue([safEntry('Inception.jpg')]);
    await expect(
      deleteDownloadedFileByBaseName(safLocation, 'Inception'),
    ).resolves.toBe(false);
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  it('deletes legacy subtitles only when subtitle extensions are requested', async () => {
    mockReadDirectory.mockResolvedValue([
      safEntry('Inception_English.txt'),
      safEntry('Inception_English.srt'),
    ]);
    await expect(
      deleteDownloadedFileByBaseName(safLocation, 'Inception_English'),
    ).resolves.toBe(false);
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    await expect(
      deleteDownloadedFileByBaseName(
        safLocation,
        'Inception_English',
        LEGACY_SUBTITLE_EXTENSIONS,
      ),
    ).resolves.toBe(true);
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      safEntry('Inception_English.srt'),
    );
  });
});
