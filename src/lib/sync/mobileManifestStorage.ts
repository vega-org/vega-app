import * as FileSystem from 'expo-file-system/legacy';
import {NativeModules} from 'react-native';
import {settingsStorage} from '../storage';
import type {SafDownloadLocation} from '../downloadLocation';
import {
  parseSyncManifest,
  VEGA_SYNC_DIRECTORY,
  type VegaSyncManifest,
} from './manifest';

let manifestWriteQueue: Promise<void> = Promise.resolve();

const isSyncActive = () =>
  typeof settingsStorage?.isSyncEnabled === 'function'
    ? settingsStorage.isSyncEnabled()
    : true;

type DirectoryEntry = {uri: string; name: string; isDirectory: boolean};

const listDirectory = (uri: string): Promise<DirectoryEntry[]> => {
  const storage = NativeModules.VegaSyncStorage as
    | {listDirectory?: (directory: string) => Promise<DirectoryEntry[]>}
    | undefined;
  if (!storage?.listDirectory) {
    throw new Error('Update Vega to enable safe sync folder lookup');
  }
  return storage.listDirectory(uri);
};

const createDocument = (uri: string, name: string, directory: boolean) => {
  const storage = NativeModules.VegaSyncStorage as
    | {
        createDocument?: (
          parent: string,
          name: string,
          directory: boolean,
        ) => Promise<string>;
      }
    | undefined;
  if (!storage?.createDocument) {
    throw new Error('Update Vega to enable safe sync document creation');
  }
  return storage.createDocument(uri, name, directory);
};

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();

const findChild = async (
  directoryUri: string,
  name: string,
  kind?: 'directory' | 'file',
) => {
  const entries = (await listDirectory(directoryUri)).filter(
    entry => !kind || entry.isDirectory === (kind === 'directory'),
  );
  // 1. Exact match
  const exact = entries.find(entry => entry.name === name);
  if (exact) {
    return exact.uri;
  }
  // 2. Normalized match (ignores case, underscores, spaces, dashes)
  const targetNorm = normalizeName(name);
  const normalized = entries.find(
    entry => normalizeName(entry.name) === targetNorm,
  );
  if (normalized) {
    return normalized.uri;
  }
  // Sync directories and device manifests must never adopt a different
  // filename just because its stem happens to match.
  if (kind) return undefined;
  // 3. Stem match without extension
  const nameStem = name.includes('.')
    ? name.slice(0, name.lastIndexOf('.'))
    : name;
  const stemNorm = normalizeName(nameStem);
  return entries.find(entry => {
    const entryName = entry.name;
    const entryStem = entryName.includes('.')
      ? entryName.slice(0, entryName.lastIndexOf('.'))
      : entryName;
    return normalizeName(entryStem) === stemNorm;
  })?.uri;
};

const getSyncDirectory = async (
  location: SafDownloadLocation,
  create: boolean,
): Promise<string | null> => {
  const existing = await findChild(
    location.uri,
    VEGA_SYNC_DIRECTORY,
    'directory',
  );
  if (existing) {
    return existing;
  }
  if (!create || !isSyncActive()) {
    return null;
  }
  return createDocument(location.uri, VEGA_SYNC_DIRECTORY, true);
};

export const readMobileSyncManifests = async (
  location: SafDownloadLocation,
): Promise<VegaSyncManifest[]> => {
  if (!isSyncActive()) {
    return [];
  }
  const directory = await getSyncDirectory(location, false);
  if (!directory) {
    return [];
  }
  const entries = await listDirectory(directory);
  const manifests = await Promise.all(
    entries
      .filter(
        entry =>
          !entry.isDirectory && entry.name.toLowerCase().endsWith('.json'),
      )
      .map(async entry => {
        const content =
          await FileSystem.StorageAccessFramework.readAsStringAsync(entry.uri);
        return parseSyncManifest(content);
      }),
  );
  return manifests.filter(
    (manifest): manifest is VegaSyncManifest => manifest !== null,
  );
};

const readManifestFile = async (
  fileUri: string,
): Promise<VegaSyncManifest | null> => {
  try {
    return parseSyncManifest(
      await FileSystem.StorageAccessFramework.readAsStringAsync(fileUri),
    );
  } catch {
    return null;
  }
};

/**
 * Decides whether the manifest already in the folder under this device id may
 * be replaced. Returning false means another install wrote it.
 */
export type CanOverwriteSyncManifest = (current: VegaSyncManifest) => boolean;

const writeMobileSyncManifestNow = async (
  location: SafDownloadLocation,
  manifest: VegaSyncManifest,
  canOverwrite?: CanOverwriteSyncManifest,
): Promise<boolean> => {
  if (!isSyncActive()) {
    return false;
  }
  const directory = await getSyncDirectory(location, true);
  if (!directory) {
    throw new Error('Unable to create Vega sync directory');
  }
  const fileName = `vega-${manifest.deviceId}.json`;
  const existing = await findChild(directory, fileName, 'file');
  if (existing && canOverwrite) {
    const current = await readManifestFile(existing);
    if (current?.deviceId === manifest.deviceId && !canOverwrite(current)) {
      return false;
    }
  }
  const fileUri =
    existing || (await createDocument(directory, fileName, false));
  const content = JSON.stringify(manifest);
  const writer = NativeModules.VegaSyncStorage as
    | {writeManifest: (uri: string, text: string) => Promise<void>}
    | undefined;
  if (!writer)
    throw new Error('Update Vega to enable safe sync document writes');
  await writer.writeManifest(fileUri, content);
  const written =
    await FileSystem.StorageAccessFramework.readAsStringAsync(fileUri);
  if (written !== content || !parseSyncManifest(written)) {
    throw new Error('Vega sync manifest verification failed');
  }
  return true;
};

/**
 * Writes the manifest of this device. Resolves false, without writing, when
 * canOverwrite rejects the manifest already stored under the same device id.
 * The check runs inside the write queue, after earlier writes finished.
 */
export const writeMobileSyncManifest = (
  location: SafDownloadLocation,
  manifest: VegaSyncManifest,
  canOverwrite?: CanOverwriteSyncManifest,
): Promise<boolean> => {
  if (!isSyncActive()) {
    return Promise.resolve(false);
  }
  const write = manifestWriteQueue.then(() =>
    writeMobileSyncManifestNow(location, manifest, canOverwrite),
  );
  manifestWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
};

export const resolveMobileSyncFile = async (
  location: SafDownloadLocation,
  relativePath: string,
): Promise<string | null> => {
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..');
  let current = location.uri;
  for (const segment of segments) {
    const child = await findChild(current, segment);
    if (!child) {
      return null;
    }
    current = child;
  }
  if (current !== location.uri) {
    return current;
  }
  return null;
};

export const resolveMobileSyncFileWithLegacyFallback = async (
  location: SafDownloadLocation,
  relativePath: string,
): Promise<string | null> => {
  const resolved = await resolveMobileSyncFile(location, relativePath);
  if (resolved) {
    return resolved;
  }
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) {
    return null;
  }
  if (segments.length > 1) {
    const legacyShowPath = [...segments.slice(0, 1), fileName].join('/');
    const legacyShowFile = await resolveMobileSyncFile(
      location,
      legacyShowPath,
    );
    if (legacyShowFile) {
      return legacyShowFile;
    }
  }
  return (await findChild(location.uri, fileName)) || null;
};
