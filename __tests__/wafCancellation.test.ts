jest.mock('../src/lib/zustand/verificationConsentStore', () => ({authorizeVerification: async () => {}, VerificationDeniedError: class extends Error {}}));
jest.mock('../src/lib/storage/extensionStorage', () => ({extensionStorage: {getInstalledProviders: () => []}}));
jest.mock('../src/lib/sandbox/providerFetch', () => ({
  providerFetch: jest.fn(async () => { throw new Error('still blocked'); }),
}));
jest.mock('../src/lib/providers/headers', () => ({
  headers: {'User-Agent': 'test'},
}));
jest.mock('../src/lib/services/cookieManager', () => ({
  buildCookieString: () => '',
  pickUserAgent: () => undefined,
}));
jest.mock('../src/lib/sandbox/providerScope', () => ({
  providerAuthor: (author?: string) => author || 'local',
}));
jest.mock('../src/lib/sandbox/providerCookieJar', () => ({
  deleteJarCookie: jest.fn(),
  getJarCookieMap: (_author: string, url: string) =>
    url.includes('solved') ? {cf_clearance: 'ok'} : {},
}));

import {openWebView} from '../src/lib/services/wafResolver';
import {useWafStore} from '../src/lib/zustand/wafStore';
import {
  guardWafPrompts,
  registerWafOperation,
} from '../src/lib/services/wafSession';

const flush = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => useWafStore.getState().cancelAll());

it('allows later challenges from the same operation after Done succeeds', async () => {
  const scope = new AbortController().signal;
  const first = openWebView('https://done.test/a', undefined, 'alice', scope);
  await flush();
  const request = useWafStore.getState().requests[0];
  request.resolve({
    data: 'ok',
    cookies: '',
    cookieMap: {},
    userAgent: 'test',
    url: request.url,
  });
  useWafStore.getState().remove(request.id);
  await first;
  const second = openWebView('https://done.test/b', undefined, 'alice', scope);
  await flush();
  expect(useWafStore.getState().requests).toHaveLength(1);
  const rejection = second.catch(error => error);
  await flush();
  useWafStore.getState().cancelAll();
  expect((await rejection).message).toBe('WAF_DIALOG_CANCELLED');
});

it('dismisses the visible challenge and the entire queue, including other providers', async () => {
  const first = openWebView(
    'https://first.test/a',
    undefined,
    'alice',
    new AbortController().signal,
  );
  const second = openWebView(
    'https://second.test/b',
    undefined,
    'bob',
    new AbortController().signal,
  );
  const outcomes = Promise.allSettled([first, second]);
  await flush();
  expect(useWafStore.getState().requests).toHaveLength(2);
  useWafStore.getState().cancelAll();
  expect(useWafStore.getState().requests).toHaveLength(0);
  for (const outcome of await outcomes) {
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected')
      expect(outcome.reason.message).toBe('WAF_DIALOG_CANCELLED');
  }
});

it('blocks catch-and-reopen attempts, another URL, and forced dialogs until a fresh request', async () => {
  const scope = new AbortController().signal;
  const first = openWebView('https://site.test/a', undefined, 'alice', scope);
  const rejection = first.catch(error => error);
  await flush();
  useWafStore.getState().cancelAll();
  expect((await rejection).message).toBe('WAF_DIALOG_CANCELLED');
  await expect(
    openWebView('https://site.test/b', {force: true}, 'alice', scope),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
  expect(useWafStore.getState().requests).toHaveLength(0);
  const retry = openWebView(
    'https://site.test/a',
    undefined,
    'alice',
    new AbortController().signal,
  );
  await flush();
  expect(useWafStore.getState().requests).toHaveLength(1);
  useWafStore
    .getState()
    .requests[0].resolve({
      data: 'ok',
      cookies: '',
      cookieMap: {},
      userAgent: 'test',
      url: 'https://site.test/a',
    });
  useWafStore.setState({requests: []});
  await expect(retry).resolves.toMatchObject({data: 'ok'});
});

it('blocks all coalesced callers, including those with a different invocation scope', async () => {
  const a = new AbortController().signal;
  const b = new AbortController().signal;
  const first = openWebView(
    'https://shared.test/a',
    {waitForCookie: 'cf_clearance'},
    'alice',
    a,
  );
  const second = openWebView(
    'https://shared.test/b',
    {waitForCookie: 'cf_clearance'},
    'alice',
    b,
  );
  expect(second).not.toBe(first);
  const secondOutcome = second.catch(error => error);
  const outcome = first.catch(error => error);
  await flush();
  useWafStore.getState().cancelAll();
  expect((await outcome).message).toBe('WAF_DIALOG_CANCELLED');
  expect((await secondOutcome).message).toBe('WAF_DIALOG_CANCELLED');
  await expect(
    openWebView('https://other.test/a', undefined, 'alice', a),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
  await expect(
    openWebView('https://other.test/b', undefined, 'alice', b),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
});

it('also blocks already-running and queued invocations that have not yet requested a challenge', async () => {
  const scope = new AbortController().signal;
  const release = registerWafOperation(scope);
  useWafStore.getState().cancelAll();
  await expect(
    openWebView('https://late.test/a', undefined, 'alice', scope),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
  release();
  // Automatic retries can reuse the dismissed query signal after the first invocation finishes.
  const retryRelease = registerWafOperation(scope);
  await expect(
    openWebView('https://late.test/a', undefined, 'alice', scope),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
  retryRelease();
  expect(useWafStore.getState().requests).toHaveLength(0);
});

it('fails challenges from guarded background work without a dialog until it may prompt', async () => {
  const scope = new AbortController().signal;
  let allowed = false;
  guardWafPrompts(scope, () => allowed);
  await expect(
    openWebView('https://background.test/a', undefined, 'alice', scope),
  ).rejects.toThrow('WAF_DIALOG_CANCELLED');
  // A cookie solved earlier is still handed out without a dialog.
  await expect(
    openWebView(
      'https://solved.test/a',
      {waitForCookie: 'cf_clearance'},
      'alice',
      scope,
    ),
  ).resolves.toMatchObject({url: 'https://solved.test/a'});
  expect(useWafStore.getState().requests).toHaveLength(0);

  allowed = true;
  const shown = openWebView(
    'https://background.test/a',
    undefined,
    'alice',
    scope,
  ).catch(error => error);
  await flush();
  expect(useWafStore.getState().requests).toHaveLength(1);
  useWafStore.getState().cancelAll();
  expect((await shown).message).toBe('WAF_DIALOG_CANCELLED');
});
