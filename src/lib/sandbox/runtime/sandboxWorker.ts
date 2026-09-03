/**
 * Sandbox worker: the realm where untrusted provider code actually runs.
 *
 * This is a nested Worker inside the sandbox WebView. Running in a Worker
 * rather than the WebView document is deliberate:
 *  - a Worker has no `document`, so provider code cannot create a fresh iframe
 *    to recover a pristine `fetch` and bypass the mediated network path
 *  - one Worker per invoke means no shared prototypes between providers, so a
 *    malicious provider cannot poison `Object.prototype`/`JSON.parse` and
 *    tamper with another provider's results
 *  - the document can `terminate()` a Worker, which is the only way to stop a
 *    runaway `while (true) {}`
 *
 * It has no network capability of its own. `fetch` and axios are shimmed to RPC
 * calls relayed by the document to the native host.
 */
import axios, {AxiosHeaders, type AxiosAdapter} from 'axios';
import * as cheerio from 'cheerio';
import {base64ToBytes} from '../base64';
import type {HostMessage, RpcOperation, SerializedResponse} from '../protocol';
import {
  createAwaiter,
  createCryptoShim,
  getErrorMessage,
  serializeBody,
} from './runtimeSupport';

type WorkerScope = typeof globalThis & {
  postMessage: (message: unknown) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
};

const workerScope = globalThis as WorkerScope;
// Capture the real channel before ambient capabilities are removed below.
const sendMessage = workerScope.postMessage.bind(workerScope);
const addMessageListener = workerScope.addEventListener.bind(workerScope);
const ResponseCtor = workerScope.Response;
const HeadersCtor = workerScope.Headers;

let activeToken = '';
let nextRpcId = 0;
const pendingRpc = new Map<
  number,
  {resolve: (value: unknown) => void; reject: (reason: Error) => void}
>();

const disableAmbientCapability = (name: string) => {
  try {
    Object.defineProperty(workerScope, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  } catch {
    // Some globals are non-configurable; the function parameters in
    // executeProvider still shadow them inside provider scope.
  }
};

[
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'postMessage',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  'navigator',
].forEach(disableAmbientCapability);

const rpc = <T>(operation: RpcOperation, args: unknown): Promise<T> => {
  if (!activeToken) {
    return Promise.reject(new Error('Sandbox is not executing a provider'));
  }
  const id = ++nextRpcId;
  return new Promise<T>((resolve, reject) => {
    pendingRpc.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    sendMessage({type: 'rpc', token: activeToken, id, operation, args});
  });
};

const headerEntries = (source: unknown): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  if (!source) {
    return entries;
  }
  if (typeof (source as Headers).forEach === 'function' && HeadersCtor) {
    (source as Headers).forEach((value, key) => entries.push([key, value]));
    return entries;
  }
  if (Array.isArray(source)) {
    for (const pair of source) {
      if (Array.isArray(pair) && pair.length >= 2) {
        entries.push([String(pair[0]), String(pair[1])]);
      }
    }
    return entries;
  }
  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(
      source as Record<string, unknown>,
    )) {
      if (value != null && typeof value !== 'object') {
        entries.push([key, String(value)]);
      }
    }
  }
  return entries;
};

const sandboxFetch = async (input: any, init: any = {}): Promise<Response> => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const merged: Array<[string, string]> = [
    ...headerEntries(input?.headers),
    ...headerEntries(init?.headers),
  ];

  const response = await rpc<SerializedResponse>('fetch', {
    url,
    init: {
      method: init?.method ?? input?.method,
      headers: merged,
      body: await serializeBody(init?.body ?? input?.body),
      redirect: init?.redirect === 'manual' ? 'manual' : 'follow',
    },
  });

  const bytes = base64ToBytes(response.bodyBase64);
  // 204/304 must be constructed with a null body or Response throws.
  const nullBody = response.status === 204 || response.status === 304;
  const result = new ResponseCtor(
    nullBody ? null : (bytes.buffer as ArrayBuffer),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
  Object.defineProperty(result, 'url', {value: response.url});
  return result;
};

const sandboxAxiosAdapter: AxiosAdapter = async config => {
  let url = config.url ?? '';
  if (config.baseURL && !/^https?:/i.test(url)) {
    url = `${config.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }
  if (config.params) {
    const query = new URLSearchParams(
      config.params as Record<string, string>,
    ).toString();
    if (query) {
      url += `${url.includes('?') ? '&' : '?'}${query}`;
    }
  }

  const response = await sandboxFetch(url, {
    method: config.method?.toUpperCase(),
    headers: config.headers,
    body: config.data,
    redirect: config.maxRedirects === 0 ? 'manual' : 'follow',
  });

  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => responseHeaders.set(key, value));

  let data: unknown;
  if (config.responseType === 'arraybuffer') {
    data = await response.arrayBuffer();
  } else {
    const text = await response.text();
    if (config.responseType === 'text') {
      data = text;
    } else {
      try {
        data = text ? JSON.parse(text) : '';
      } catch {
        data = text;
      }
    }
  }

  const result = {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config,
    request: {url, responseURL: response.url},
  } as any;

  if (config.validateStatus && !config.validateStatus(response.status)) {
    const error: any = new Error(
      `Request failed with status code ${response.status}`,
    );
    error.response = result;
    error.config = config;
    error.isAxiosError = true;
    throw error;
  }
  return result;
};

axios.defaults.adapter = sandboxAxiosAdapter;

const Crypto = createCryptoShim(rpc);

let providerGlobal: Record<string, unknown> = {};

const kvStore = Object.freeze({
  get: <T = unknown>(key: string): Promise<T | undefined> =>
    rpc<T | undefined>('kvGet', {key}),
  set: (key: string, value: unknown): Promise<void> =>
    rpc<void>('kvSet', {key, value}),
  delete: (key: string): Promise<boolean> =>
    rpc<boolean>('kvDelete', {key}),
  keys: (): Promise<string[]> =>
    rpc<string[]>('kvKeys', {}),
  clear: (): Promise<void> =>
    rpc<void>('kvClear', {}),
});

const providerContext = Object.freeze({
  axios,
  cheerio,
  Crypto,
  commonHeaders: {} as Record<string, string>,
  getBaseUrl: (providerValue: string) =>
    rpc<string>('getBaseUrl', {providerValue}),
  openWebView: (url: string, options?: unknown) =>
    rpc('openWebView', {url, options}),
  kvStore,
});

const executeProvider = async (
  moduleCode: string,
  exportName?: string,
  args: Record<string, unknown> = {},
  commonHeaders: Record<string, string> = {},
) => {
  const exports: Record<string, unknown> = {};
  const module = {exports};
  const context = Object.freeze({...providerContext, commonHeaders});

  const executeModule = new Function(
    'exports',
    'module',
    'require',
    'console',
    'Promise',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'fetch',
    '__awaiter',
    'providerGlobal',
    'globalThis',
    'self',
    'postMessage',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'indexedDB',
    'caches',
    'importScripts',
    `"use strict";\n${moduleCode}`,
  );

  executeModule(
    exports,
    module,
    () => ({}),
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    sandboxFetch,
    createAwaiter(),
    providerGlobal,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const moduleExports = module.exports as Record<string, unknown>;
  if (!exportName) {
    const resolvedExports: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(moduleExports)) {
      if (typeof value === 'function') {
        try {
          resolvedExports[key] = await value({
            ...args,
            signal: new AbortController().signal,
            providerContext: context,
          });
        } catch {
          resolvedExports[key] = value;
        }
      } else {
        resolvedExports[key] = value;
      }
    }
    return resolvedExports;
  }
  const providerFunction = moduleExports[exportName];
  if (typeof providerFunction !== 'function') {
    throw new Error(`Provider module does not export ${exportName}`);
  }
  return providerFunction({
    ...args,
    signal: new AbortController().signal,
    providerContext: context,
  });
};

const serializeState = (): Record<string, unknown> => {
  try {
    return JSON.parse(JSON.stringify(providerGlobal ?? {}));
  } catch {
    return {};
  }
};

addMessageListener('message', async (event: {data: HostMessage}) => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.type === 'rpc-result') {
    if (message.token !== activeToken) {
      return;
    }
    const pending = pendingRpc.get(message.id);
    if (!pending) {
      return;
    }
    pendingRpc.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result);
    }
    return;
  }

  // One invoke per worker; the document spawns a fresh worker per call.
  if (message.type !== 'invoke' || activeToken) {
    return;
  }
  activeToken = message.token;
  providerGlobal = message.state ?? {};

  try {
    const {commonHeaders = {}, ...providerArgs} = message.args ?? {};
    const result = await executeProvider(
      message.moduleCode,
      message.exportName,
      providerArgs,
      commonHeaders as Record<string, string>,
    );
    // Round-trip through JSON so only serializable data crosses the bridge.
    sendMessage({
      type: 'result',
      token: activeToken,
      result: JSON.parse(JSON.stringify(result ?? null)),
      state: serializeState(),
    });
  } catch (error) {
    sendMessage({
      type: 'result',
      token: activeToken,
      error: getErrorMessage(error),
    });
  }
});
