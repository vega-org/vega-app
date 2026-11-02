import {describe, expect, it, jest, beforeEach} from '@jest/globals';

const mockBooleanValues = new Map<string, boolean>();
const mockStringValues = new Map<string, string>();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getBool: (key: string, defaultValue = false) =>
      mockBooleanValues.has(key) ? mockBooleanValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockBooleanValues.set(key, value),
    getString: (key: string) => mockStringValues.get(key),
    setString: (key: string, value: string) => mockStringValues.set(key, value),
    getNumber: () => undefined,
    setNumber: jest.fn(),
    getArray: () => undefined,
    setArray: jest.fn(),
    delete: jest.fn(),
  },
  registerStorageClearHook: jest.fn(),
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

const mockStartByeDpi = jest.fn();
const mockStopByeDpi = jest.fn();
const mockGetStatus = jest.fn();
const mockStopWarp = jest.fn();

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
  NativeModules: {
    ByeDpiModule: {
      startByeDpi: (args?: string) => mockStartByeDpi(args),
      stopByeDpi: () => mockStopByeDpi(),
      getStatus: () => mockGetStatus(),
    },
    WarpModule: {
      stopWarp: () => mockStopWarp(),
    },
  },
  ToastAndroid: {
    show: jest.fn(),
    SHORT: 0,
    LONG: 1,
  },
}));

import {settingsStorage} from '../src/lib/storage/SettingsStorage';
import {
  isByeDpiSupported,
  startByeDpi,
  stopByeDpi,
  restartByeDpi,
  toggleByeDpi,
  syncByeDpiSettings,
  DEFAULT_BYEDPI_ARGS,
  BYEDPI_PRESETS,
} from '../src/lib/services/byeDpiService';

describe('ByeDPI service & storage', () => {
  beforeEach(() => {
    mockBooleanValues.clear();
    mockStringValues.clear();
    jest.clearAllMocks();
  });

  it('defaults byedpi to enabled', () => {
    expect(settingsStorage.isByeDpiEnabled()).toBe(true);
  });

  it('toggles byedpi storage value', () => {
    settingsStorage.setByeDpiEnabled(true);
    expect(settingsStorage.isByeDpiEnabled()).toBe(true);

    settingsStorage.setByeDpiEnabled(false);
    expect(settingsStorage.isByeDpiEnabled()).toBe(false);
  });

  it('stores and retrieves custom cmd args', () => {
    expect(settingsStorage.getByeDpiCmdArgs()).toBe('');
    settingsStorage.setByeDpiCmdArgs('--split 2 --disorder 3');
    expect(settingsStorage.getByeDpiCmdArgs()).toBe('--split 2 --disorder 3');
  });

  it('detects byedpi support on android with ByeDpiModule', () => {
    expect(isByeDpiSupported()).toBe(true);
  });

  it('starts byedpi with default args if none provided', async () => {
    mockStartByeDpi.mockResolvedValueOnce({running: true, port: 1080});
    const status = await startByeDpi();
    expect(mockStartByeDpi).toHaveBeenCalledWith(DEFAULT_BYEDPI_ARGS);
    expect(status).toEqual({running: true, port: 1080});
  });

  it('starts byedpi with custom args if specified in storage', async () => {
    settingsStorage.setByeDpiCmdArgs('--split 1 --disorder 1');
    mockStartByeDpi.mockResolvedValueOnce({running: true, port: 1080});
    const status = await startByeDpi();
    expect(mockStartByeDpi).toHaveBeenCalledWith('--split 1 --disorder 1');
    expect(status).toEqual({running: true, port: 1080});
  });

  it('disables warp and stops warp when byedpi is toggled on', async () => {
    settingsStorage.setWarpEnabled(true);
    mockStartByeDpi.mockResolvedValueOnce({running: true, port: 1080});
    mockStopWarp.mockResolvedValueOnce({running: false});

    const status = await toggleByeDpi(true);
    expect(settingsStorage.isByeDpiEnabled()).toBe(true);
    expect(settingsStorage.isWarpEnabled()).toBe(false);
    expect(mockStopWarp).toHaveBeenCalledTimes(1);
    expect(mockStartByeDpi).toHaveBeenCalledTimes(1);
    expect(status).toEqual({running: true, port: 1080});
  });

  it('stops byedpi when toggled off', async () => {
    settingsStorage.setByeDpiEnabled(true);
    mockStopByeDpi.mockResolvedValueOnce({running: false});

    const status = await toggleByeDpi(false);
    expect(settingsStorage.isByeDpiEnabled()).toBe(false);
    expect(mockStopByeDpi).toHaveBeenCalledTimes(1);
    expect(status).toEqual({running: false});
  });

  it('stops the running process before starting with new args', async () => {
    const calls: string[] = [];
    mockStopByeDpi.mockImplementationOnce(async () => {
      calls.push('stop');
      return {running: false};
    });
    mockStartByeDpi.mockImplementationOnce(async (args?: string) => {
      calls.push(`start:${args}`);
      return {running: true, port: 1081};
    });

    const status = await restartByeDpi('--split 2');
    expect(calls).toEqual(['stop', 'start:--split 2']);
    expect(status).toEqual({running: true, port: 1081});
  });

  it('does not start again when stopping fails during restart', async () => {
    mockStopByeDpi.mockImplementationOnce(async () => {
      throw new Error('stop failed');
    });

    await expect(restartByeDpi('--split 2')).rejects.toThrow('stop failed');
    expect(mockStartByeDpi).not.toHaveBeenCalled();
  });

  it('syncs byedpi settings on startup when enabled', async () => {
    settingsStorage.setByeDpiEnabled(true);
    mockStartByeDpi.mockResolvedValueOnce({running: true, port: 1080});
    await syncByeDpiSettings();
    expect(mockStartByeDpi).toHaveBeenCalledTimes(1);
  });

  it('exposes well-formed presets including recommended default', () => {
    expect(BYEDPI_PRESETS.length).toBeGreaterThanOrEqual(4);
    const recommended = BYEDPI_PRESETS.find(p => p.id === 'split_disorder');
    expect(recommended).toBeDefined();
    expect(recommended?.args).toBe(DEFAULT_BYEDPI_ARGS);
  });
});
