const mockValues = new Map<string, string>();
jest.mock('../src/lib/downloadLocation', () => ({}));
jest.mock('../src/lib/storage/StorageService', () => ({mainStorage: {
  getString: (key: string) => mockValues.get(key),
  setString: (key: string, value: string) => mockValues.set(key, value),
}}));
jest.mock('../src/lib/storage/extensionStorage', () => ({extensionStorage: {getInstalledProviders: () => [
  {value: 'movies', display_name: 'My Movies', source: {author: 'alice'}},
  {value: 'movies', display_name: 'Other source movies', source: {author: 'bob'}},
]}}));
jest.mock('../src/lib/sandbox/providerFetch', () => ({providerFetch: jest.fn()}));
jest.mock('../src/lib/providers/headers', () => ({headers: {'User-Agent': 'test'}}));
jest.mock('../src/lib/services/cookieManager', () => ({buildCookieString: () => '', pickUserAgent: () => undefined}));
jest.mock('../src/lib/sandbox/providerCookieJar', () => ({deleteJarCookie: jest.fn(), getJarCookieMap: jest.fn(() => ({}))}));

import {authorizeVerification, useVerificationConsentStore} from '../src/lib/zustand/verificationConsentStore';
import {settingsStorage} from '../src/lib/storage/SettingsStorage';
import {useWafStore} from '../src/lib/zustand/wafStore';
import {openWebView} from '../src/lib/services/wafResolver';
import {guardWafPrompts} from '../src/lib/services/wafSession';
import {deleteJarCookie, getJarCookieMap} from '../src/lib/sandbox/providerCookieJar';
import {providerFetch} from '../src/lib/sandbox/providerFetch';

const flush = () => new Promise(resolve => setImmediate(resolve));
const requests = () => useVerificationConsentStore.getState().requests;
const windows = () => useWafStore.getState().requests;
const completeWindow = () => {
  const req = windows()[0];
  req.resolve({data: 'ok', cookies: '', url: req.url});
  useWafStore.getState().remove(req.id);
};

beforeEach(() => {
  mockValues.clear();
  jest.clearAllMocks();
  jest.mocked(getJarCookieMap).mockReturnValue({});
});
afterEach(async () => {
  for (const request of [...requests()]) request.finish(false);
  useWafStore.getState().cancelAll();
  await flush();
  expect(requests()).toHaveLength(0);
  expect(windows()).toHaveLength(0);
});

it('loads no website or cookies before Allow, and shows the requesting provider name', async () => {
  const result = openWebView('https://verify.test/path', {force: true, waitForCookie: 'cf_clearance'}, 'alice', undefined, 'movies');
  expect(requests()[0].provider).toBe('My Movies');
  expect(requests()[0].url).toBe('https://verify.test/path');
  expect(windows()).toHaveLength(0);
  expect(deleteJarCookie).not.toHaveBeenCalled();
  expect(providerFetch).not.toHaveBeenCalled();
  requests()[0].finish(true);
  await flush();
  expect(windows()).toHaveLength(1);
  expect(deleteJarCookie).toHaveBeenCalledWith('alice', 'https://verify.test/path', 'cf_clearance');
  completeWindow();
  await expect(result).resolves.toMatchObject({data: 'ok'});
  expect(settingsStorage.getVerificationWindowPolicy()).toBe('ask');
});

it('Cancel stops all coalesced requests without a silent HTTP retry or repeat prompt for that operation', async () => {
  const a = new AbortController(), b = new AbortController();
  const first = openWebView('https://cancel-consent.test/a', undefined, 'alice', a.signal);
  const second = openWebView('https://cancel-consent.test/b', undefined, 'alice', b.signal);
  const results = Promise.allSettled([first, second]);
  expect(requests()).toHaveLength(1);
  requests()[0].finish(false);
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  expect(windows()).toHaveLength(0);
  expect(providerFetch).not.toHaveBeenCalled();
  expect(settingsStorage.getVerificationWindowPolicy()).toBe('ask');
  await expect(openWebView('https://different.test/a', {force: true}, 'alice', b.signal)).rejects.toThrow('WAF_DIALOG_CANCELLED');
});

it('remembers Allow globally and resolves already queued prompts', async () => {
  const first = authorizeVerification('one', 'https://one.test');
  const second = authorizeVerification('two', 'https://two.test');
  expect(requests()).toHaveLength(2);
  requests()[0].finish(true, true);
  await Promise.all([first, second]);
  expect(requests()).toHaveLength(0);
  expect(settingsStorage.getVerificationWindowPolicy()).toBe('allow');
  const result = openWebView('https://allowed.test');
  await flush();
  expect(requests()).toHaveLength(0);
  expect(windows()).toHaveLength(1);
  completeWindow();
  await result;
});

it('remembers Cancel as Block, including queued prompts, until changed in settings', async () => {
  const first = authorizeVerification('one', 'https://one.test');
  const second = authorizeVerification('two', 'https://two.test');
  const results = Promise.allSettled([first, second]);
  requests()[0].finish(false, true);
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  expect(settingsStorage.getVerificationWindowPolicy()).toBe('block');
  await expect(openWebView('https://blocked-consent.test', {force: true})).rejects.toThrow('blocked in Settings');
  expect(windows()).toHaveLength(0);
  settingsStorage.setVerificationWindowPolicy('ask');
  const retry = authorizeVerification('three', 'https://three.test');
  requests()[0].finish(true);
  await retry;
});

it('removes an aborted permission prompt without saving a stale remembered decision', async () => {
  const controller = new AbortController();
  const result = authorizeVerification('one', 'https://abort.test', controller.signal);
  const outcome = result.catch(error => error);
  const staleRequest = requests()[0];
  controller.abort();
  expect((await outcome).name).toBe('AbortError');
  expect(requests()).toHaveLength(0);
  staleRequest.finish(true, true);
  expect(settingsStorage.getVerificationWindowPolicy()).toBe('ask');
});

it('does not open a window when the request aborts just after Allow', async () => {
  const controller = new AbortController();
  const result = openWebView('https://abort-after.test', undefined, 'alice', controller.signal);
  const outcome = result.catch(error => error);
  requests()[0].finish(true);
  controller.abort();
  expect((await outcome).name).toBe('AbortError');
  expect(windows()).toHaveLength(0);
});

it('does not prompt background work or re-prompt when a solved cookie can be reused', async () => {
  const controller = new AbortController();
  guardWafPrompts(controller.signal, () => false);
  await expect(openWebView('https://background-consent.test', undefined, 'alice', controller.signal)).rejects.toThrow('WAF_DIALOG_CANCELLED');
  jest.mocked(getJarCookieMap).mockReturnValue({cf_clearance: 'already solved'});
  await expect(openWebView('https://solved-consent.test', {waitForCookie: 'cf_clearance'}, 'alice', controller.signal)).resolves.toMatchObject({cookieMap: {cf_clearance: 'already solved'}});
  expect(requests()).toHaveLength(0);
  expect(windows()).toHaveLength(0);
});

it('keeps scopes separate when one queued permission is aborted', async () => {
  const controller = new AbortController();
  const first = authorizeVerification('one', 'https://one.test', controller.signal).catch(error => error);
  const second = authorizeVerification('two', 'https://two.test');
  controller.abort();
  expect((await first).name).toBe('AbortError');
  expect(requests()).toHaveLength(1);
  expect(requests()[0].provider).toBe('two');
  requests()[0].finish(true);
  await second;
});
