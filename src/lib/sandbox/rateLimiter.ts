import {getDomain} from 'tldts';

/**
 * Per-domain rate limiting for provider HTTP requests.
 *
 * Provider code is untrusted, so it must not be able to use the app as a
 * flooding client against a third party. Three independent limits apply:
 *
 *  - a token bucket per host (sustained rate + small burst allowance)
 *  - a concurrency cap per host, so a provider cannot open dozens of
 *    simultaneous sockets to one target
 *  - a global in-flight cap, so fanning out across many hosts is bounded too
 *
 * Requests wait for capacity rather than failing outright, since normal
 * providers legitimately make bursts of a few requests. Waiting is bounded:
 * past `MAX_QUEUE_WAIT_MS` the request is rejected so a provider cannot pin
 * memory with an unbounded queue.
 */

export interface RateLimitOptions {
  /** Sustained requests per second allowed to a single host. */
  requestsPerSecond: number;
  /** Extra requests allowed in a short burst. */
  burst: number;
  /** Maximum simultaneous in-flight requests to a single host. */
  maxConcurrentPerHost: number;
  /** Maximum simultaneous in-flight requests across all hosts. */
  maxConcurrentTotal: number;
  /** Longest a request may wait for capacity before being rejected. */
  maxQueueWaitMs: number;
  /** Maximum queued (not yet started) requests per host. */
  maxQueuedPerHost: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  requestsPerSecond: 20,
  burst: 30,
  maxConcurrentPerHost: 12,
  maxConcurrentTotal: 48,
  maxQueueWaitMs: 20_000,
  maxQueuedPerHost: 64,
};

interface HostState {
  tokens: number;
  lastRefillAt: number;
  active: number;
  queue: Array<() => void>;
}

export class DomainRateLimiter {
  private readonly options: RateLimitOptions;
  private readonly hosts = new Map<string, HostState>();
  private totalActive = 0;
  private pumpScheduled = false;

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.options = {...DEFAULT_RATE_LIMIT, ...options};
  }

  private getBucketKey(host: string): string {
    const normalized = host.toLowerCase();
    // Public suffix parsing makes sibling subdomains share one budget. IPs,
    // localhost-like names and unknown suffixes fall back to the exact host.
    return getDomain(normalized, {allowPrivateDomains: true}) ?? normalized;
  }

  private getHost(host: string): HostState {
    let state = this.hosts.get(host);
    if (!state) {
      state = {
        tokens: this.options.burst,
        lastRefillAt: Date.now(),
        active: 0,
        queue: [],
      };
      this.hosts.set(host, state);
    }
    return state;
  }

  private refill(state: HostState, now: number): void {
    const elapsed = now - state.lastRefillAt;
    if (elapsed <= 0) {
      return;
    }
    const gained = (elapsed / 1000) * this.options.requestsPerSecond;
    if (gained <= 0) {
      return;
    }
    state.tokens = Math.min(this.options.burst, state.tokens + gained);
    state.lastRefillAt = now;
  }

  private canStart(state: HostState): boolean {
    return (
      state.tokens >= 1 &&
      state.active < this.options.maxConcurrentPerHost &&
      this.totalActive < this.options.maxConcurrentTotal
    );
  }

  /** Wake any waiters whose host now has capacity. */
  private pump(): void {
    let progressed = false;
    for (const state of this.hosts.values()) {
      const now = Date.now();
      this.refill(state, now);
      while (state.queue.length > 0 && this.canStart(state)) {
        const release = state.queue.shift();
        if (release) {
          // Reserve capacity before waking the promise. Promise continuations
          // run in a later microtask; without this reservation the loop would
          // see unchanged counters and wake every queued request at once.
          state.tokens = Math.max(0, state.tokens - 1);
          state.active += 1;
          this.totalActive += 1;
          release();
          progressed = true;
        }
      }
    }
    this.schedulePump(progressed);
  }

  private schedulePump(force = false): void {
    if (this.pumpScheduled) {
      return;
    }
    const hasWaiters = Array.from(this.hosts.values()).some(
      state => state.queue.length > 0,
    );
    if (!hasWaiters && !force) {
      return;
    }
    if (!hasWaiters) {
      return;
    }
    this.pumpScheduled = true;
    const delay = Math.max(
      50,
      Math.ceil(1000 / this.options.requestsPerSecond),
    );
    setTimeout(() => {
      this.pumpScheduled = false;
      this.pump();
    }, delay);
  }

  /**
   * Reserves a slot for `host`, resolving once the request may proceed.
   * The returned function must be called when the request settles.
   */
  async acquire(host: string): Promise<() => void> {
    const key = this.getBucketKey(host);
    const state = this.getHost(key);
    this.refill(state, Date.now());
    let reservedByPump = false;

    if (!this.canStart(state)) {
      if (state.queue.length >= this.options.maxQueuedPerHost) {
        throw new Error(`Too many pending requests for ${key}`);
      }
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          const index = state.queue.indexOf(release);
          if (index >= 0) {
            state.queue.splice(index, 1);
          }
          reject(new Error(`Rate limit wait exceeded for ${key}`));
        }, this.options.maxQueueWaitMs);

        function release() {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve();
        }

        state.queue.push(release);
        this.schedulePump(true);
      });
      reservedByPump = true;
    }

    if (!reservedByPump) {
      state.tokens = Math.max(0, state.tokens - 1);
      state.active += 1;
      this.totalActive += 1;
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      state.active = Math.max(0, state.active - 1);
      this.totalActive = Math.max(0, this.totalActive - 1);
      this.schedulePump(true);
    };
  }

  /** Test/diagnostic helper. */
  snapshot(host: string): {tokens: number; active: number; queued: number} {
    const state = this.hosts.get(this.getBucketKey(host));
    return {
      tokens: state?.tokens ?? this.options.burst,
      active: state?.active ?? 0,
      queued: state?.queue.length ?? 0,
    };
  }

  reset(): void {
    this.hosts.clear();
    this.totalActive = 0;
  }
}

export const providerRateLimiter = new DomainRateLimiter();
