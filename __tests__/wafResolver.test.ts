jest.mock('../src/lib/zustand/verificationConsentStore', () => ({authorizeVerification: async () => {}, VerificationDeniedError: class extends Error {}}));
jest.mock('../src/lib/storage/extensionStorage', () => ({extensionStorage: {getInstalledProviders: () => []}}));
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockFetch = jest.fn<any>();
jest.mock('../src/lib/sandbox/providerFetch', () => ({
  providerFetch: (...args: any[]) => mockFetch(...args),
}));

const mockEnqueue = jest.fn<(request: any) => void>();

jest.mock('../src/lib/providers/headers', () => ({
  headers: {'User-Agent': 'test-ua'},
}));
jest.mock('../src/lib/zustand/wafStore', () => ({
  useWafStore: {getState: () => ({enqueue: mockEnqueue})},
}));
jest.mock('../src/lib/services/cookieManager', () => ({
  buildCookieString: (map: Record<string, string>) =>
    Object.entries(map)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  pickUserAgent: () => undefined,
}));
jest.mock('../src/lib/sandbox/providerScope', () => ({
  providerAuthor: (author?: string) => author?.trim() || 'local',
}));
jest.mock('../src/lib/sandbox/providerCookieJar', () => ({
  deleteJarCookie: jest.fn(),
  getJarCookieMap: jest.fn(() => ({})),
}));

import {openWebView} from '../src/lib/services/wafResolver';

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('openWebView request coalescing', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (_author: string, url: string) => ({
      status: 200, url, bodyBase64: Buffer.from(`page ${url}`).toString('base64'),
    }));
  });

  it('shares one domain dialog and retries each waiter with its own URL', async () => {
    const a = openWebView('https://site.test/a');
    const b = openWebView('https://site.test/b', {force: true, waitForCookie: 'other'});
    await flush();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    mockEnqueue.mock.calls[0][0].resolve({data: 'first page', cookies: ''});
    expect((await a).data).toBe('first page');
    expect((await b).data).toBe('page https://site.test/b');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not share a dialog between authors', async () => {
    const a = openWebView('https://site.test/a', undefined, 'x');
    const b = openWebView('https://site.test/a', undefined, 'y');
    expect(b).not.toBe(a);
    await flush();
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    mockEnqueue.mock.calls.forEach(call => call[0].resolve({data: ''}));
    await Promise.all([a, b]);
  });

  it('shares one dialog per site while waiting for a cookie', async () => {
    const opts = {waitForCookie: 'cf_clearance'};
    const a = openWebView('https://site.test/a', opts);
    const b = openWebView('https://site.test/b', opts);
    expect(b).not.toBe(a);
    await flush();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    mockEnqueue.mock.calls[0][0].resolve({data: '', cookies: ''});
    await Promise.all([a, b]);
  });

  it('silently retries after dismissal and does not reopen the dialog', async () => {
    const a = openWebView('https://dismiss.test/a');
    const b = openWebView('https://dismiss.test/b');
    await flush();
    mockEnqueue.mock.calls[0][0].reject(new Error('WAF_DIALOG_CANCELLED'));
    expect((await a).data).toBe('page https://dismiss.test/a');
    expect((await b).data).toBe('page https://dismiss.test/b');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation when the silent retry remains blocked', async () => {
    mockFetch.mockResolvedValue({status: 403});
    const a = openWebView('https://blocked.test/a');
    const outcome = a.catch(error => error);
    await flush();
    mockEnqueue.mock.calls[0][0].reject(new Error('WAF_DIALOG_CANCELLED'));
    expect((await outcome).message).toBe('WAF_DIALOG_CANCELLED');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('does not leave an unhandled rejection when the dialog is cancelled', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const a = openWebView('https://cancel.test/page');
      await flush();
      mockEnqueue.mock.calls[0][0].reject(new Error('cancelled'));
      await expect(a).rejects.toThrow('cancelled');
      await flush();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();

      // The entry is cleared, so a retry opens a new dialog.
      const retry = openWebView('https://cancel.test/page');
      expect(retry).not.toBe(a);
      await flush();
      mockEnqueue.mock.calls[1][0].resolve({data: ''});
      await retry;
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
