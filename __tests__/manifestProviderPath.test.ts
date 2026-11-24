import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('axios', () => ({get: jest.fn()}));

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {getString: jest.fn(), delete: jest.fn()},
}));

jest.mock('../src/lib/storage/sourceTokenStorage', () => ({
  getSourceAuthHeaders: () => ({}),
  sourceTokenStorage: {has: () => false},
}));

jest.mock('../src/lib/storage/extensionStorage', () => ({
  extensionStorage: {
    getProviderSources: () => [],
    getProviderSource: () => undefined,
    isManifestCacheExpired: () => true,
    getManifestCache: () => [],
    setManifestCache: jest.fn(),
    setAvailableProviders: jest.fn(),
  },
}));

import axios from 'axios';
import {extensionManager} from '../src/lib/services/ExtensionManager';

const mockGet = axios.get as unknown as jest.Mock<any>;
const source = {author: 'foo', url: 'https://example.com/repo'};

const entry = (value: string, extra: Record<string, unknown> = {}) => ({
  value,
  display_name: value,
  version: '1.0.0',
  ...extra,
});

describe('fetchManifest provider path', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('flags only providers with a boolean adult declaration', async () => {
    mockGet.mockResolvedValue({data: [
      entry('adult', {adult: true}),
      entry('legacy'),
      entry('invalid', {adult: 'true'}),
    ]});
    const providers = await extensionManager.fetchManifest(source, true);
    expect(providers.map(provider => provider.adult)).toEqual([true, false, false]);
  });

  it('keeps entries whose optional path is missing, null or empty', async () => {
    mockGet.mockResolvedValue({
      data: [
        entry('absent'),
        entry('nullPath', {path: null}),
        entry('emptyPath', {path: ''}),
        entry('nested', {path: 'providers/nested'}),
        entry('escape', {path: '../outside'}),
      ],
    });

    const providers = await extensionManager.fetchManifest(source, true);

    expect(providers.map(p => p.value)).toEqual([
      'absent',
      'nullPath',
      'emptyPath',
      'nested',
    ]);
    const byValue = Object.fromEntries(providers.map(p => [p.value, p]));
    expect('path' in byValue.nullPath).toBe(false);
    expect('path' in byValue.emptyPath).toBe(false);
    expect(byValue.nested.path).toBe('providers/nested');
  });
});
