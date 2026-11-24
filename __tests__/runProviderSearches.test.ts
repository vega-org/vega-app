jest.mock('../src/lib/storage/SettingsStorage', () => ({settingsStorage: {getVerificationWindowPolicy: () => 'ask'}}));
import {useVerificationConsentStore} from '../src/lib/zustand/verificationConsentStore';
import {runProviderSearches} from '../src/lib/search/runProviderSearches';
import {useWafStore, type WafRequest} from '../src/lib/zustand/wafStore';
import {
  dismissWafOperations,
  isWafOperationDismissed,
} from '../src/lib/services/wafSession';

interface Call {
  provider: string;
  signal: AbortSignal;
  settled: boolean;
  resolve: (posts: string[]) => void;
  reject: (error: Error) => void;
}

const start = (providers: string[], screen = new AbortController()) => {
  const calls: Call[] = [];
  const outcomes: Record<string, unknown> = {};
  let peak = 0;
  const done = runProviderSearches<string, string>({
    providers,
    signal: screen.signal,
    search: (provider, signal) =>
      new Promise((resolve, reject) => {
        const call: Call = {
          provider,
          signal,
          settled: false,
          resolve: posts => {
            call.settled = true;
            resolve(posts);
          },
          reject: error => {
            call.settled = true;
            reject(error);
          },
        };
        calls.push(call);
        peak = Math.max(peak, calls.filter(c => !c.settled).length);
        // Like the sandbox, an aborted invoke rejects right away.
        signal.addEventListener('abort', () =>
          call.reject(new Error('Provider request aborted')),
        );
      }),
    onSettled: (provider, outcome) => {
      outcomes[provider] = outcome;
    },
  });
  return {calls, outcomes, done, screen, peak: () => peak};
};

const flush = () => jest.advanceTimersByTimeAsync(0);
const started = (calls: Call[]) => calls.map(call => call.provider);

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  useWafStore.setState({requests: []});
  useVerificationConsentStore.setState({requests: []});
  jest.useRealTimers();
});

it('runs at most two searches at once and reports each outcome', async () => {
  const run = start(['a', 'b', 'c', 'd', 'e']);
  await flush();
  expect(started(run.calls)).toEqual(['a', 'b']);
  run.calls[0].resolve(['a1']);
  await flush();
  expect(started(run.calls)).toEqual(['a', 'b', 'c']);
  run.calls[1].reject(new Error('Blocked'));
  await flush();
  run.calls[2].resolve([]);
  await flush();
  run.calls[3].resolve(['d1']);
  run.calls[4].resolve(['e1']);
  await run.done;
  expect(run.peak()).toBe(2);
  expect(run.outcomes).toEqual({
    a: {posts: ['a1']},
    b: {error: 'Blocked'},
    c: {posts: []},
    d: {posts: ['d1']},
    e: {posts: ['e1']},
  });
});

it('aborts a hung search at the deadline and starts the next one', async () => {
  const run = start(['a', 'b', 'c']);
  await flush();
  await jest.advanceTimersByTimeAsync(24_999);
  expect(started(run.calls)).toEqual(['a', 'b']);
  await jest.advanceTimersByTimeAsync(1);
  expect(run.calls[0].signal.aborted).toBe(true);
  expect(started(run.calls)).toEqual(['a', 'b', 'c']);
  expect(run.outcomes).toEqual({
    a: {error: 'Timed out'},
    b: {error: 'Timed out'},
  });
  run.calls[2].resolve([]);
  await run.done;
});

it('starts nothing new once the screen is closed', async () => {
  const run = start(['a', 'b', 'c']);
  await flush();
  run.screen.abort();
  await run.done;
  expect(started(run.calls)).toEqual(['a', 'b']);
  expect(run.calls.every(call => call.signal.aborted)).toBe(true);
  expect(run.outcomes).toEqual({});
  expect(jest.getTimerCount()).toBe(0);
});

it('extends the deadline while a captcha dialog is open', async () => {
  const run = start(['a']);
  await flush();
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  await jest.advanceTimersByTimeAsync(90_000);
  expect(run.calls[0].signal.aborted).toBe(false);
  useWafStore.setState({requests: []});
  await jest.advanceTimersByTimeAsync(24_999);
  expect(run.calls[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await run.done;
  expect(run.outcomes).toEqual({a: {error: 'Timed out'}});
});

it('applies a dismissed captcha to searches that have not started yet', async () => {
  const run = start(['a', 'b', 'c']);
  await flush();
  dismissWafOperations();
  run.calls[0].resolve([]);
  run.calls[1].resolve([]);
  await flush();
  expect(isWafOperationDismissed(run.calls[2].signal)).toBe(true);
  run.calls[2].resolve([]);
  await run.done;
});


it('preserves the remaining budget after a captcha closes before the deadline', async () => {
  const run = start(['a']);
  await flush();
  await jest.advanceTimersByTimeAsync(10_000);
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  await jest.advanceTimersByTimeAsync(10_000);
  useWafStore.setState({requests: []});
  await jest.advanceTimersByTimeAsync(14_999);
  expect(run.calls[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await run.done;
  expect(run.outcomes).toEqual({a: {error: 'Timed out'}});
  expect(jest.getTimerCount()).toBe(0);
});

it('excludes multiple captcha intervals without resetting the budget', async () => {
  const run = start(['a']);
  await flush();
  for (let id = 1; id <= 2; id++) {
    await jest.advanceTimersByTimeAsync(5_000);
    useWafStore.setState({requests: [{id} as WafRequest]});
    await jest.advanceTimersByTimeAsync(30_000);
    useWafStore.setState({requests: []});
  }
  await jest.advanceTimersByTimeAsync(14_999);
  expect(run.calls[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await run.done;
  expect(run.outcomes).toEqual({a: {error: 'Timed out'}});
});

it('waits for an already open captcha before starting the deadline', async () => {
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  const run = start(['a']);
  await flush();
  await jest.advanceTimersByTimeAsync(90_000);
  expect(run.calls[0].signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  useWafStore.setState({requests: []});
  await jest.advanceTimersByTimeAsync(24_999);
  expect(run.calls[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await run.done;
  expect(run.outcomes).toEqual({a: {error: 'Timed out'}});
});

it('cancels while paused without starting queued providers or restarting timers', async () => {
  const run = start(['a', 'b', 'c']);
  await flush();
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  run.screen.abort();
  await run.done;
  useWafStore.setState({requests: []});
  expect(started(run.calls)).toEqual(['a', 'b']);
  expect(run.calls.every(call => call.signal.aborted)).toBe(true);
  expect(run.outcomes).toEqual({});
  expect(jest.getTimerCount()).toBe(0);
});

it('unsubscribes when a search finishes while its deadline is paused', async () => {
  const run = start(['a']);
  await flush();
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  run.calls[0].resolve(['a1']);
  await run.done;
  useWafStore.setState({requests: []});
  expect(run.outcomes).toEqual({a: {posts: ['a1']}});
  expect(jest.getTimerCount()).toBe(0);
});

it('reports synchronous search failures and cleans up the deadline', async () => {
  const outcomes: Record<string, unknown> = {};
  await runProviderSearches({
    providers: ['a'],
    signal: new AbortController().signal,
    search: () => { throw new Error('Provider unavailable'); },
    onSettled: (provider, outcome) => { outcomes[provider] = outcome; },
  });
  useWafStore.setState({requests: [{id: 1} as WafRequest]});
  useWafStore.setState({requests: []});
  expect(outcomes).toEqual({a: {error: 'Provider unavailable'}});
  expect(jest.getTimerCount()).toBe(0);
});


it('holds the search deadline while the permission warning is open', async () => {
  const run = start(['a']);
  await flush();
  await jest.advanceTimersByTimeAsync(10_000);
  useVerificationConsentStore.setState({requests: [{id: 1, provider: 'a', url: 'https://a.test', finish: () => {}}]});
  await jest.advanceTimersByTimeAsync(60_000);
  expect(run.calls[0].signal.aborted).toBe(false);
  useVerificationConsentStore.setState({requests: []});
  await jest.advanceTimersByTimeAsync(14_999);
  expect(run.calls[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await run.done;
  expect(run.outcomes).toEqual({a: {error: 'Timed out'}});
});
