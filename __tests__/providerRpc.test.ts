import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: {
    MD5: 'MD5',
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
  },
}));

jest.mock('../src/lib/providers/getBaseUrl', () => ({
  getBaseUrl: jest.fn(),
}));

jest.mock('../src/lib/services/wafResolver', () => ({
  openWebView: jest.fn(),
}));

jest.mock('../src/lib/sandbox/providerFetch', () => ({
  providerFetch: jest.fn(),
}));

const mockStorageMap = new Map<string, string>();

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    private instanceId = 'default';

    withInstanceID(instanceId: string) {
      this.instanceId = instanceId;
      return this;
    }

    initialize() {
      return {
        clearStore: () => mockStorageMap.clear(),
        getString: (key: string) => mockStorageMap.get(key),
        setString: (key: string, value: string) => mockStorageMap.set(key, value),
        removeItem: (key: string) => mockStorageMap.delete(key),
        getBool: jest.fn(),
        getInt: jest.fn(),
        setBool: jest.fn(),
        setInt: jest.fn(),
        indexer: {
          getKeys: async () => Array.from(mockStorageMap.keys()),
        },
      };
    }
  },
}));

import {handleProviderRpc} from '../src/lib/sandbox/providerRpc';
import {openWebView} from '../src/lib/services/wafResolver';

const mockOpenWebView = jest.mocked(openWebView);

describe('providerRpc openWebView', () => {
  beforeEach(() => {
    mockOpenWebView.mockReset();
    mockStorageMap.clear();
  });

  it('returns cookies scoped to a validated third-party challenge URL', async () => {
    const result = {
      data: '<html></html>',
      cookies: 'cf_clearance=mobile-token',
      cookieMap: {cf_clearance: 'mobile-token'},
      userAgent: 'Vega Test',
      url: 'https://drive.example.com',
    };
    mockOpenWebView.mockResolvedValue(result);

    await expect(
      handleProviderRpc('uhd', 'alice', 'openWebView', {
        url: result.url,
        options: {waitForCookie: 'cf_clearance'},
      }),
    ).resolves.toEqual({...result, cookie: result.cookies});
    expect(mockOpenWebView).toHaveBeenCalledWith(
      `${result.url}/`,
      {waitForCookie: 'cf_clearance'},
      'alice',
      undefined,
      'uhd',
    );
  });
});

describe('providerRpc KV store operations', () => {
  beforeEach(() => {
    mockStorageMap.clear();
  });

  it('sets and gets KV entries properly', async () => {
    await handleProviderRpc('uhd', 'alice', 'kvSet', {
      key: 'auth_session',
      value: {token: 'abc123xyz', expires: 999999},
    });

    const stored = await handleProviderRpc('uhd', 'alice', 'kvGet', {
      key: 'auth_session',
    });
    expect(stored).toEqual({token: 'abc123xyz', expires: 999999});
  });

  it('returns undefined for non-existent key', async () => {
    const stored = await handleProviderRpc('uhd', 'alice', 'kvGet', {
      key: 'non_existent',
    });
    expect(stored).toBeUndefined();
  });

  it('deletes KV entries and lists keys', async () => {
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'key1', value: 'val1'});
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'key2', value: 'val2'});

    const keys = await handleProviderRpc('uhd', 'alice', 'kvKeys', {});
    expect(keys).toEqual(['key1', 'key2']);

    const deleted = await handleProviderRpc('uhd', 'alice', 'kvDelete', {key: 'key1'});
    expect(deleted).toBe(true);

    const remainingKeys = await handleProviderRpc('uhd', 'alice', 'kvKeys', {});
    expect(remainingKeys).toEqual(['key2']);
  });

  it('clears all KV entries for a specific provider without affecting others', async () => {
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'k1', value: 1});
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'k2', value: 2});
    await handleProviderRpc('cinefreak', 'alice', 'kvSet', {key: 'k1', value: 99});

    await handleProviderRpc('uhd', 'alice', 'kvClear', {});
    const uhdKeys = await handleProviderRpc('uhd', 'alice', 'kvKeys', {});
    const cinefreakKeys = await handleProviderRpc('cinefreak', 'alice', 'kvKeys', {});
    const cinefreakVal = await handleProviderRpc('cinefreak', 'alice', 'kvGet', {key: 'k1'});

    expect(uhdKeys).toEqual([]);
    expect(cinefreakKeys).toEqual(['k1']);
    expect(cinefreakVal).toEqual(99);
  });

  it('keeps KV storage isolated between different providers', async () => {
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'sharedKey', value: 'uhdValue'});
    await handleProviderRpc('cinefreak', 'alice', 'kvSet', {key: 'sharedKey', value: 'cineValue'});

    const uhdVal = await handleProviderRpc('uhd', 'alice', 'kvGet', {key: 'sharedKey'});
    const cineVal = await handleProviderRpc('cinefreak', 'alice', 'kvGet', {key: 'sharedKey'});

    expect(uhdVal).toEqual('uhdValue');
    expect(cineVal).toEqual('cineValue');
  });

  it('rejects invalid keys', async () => {
    await expect(
      handleProviderRpc('uhd', 'alice', 'kvSet', {key: '', value: 'test'}),
    ).rejects.toThrow('Invalid KV key');

    await expect(
      handleProviderRpc('uhd', 'alice', 'kvGet', {key: '   '}),
    ).rejects.toThrow('Invalid KV key');
  });

  it('keeps KV storage isolated between authors with the same provider value', async () => {
    await handleProviderRpc('uhd', 'alice', 'kvSet', {key: 'token', value: 'a'});
    await handleProviderRpc('uhd', 'bob', 'kvSet', {key: 'token', value: 'b'});

    expect(await handleProviderRpc('uhd', 'alice', 'kvGet', {key: 'token'})).toBe('a');
    expect(await handleProviderRpc('uhd', 'bob', 'kvGet', {key: 'token'})).toBe('b');

    await handleProviderRpc('uhd', 'bob', 'kvClear', {});
    expect(await handleProviderRpc('uhd', 'bob', 'kvKeys', {})).toEqual([]);
    expect(await handleProviderRpc('uhd', 'alice', 'kvKeys', {})).toEqual(['token']);
  });

  it('does not let a provider value reach another value through the key prefix', async () => {
    await handleProviderRpc('a:b', 'alice', 'kvSet', {key: 'k', value: 1});

    expect(await handleProviderRpc('a', 'alice', 'kvKeys', {})).toEqual([]);
  });
});
