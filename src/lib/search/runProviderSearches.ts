import {useVerificationConsentStore} from '../zustand/verificationConsentStore';
import {registerWafOperation} from '../services/wafSession';
import {useWafStore} from '../zustand/wafStore';

export type ProviderSearchOutcome<T> = {posts: T[]} | {error: string};

/**
 * Searches providers a few at a time. The sandbox runs two invokes at once and
 * fails any invoke that waits 60 s in its queue, so starting every installed
 * provider together made the tail of the queue time out without running.
 *
 * Each search has its own deadline, held while a captcha dialog is open so the
 * user has time to solve it. Once `signal` aborts nothing new starts and no
 * outcome is reported.
 */
export const runProviderSearches = async <P, T>({
  providers,
  concurrency = 2,
  timeoutMs = 25_000,
  signal,
  search,
  onSettled,
}: {
  providers: P[];
  concurrency?: number;
  timeoutMs?: number;
  signal: AbortSignal;
  search: (provider: P, signal: AbortSignal) => Promise<T[]>;
  onSettled: (provider: P, outcome: ProviderSearchOutcome<T>) => void;
}): Promise<void> => {
  // Registered up front, as the sandbox did when every search was queued at
  // once, so dismissing a captcha also covers searches not started yet.
  const jobs = providers.map(provider => {
    const controller = new AbortController();
    return {
      provider,
      controller,
      release: registerWafOperation(controller.signal),
    };
  });
  const queue = [...jobs];

  const run = async ({provider, controller}: (typeof jobs)[number]) => {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remainingMs = timeoutMs;
    let runningSince: number | undefined;
    const expire = () => {
      timedOut = true;
      controller.abort();
    };
    const pauseDeadline = () => {
      if (runningSince === undefined) return;
      remainingMs = Math.max(0, remainingMs - (Date.now() - runningSince));
      runningSince = undefined;
      clearTimeout(timer);
      timer = undefined;
    };
    const resumeDeadline = () => {
      if (runningSince !== undefined || controller.signal.aborted) return;
      runningSince = Date.now();
      timer = setTimeout(expire, remainingMs);
    };
    // Watch from the start: even a captcha that opens and closes before the
    // first deadline must be excluded, without resetting the elapsed budget.
    const updateDeadline = () => {
      if (useWafStore.getState().requests.length > 0 || useVerificationConsentStore.getState().requests.length > 0) pauseDeadline();
      else resumeDeadline();
    };
    const unsubscribe = useWafStore.subscribe(updateDeadline);
    const unsubscribeConsent = useVerificationConsentStore.subscribe(updateDeadline);
    updateDeadline();

    const stop = () => controller.abort();
    signal.addEventListener('abort', stop);
    // Free the slot on abort even if the search ignores its signal.
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Aborted'));
      controller.signal.addEventListener('abort', onAbort, {once: true});
    });
    if (signal.aborted) stop();
    try {
      const outcome = await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error('Aborted');
          return search(provider, controller.signal);
        }),
        aborted,
      ]).then(
        (posts): ProviderSearchOutcome<T> => ({posts}),
        (error: any): ProviderSearchOutcome<T> => ({
          error: timedOut ? 'Timed out' : error?.message || 'Failed to search',
        }),
      );
      if (!signal.aborted) onSettled(provider, outcome);
    } finally {
      clearTimeout(timer);
      unsubscribe();
      unsubscribeConsent();
      signal.removeEventListener('abort', stop);
      controller.signal.removeEventListener('abort', onAbort);
    }
  };

  const next = async (): Promise<void> => {
    const job = queue.shift();
    if (!job || signal.aborted) return;
    await run(job);
    return next();
  };

  try {
    await Promise.all(Array.from({length: concurrency}, next));
  } finally {
    jobs.forEach(job => job.release());
  }
};
