import * as RNFS from '@dr.pogodin/react-native-fs';
import * as FileSystem from 'expo-file-system/legacy';
import {NativeModules, Platform, ToastAndroid} from 'react-native';
import {sanitizeDownloadFileName} from './downloadId';

export type PathDownloadLocation = {
  type: 'path';
  path: string;
  label?: string;
};

export type SafDownloadLocation = {
  type: 'saf';
  uri: string;
  label: string;
};

export type DownloadLocationConfig = PathDownloadLocation | SafDownloadLocation;

const DOWNLOAD_LOCATION_PREFIX = 'download-location:';

export const getTVDefaultDownloadLocation = (): PathDownloadLocation => ({
  type: 'path',
  path: `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/Vega Downloads`,
  label: 'Vega app storage',
});

export const serializeDownloadLocation = (
  config: DownloadLocationConfig,
): string => {
  return `${DOWNLOAD_LOCATION_PREFIX}${JSON.stringify(config)}`;
};

export const parseDownloadLocation = (
  storedValue?: string | null,
): DownloadLocationConfig | null => {
  if (!storedValue) {
    return Platform.isTV ? getTVDefaultDownloadLocation() : null;
  }

  if (!storedValue.startsWith(DOWNLOAD_LOCATION_PREFIX)) {
    if (Platform.OS === 'android') {
      return Platform.isTV ? getTVDefaultDownloadLocation() : null;
    }
    return {
      type: 'path',
      path: storedValue,
      label: storedValue,
    };
  }

  try {
    const parsed = JSON.parse(
      storedValue.slice(DOWNLOAD_LOCATION_PREFIX.length),
    ) as DownloadLocationConfig;

    if (parsed.type === 'saf' && parsed.uri && parsed.label) {
      return parsed;
    }

    if (parsed.type === 'path' && parsed.path &&
        (Platform.OS !== 'android' ||
          (Platform.isTV && parsed.path === getTVDefaultDownloadLocation().path))) {
      return {
        type: 'path',
        path: parsed.path,
        label: parsed.label || parsed.path,
      };
    }
  } catch (error) {
    console.log('Failed to parse download location:', error);
  }

  return Platform.isTV ? getTVDefaultDownloadLocation() : null;
};

export const isSafDownloadLocation = (
  config: DownloadLocationConfig,
): config is SafDownloadLocation => {
  return config.type === 'saf';
};

export const getDownloadLocationDisplayValue = (
  config?: DownloadLocationConfig | null,
): string => {
  if (!config) {
    return 'Select a download folder';
  }
  return config.type === 'saf' ? config.label : config.label || config.path;
};

export const getDownloadLocationPath = (
  config?: DownloadLocationConfig | null,
): string | null => {
  return config?.type === 'path' ? config.path : null;
};

export const getAndroidDirectoryLabel = (directoryUri: string): string => {
  const treeMarker = '/tree/';
  const treeIndex = directoryUri.indexOf(treeMarker);
  if (treeIndex === -1) {
    return 'Custom folder';
  }

  const documentId = decodeURIComponent(
    directoryUri.slice(treeIndex + treeMarker.length),
  );
  const [volume, relativePath = ''] = documentId.split(':');
  if (!relativePath) {
    return volume === 'primary' ? 'Internal storage' : volume;
  }
  return `${volume === 'primary' ? 'Internal storage' : volume}/${relativePath}`;
};

// Android will not keep the volume root or the Downloads directory itself.
// A child such as primary:Download/Vega stays valid.
export const RESTRICTED_DOWNLOAD_LOCATION_MESSAGE =
  'Choose a subfolder (such as a folder inside Downloads) instead of the storage or Downloads root';

export const UNREADABLE_DOWNLOAD_LOCATION_MESSAGE =
  'Vega could not access that folder. Choose a different subfolder';

const showAndroidToast = (message: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid?.show?.(message, ToastAndroid.LONG);
  }
};

export const isRestrictedDownloadTree = (directoryUri: string): boolean => {
  const treeMarker = '/tree/';
  const treeIndex = directoryUri.indexOf(treeMarker);
  if (treeIndex === -1) {
    return false;
  }

  const authority = directoryUri
    .slice(0, treeIndex)
    .replace(/^content:\/\//i, '')
    .toLowerCase();
  const rawTreeSegment = directoryUri
    .slice(treeIndex + treeMarker.length)
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];

  let documentId: string;
  try {
    documentId = decodeURIComponent(rawTreeSegment);
  } catch {
    return false;
  }

  const trimmedDocId = documentId.trim();
  const colonIndex = trimmedDocId.indexOf(':');
  if (colonIndex === -1) {
    const normalizedId = trimmedDocId.replace(/^\/+|\/+$/g, '').toLowerCase();
    return (
      authority.includes('downloads') &&
      (normalizedId === 'downloads' || normalizedId === 'download')
    );
  }

  const volume = trimmedDocId.slice(0, colonIndex).trim().toLowerCase();
  const relativePath = trimmedDocId
    .slice(colonIndex + 1)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  if (volume === 'home') {
    return false;
  }

  if (volume === 'raw') {
    return (
      !relativePath ||
      /^(?:storage\/emulated\/\d+|storage\/[^/]+|sdcard)(?:\/downloads?)?$/.test(
        relativePath,
      )
    );
  }

  return (
    !relativePath ||
    relativePath === 'download' ||
    relativePath === 'downloads'
  );
};

export type DownloadLocationSelection =
  | {status: 'selected'; location: DownloadLocationConfig}
  | {status: 'cancelled'}
  | {status: 'restricted'};

export const selectDownloadLocation =
  async (): Promise<DownloadLocationSelection> => {
    if (Platform.OS === 'android') {
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        return {status: 'cancelled'};
      }
      if (isRestrictedDownloadTree(permissions.directoryUri)) {
        return {status: 'restricted'};
      }
      return {
        status: 'selected',
        location: {
          type: 'saf',
          uri: permissions.directoryUri,
          label: getAndroidDirectoryLabel(permissions.directoryUri),
        },
      };
    }

    const pickedFolders = await RNFS.pickFile({pickerType: 'folder'});
    const pickedFolder = pickedFolders[0];
    if (!pickedFolder) {
      return {status: 'cancelled'};
    }
    const path = pickedFolder.replace(/^file:\/\//, '');
    return {status: 'selected', location: {type: 'path', path, label: path}};
  };

export const validateDownloadLocationAccess = async (
  location?: DownloadLocationConfig | null,
): Promise<boolean> => {
  if (!location) {
    return false;
  }
  try {
    if (location.type === 'saf') {
      if (isRestrictedDownloadTree(location.uri)) {
        return false;
      }
      await FileSystem.StorageAccessFramework.readDirectoryAsync(location.uri);
      return true;
    }
    if (Platform.OS === 'android' &&
        (!Platform.isTV || location.path !== getTVDefaultDownloadLocation().path)) {
      return false;
    }
    if (!(await RNFS.exists(location.path))) {
      await RNFS.mkdir(location.path);
    }
    return true;
  } catch (error) {
    console.log('Download location is unavailable:', error);
    return false;
  }
};

export const ensureDownloadLocationAccess = async (
  location?: DownloadLocationConfig | null,
): Promise<DownloadLocationConfig | undefined> => {
  if (await validateDownloadLocationAccess(location)) {
    return location || undefined;
  }
  const picked = await selectDownloadLocation();
  if (picked.status === 'restricted') {
    showAndroidToast(RESTRICTED_DOWNLOAD_LOCATION_MESSAGE);
    return undefined;
  }
  if (picked.status !== 'selected') {
    return undefined;
  }
  if (await validateDownloadLocationAccess(picked.location)) {
    return picked.location;
  }
  showAndroidToast(UNREADABLE_DOWNLOAD_LOCATION_MESSAGE);
  return undefined;
};

export const getDownloadFileName = (fileName: string, fileType: string) => {
  return `${sanitizeDownloadFileName(fileName)}.${fileType}`;
};

export const getSafEntryName = (entryUri: string): string => {
  const decodedUri = decodeURIComponent(entryUri).replace(/\/+$/, '');
  const lastSlash = decodedUri.lastIndexOf('/');
  const afterSlash =
    lastSlash !== -1 ? decodedUri.slice(lastSlash + 1) : decodedUri;
  const lastColon = afterSlash.lastIndexOf(':');
  return lastColon !== -1 ? afterSlash.slice(lastColon + 1) : afterSlash;
};

export const getOrCreateSafDirectory = async (
  parentUri: string,
  directoryName: string,
): Promise<string> => {
  const entries =
    await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri);
  const existing = entries.find(
    entry => getSafEntryName(entry) === directoryName,
  );
  return (
    existing ||
    FileSystem.StorageAccessFramework.makeDirectoryAsync(
      parentUri,
      directoryName,
    )
  );
};

export const findSafEntryByName = async (
  parentUri: string,
  entryName: string,
): Promise<string | undefined> => {
  const entries =
    await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri);
  return entries.find(entry => getSafEntryName(entry) === entryName);
};

// Extensions Vega itself writes for legacy downloads stored in the folder root.
// Matching is limited to these so unrelated user files that merely share the
// base name (e.g. Inception.nfo, Inception.jpg) are never adopted or deleted.
export const LEGACY_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi'];
export const LEGACY_SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass'];

const isLegacyDownloadName = (
  entryName: string,
  fileName: string,
  extensions: string[],
) => extensions.some(ext => entryName === `${fileName}.${ext}`);

export const findDownloadedFileByBaseName = async (
  location: DownloadLocationConfig | null,
  fileName: string,
  extensions: string[] = LEGACY_VIDEO_EXTENSIONS,
) => {
  if (!location) {
    return false;
  }
  try {
    if (location.type === 'path') {
      const files = await RNFS.readDir(location.path);

      const file = files.find(fileItem =>
        isLegacyDownloadName(fileItem.name, fileName, extensions),
      );

      return file ? file.path : false;
    }

    const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(
      location.uri,
    );

    const file = files.find(fileUri =>
      isLegacyDownloadName(getSafEntryName(fileUri), fileName, extensions),
    );

    return file || false;
  } catch (error) {
    console.log('Error reading download location:', error);
    return false;
  }
};

export const getDownloadMimeType = (fileType: string) => {
  switch (fileType.toLowerCase()) {
    case 'mp4':
      return 'video/mp4';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'srt':
      return 'application/x-subrip';
    case 'vtt':
      return 'text/vtt';
    case 'ass':
      return 'text/plain';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
};

export const copyFileToSaf = async ({
  fromPath,
  directoryUri,
  fileName,
  fileType,
}: {
  fromPath: string;
  directoryUri: string;
  fileName: string;
  fileType: string;
}) => {
  const targetFileName = getDownloadFileName(fileName, fileType);
  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    targetFileName,
    getDownloadMimeType(fileType),
  );

  const safCopyModule = NativeModules.SafCopyModule as
    | {
        copyFileToUri: (
          fromFilePath: string,
          toFileUri: string,
        ) => Promise<void>;
      }
    | undefined;

  try {
    if (!safCopyModule?.copyFileToUri) {
      throw new Error('SAF file copy bridge is unavailable');
    }

    await safCopyModule.copyFileToUri(fromPath, fileUri);
    return fileUri;
  } catch (error) {
    await FileSystem.StorageAccessFramework.deleteAsync(fileUri).catch(() => {
      return;
    });
    throw error;
  }
};

export const deleteDownloadedFileByBaseName = async (
  location: DownloadLocationConfig | null,
  fileName: string,
  extensions: string[] = LEGACY_VIDEO_EXTENSIONS,
) => {
  const foundFile = await findDownloadedFileByBaseName(
    location,
    fileName,
    extensions,
  );

  if (!foundFile) {
    return false;
  }

  if (location?.type === 'path') {
    await RNFS.unlink(foundFile);
    return true;
  }

  await FileSystem.StorageAccessFramework.deleteAsync(foundFile);
  return true;
};
