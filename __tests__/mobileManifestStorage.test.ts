import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import type {VegaSyncManifest} from '../src/lib/sync/manifest';

type Entry = {uri: string; name: string; isDirectory: boolean};
const mockEntries = new Map<string, Entry[]>();
const mockFiles = new Map<string, string>();
const mockFailure = new Set<string>();
let mockNextId = 0;
const mockList = jest.fn(async (uri: string) => {
  if (mockFailure.has(uri)) throw new Error('Directory unavailable');
  if (!mockEntries.has(uri)) throw new Error('Directory missing');
  return mockEntries.get(uri)!;
});
const mockCreate = jest.fn(
  async (parent: string, name: string, directory: boolean) => {
    const uri = `content://provider/tree/root/document/opaque-${++mockNextId}`;
    mockEntries.get(parent)!.push({uri, name, isDirectory: directory});
    if (directory) mockEntries.set(uri, []);
    else mockFiles.set(uri, '');
    return uri;
  },
);
const mockNative = {
  listDirectory: mockList,
  createDocument: mockCreate,
  writeManifest: jest.fn(async (uri: string, text: string) => {
    mockFiles.set(uri, text);
  }),
};

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isSyncEnabled: () => true,
  },
}));
jest.mock('react-native', () => ({
  NativeModules: {
    get VegaSyncStorage() {
      return mockNative;
    },
  },
}));
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    // Legacy APIs return the grant root for nested directory URIs. Sync must
    // use native document ids instead, including for creation.
    readDirectoryAsync: jest.fn(() => {
      throw new Error('Unsafe legacy listing');
    }),
    makeDirectoryAsync: jest.fn(() => {
      throw new Error('Unsafe legacy creation');
    }),
    createFileAsync: jest.fn(() => {
      throw new Error('Unsafe legacy creation');
    }),
    readAsStringAsync: async (uri: string) => {
      if (!mockFiles.has(uri)) throw new Error('File missing');
      return mockFiles.get(uri)!;
    },
  },
}));

import {
  readMobileSyncManifests,
  resolveMobileSyncFile,
  writeMobileSyncManifest,
} from '../src/lib/sync/mobileManifestStorage';

const location = {
  type: 'saf' as const,
  uri: 'content://provider/tree/root/document/selected',
  label: 'Sync',
};
const manifest = (revision = 1): VegaSyncManifest => ({
  schemaVersion: 1,
  deviceId: 'phone',
  revision,
  generatedAt: revision,
  downloads: {},
  history: {},
  watchlist: {},
  tombstones: {},
});

beforeEach(() => {
  mockEntries.clear();
  mockFiles.clear();
  mockFailure.clear();
  mockNextId = 0;
  mockEntries.set(location.uri, []);
  mockList.mockClear();
  mockCreate.mockClear();
  mockNative.writeManifest.mockReset();
  mockNative.writeManifest.mockImplementation(async (uri, text) => {
    mockFiles.set(uri, text);
  });
});

describe('sync document storage', () => {
  it('reuses one folder and manifest across 40 writes with opaque document ids', async () => {
    for (let revision = 1; revision <= 40; revision++) {
      await writeMobileSyncManifest(location, manifest(revision));
    }
    expect(mockCreate.mock.calls.map(call => call.slice(1))).toEqual([
      ['.vega-sync', true],
      ['vega-phone.json', false],
    ]);
    const directory = mockEntries.get(location.uri)![0].uri;
    expect(mockCreate.mock.calls[1][0]).toBe(directory);
    expect(await readMobileSyncManifests(location)).toEqual([manifest(40)]);
  });

  it('serializes simultaneous writes so only one folder and file are created', async () => {
    await Promise.all(
      Array.from({length: 32}, (_, i) =>
        writeMobileSyncManifest(location, manifest(i + 1)),
      ),
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await readMobileSyncManifests(location)).toEqual([manifest(32)]);
  });

  it('does not create another folder when listing fails and recovers on retry', async () => {
    mockFailure.add(location.uri);
    await expect(writeMobileSyncManifest(location, manifest())).rejects.toThrow(
      'Directory unavailable',
    );
    expect(mockCreate).not.toHaveBeenCalled();
    mockFailure.clear();
    await writeMobileSyncManifest(location, manifest(2));
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('does not create a duplicate manifest if the existing folder cannot be read', async () => {
    await writeMobileSyncManifest(location, manifest());
    mockFailure.add(mockEntries.get(location.uri)![0].uri);
    await expect(
      writeMobileSyncManifest(location, manifest(2)),
    ).rejects.toThrow('Directory unavailable');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('uses the exact folder and leaves numbered duplicates untouched', async () => {
    await mockCreate(location.uri, '.vega-sync (1)', true);
    await mockCreate(location.uri, '.vega-sync', true);
    const canonical = mockEntries.get(location.uri)![1].uri;
    mockCreate.mockClear();
    await writeMobileSyncManifest(location, manifest());
    expect(mockCreate).toHaveBeenCalledWith(
      canonical,
      'vega-phone.json',
      false,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a similarly named file for the sync directory', async () => {
    await mockCreate(location.uri, '.vega-sync', false);
    mockCreate.mockClear();
    await writeMobileSyncManifest(location, manifest());
    expect(mockCreate.mock.calls[0]).toEqual([
      location.uri,
      '.vega-sync',
      true,
    ]);
  });

  it('never adopts another file extension as the device manifest', async () => {
    const directory = await mockCreate(location.uri, '.vega-sync', true);
    await mockCreate(directory, 'vega-phone.txt', false);
    mockCreate.mockClear();
    await writeMobileSyncManifest(location, manifest());
    expect(mockCreate).toHaveBeenCalledWith(
      directory,
      'vega-phone.json',
      false,
    );
  });

  it('retains the ownership check with display-name lookup', async () => {
    await writeMobileSyncManifest(location, manifest());
    expect(
      await writeMobileSyncManifest(location, manifest(2), () => false),
    ).toBe(false);
    expect(await readMobileSyncManifests(location)).toEqual([manifest()]);
  });

  it('overwrites the same document without deleting or creating a replacement', async () => {
    await writeMobileSyncManifest(location, manifest());
    const file = [...mockFiles.keys()][0];
    mockCreate.mockClear();
    await writeMobileSyncManifest(location, manifest(2));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNative.writeManifest).toHaveBeenLastCalledWith(
      file,
      JSON.stringify(manifest(2)),
    );
    expect(mockFiles.size).toBe(1);
  });

  it('rejects a write when a provider leaves trailing old content', async () => {
    mockNative.writeManifest.mockImplementation(async (uri, text) => {
      mockFiles.set(uri, text + 'old trailing JSON');
    });
    await expect(writeMobileSyncManifest(location, manifest())).rejects.toThrow(
      'verification failed',
    );
  });

  it('does not recreate documents when writing fails', async () => {
    await writeMobileSyncManifest(location, manifest());
    mockNative.writeManifest.mockRejectedValueOnce(new Error('Write denied'));
    await expect(
      writeMobileSyncManifest(location, manifest(2)),
    ).rejects.toThrow('Write denied');
    await writeMobileSyncManifest(location, manifest(3));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await readMobileSyncManifests(location)).toEqual([manifest(3)]);
  });

  it('ignores directories named with a JSON extension', async () => {
    const directory = await mockCreate(location.uri, '.vega-sync', true);
    await mockCreate(directory, 'unrelated.json', true);
    await writeMobileSyncManifest(location, manifest());
    expect(await readMobileSyncManifests(location)).toEqual([manifest()]);
  });

  it('resolves nested media using real display names and document ids', async () => {
    const show = await mockCreate(location.uri, 'Show', true);
    const season = await mockCreate(show, 'Season 1', true);
    const video = await mockCreate(season, 'Episode 1.mkv', false);
    expect(
      await resolveMobileSyncFile(location, 'Show/Season 1/Episode 1.mkv'),
    ).toBe(video);
    expect(
      await resolveMobileSyncFile(location, 'Show/Season 2/Episode 1.mkv'),
    ).toBeNull();
  });
});
