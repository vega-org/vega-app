import * as Crypto from 'expo-crypto';
import {getBaseUrl} from '../providers/getBaseUrl';
import {openWebView} from '../services/wafResolver';
import type {OpenWebViewOptions, OpenWebViewResult} from '../providers/types';
import {bytesToBase64} from './base64';
import {providerFetch} from './providerFetch';
import {throwIfProviderAborted} from './abort';
import {getJarCookieMap} from './providerCookieJar';
import type {RpcOperation, SerializedRequest} from './protocol';
import {validateProviderUrl} from './urlGuard';
import {providerKvStorage} from '../storage/StorageService';
import {
  getProviderKvPrefix,
  getScopedKvKey,
  migrateLegacyProviderKv,
} from './providerScope';

const MAX_KV_KEY_LENGTH = 256;
const MAX_KV_VALUE_BYTES = 1_000_000;

const validateKvKey = (key: unknown): string => {
  if (
    typeof key !== 'string' ||
    !key.trim() ||
    key.length > MAX_KV_KEY_LENGTH
  ) {
    throw new Error(
      `Invalid KV key: must be a non-empty string <= ${MAX_KV_KEY_LENGTH} characters`,
    );
  }
  return key;
};

const handleKvGet = async (
  author: string,
  providerValue: string,
  args: any,
): Promise<unknown> => {
  const key = validateKvKey(args?.key);
  await migrateLegacyProviderKv();
  const scopedKey = getScopedKvKey(author, providerValue, key);
  const raw = providerKvStorage.getString(scopedKey);
  if (raw === undefined || raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const handleKvSet = async (
  author: string,
  providerValue: string,
  args: any,
): Promise<void> => {
  const key = validateKvKey(args?.key);
  await migrateLegacyProviderKv();
  const scopedKey = getScopedKvKey(author, providerValue, key);
  const value = args?.value;
  if (value === undefined) {
    providerKvStorage.delete(scopedKey);
    return;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('KV value must be JSON-serializable');
  }
  if (serialized.length > MAX_KV_VALUE_BYTES) {
    throw new Error(`KV value exceeds limit of ${MAX_KV_VALUE_BYTES} bytes`);
  }
  providerKvStorage.setString(scopedKey, serialized);
};

const handleKvDelete = async (
  author: string,
  providerValue: string,
  args: any,
): Promise<boolean> => {
  const key = validateKvKey(args?.key);
  await migrateLegacyProviderKv();
  const scopedKey = getScopedKvKey(author, providerValue, key);
  const exists = providerKvStorage.contains(scopedKey);
  providerKvStorage.delete(scopedKey);
  return exists;
};

const handleKvKeys = async (
  author: string,
  providerValue: string,
): Promise<string[]> => {
  await migrateLegacyProviderKv();
  const allKeys = await providerKvStorage.getKeys();
  const prefix = getProviderKvPrefix(author, providerValue);
  return allKeys
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length));
};

const handleKvClear = async (
  author: string,
  providerValue: string,
): Promise<void> => {
  const keys = await handleKvKeys(author, providerValue);
  for (const k of keys) {
    providerKvStorage.delete(getScopedKvKey(author, providerValue, k));
  }
};

const digestAlgorithms: Record<string, Crypto.CryptoDigestAlgorithm> = {
  MD5: Crypto.CryptoDigestAlgorithm.MD5,
  'SHA-1': Crypto.CryptoDigestAlgorithm.SHA1,
  'SHA-256': Crypto.CryptoDigestAlgorithm.SHA256,
  'SHA-384': Crypto.CryptoDigestAlgorithm.SHA384,
  'SHA-512': Crypto.CryptoDigestAlgorithm.SHA512,
};

const MAX_DIGEST_INPUT = 5 * 1024 * 1024;
const MAX_RANDOM_BYTES = 1024;

const handleCrypto = async (args: any): Promise<unknown> => {
  const method = String(args?.method ?? '');

  if (method === 'digestStringAsync') {
    const data = String(args?.data ?? '');
    if (data.length > MAX_DIGEST_INPUT) {
      throw new Error('Digest input is too large');
    }
    const algorithm = digestAlgorithms[String(args?.algorithm ?? 'SHA-256')];
    if (!algorithm) {
      throw new Error(`Unsupported digest algorithm: ${args?.algorithm}`);
    }
    return Crypto.digestStringAsync(algorithm, data, args?.options);
  }

  if (method === 'getRandomBytesAsync') {
    const byteCount = Number(args?.byteCount ?? 0);
    if (!Number.isInteger(byteCount) || byteCount <= 0) {
      throw new Error('byteCount must be a positive integer');
    }
    if (byteCount > MAX_RANDOM_BYTES) {
      throw new Error('byteCount is too large');
    }
    const bytes = await Crypto.getRandomBytesAsync(byteCount);
    return bytesToBase64(bytes);
  }

  throw new Error(`Unsupported crypto method: ${method}`);
};

const handleOpenWebView = async (
  providerValue: string,
  author: string,
  args: any,
  scope?: AbortSignal,
): Promise<OpenWebViewResult> => {
  const url = validateProviderUrl(args?.url);
  const options = (args?.options ?? undefined) as
    | OpenWebViewOptions
    | undefined;

  const result = await openWebView(url.toString(), options, author, scope, providerValue);
  return {...result, cookie: result.cookies};
};

export const handleProviderRpc = async (
  providerValue: string,
  author: string,
  operation: RpcOperation,
  args: any,
  signal?: AbortSignal,
  wafScope: AbortSignal | undefined = signal,
): Promise<unknown> => {
  throwIfProviderAborted(signal);
  switch (operation) {
    case 'fetch':
      return providerFetch(
        author,
        args?.url,
        (args?.init ?? {
          headers: [],
          body: {kind: 'none'},
        }) as SerializedRequest,
        signal,
      );

    case 'getBaseUrl':
      return getBaseUrl(String(args?.providerValue ?? providerValue));

    case 'openWebView':
      return handleOpenWebView(providerValue, author, args, wafScope);

    case 'getCookies':
      return getJarCookieMap(author, validateProviderUrl(args?.url).toString());

    case 'crypto':
      return handleCrypto(args);

    case 'kvGet':
      return handleKvGet(author, providerValue, args);

    case 'kvSet':
      return handleKvSet(author, providerValue, args);

    case 'kvDelete':
      return handleKvDelete(author, providerValue, args);

    case 'kvKeys':
      return handleKvKeys(author, providerValue);

    case 'kvClear':
      return handleKvClear(author, providerValue);

    default:
      throw new Error(`Unsupported provider operation: ${operation}`);
  }
};
