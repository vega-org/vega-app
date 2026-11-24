import {
  MAX_MODULE_SIZE,
  SANDBOX_INVOKE_TIMEOUT_MS,
  type HostMessage,
  type SandboxMessage,
} from './protocol';
import {handleProviderRpc} from './providerRpc';
import {providerAbortError} from './abort';
import {registerWafOperation} from '../services/wafSession';

/**
 * Native side transport for the provider sandbox.
 *
 * Owns foreground/background WebView hosts that run provider workers,
 * correlates invokes by token, relays RPC frames, and enforces the invoke
 * timeout from the native side as a backstop to the document's own timer.
 */

export type SandboxHostKind = 'foreground' | 'background';

type Injector = (script: string) => void;

interface SandboxHost {
  id: number;
  kind: SandboxHostKind;
  injector: Injector;
  requestReload: () => void;
  ready: boolean;
}

interface PendingInvoke {
  hostId: number | null;
  wafScope: AbortSignal;
  releaseWafScope: () => void;
  controller: AbortController;
  started: boolean;
  providerValue: string;
  /** Source author of the running code; scopes its storage and cookies. */
  author: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
}

const randomToken = (): string => {
  let token = '';
  for (let i = 0; i < 4; i++) {
    token += Math.random().toString(36).slice(2, 10);
  }
  return token;
};

class SandboxBridge {
  private activeInvokes = 0;
  private readonly maxActiveInvokes = 2;
  private nextHostId = 1;
  private foregroundHost: SandboxHost | null = null;
  private backgroundHost: SandboxHost | null = null;
  private activeHostId: number | null = null;
  private readonly queue: HostMessage[] = [];
  private readonly pending = new Map<string, PendingInvoke>();
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  private getHostById(id: number): SandboxHost | null {
    if (this.foregroundHost?.id === id) return this.foregroundHost;
    if (this.backgroundHost?.id === id) return this.backgroundHost;
    return null;
  }

  private getActiveHost(): SandboxHost | null {
    if (this.activeHostId !== null) {
      const active = this.getHostById(this.activeHostId);
      if (active) return active;
    }
    return this.foregroundHost ?? this.backgroundHost;
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  /** Returns true while a foreground or background sandbox host is attached. */
  isRegistered(): boolean {
    return this.getActiveHost() !== null;
  }

  /** Returns true while the currently active sandbox host has reported ready. */
  isReady(): boolean {
    return Boolean(this.getActiveHost()?.ready);
  }

  /** Called by the host component or headless runner once the WebView is mounted. */
  register(
    injector: Injector,
    requestReload: () => void,
    kind: SandboxHostKind = 'foreground',
  ): number {
    const host: SandboxHost = {
      id: this.nextHostId++,
      kind,
      injector,
      requestReload,
      ready: false,
    };
    if (kind === 'foreground') {
      this.foregroundHost = host;
      if (this.backgroundHost === null) {
        this.activeHostId = host.id;
        this.startReadyTimer();
      }
    } else {
      this.backgroundHost = host;
      this.activeHostId = host.id;
      this.startReadyTimer();
    }
    return host.id;
  }

  unregister(hostId?: number): void {
    if (hostId === undefined) {
      this.foregroundHost = null;
      this.backgroundHost = null;
      this.activeHostId = null;
      this.clearReadyTimer();
      this.queue.length = 0;
      for (const token of Array.from(this.pending.keys())) {
        this.settle(token, new Error('Provider sandbox was torn down'));
      }
      return;
    }

    const wasActive = this.activeHostId === hostId;
    if (this.foregroundHost?.id === hostId) {
      this.foregroundHost = null;
    } else if (this.backgroundHost?.id === hostId) {
      this.backgroundHost = null;
    } else {
      return;
    }

    for (const [token, entry] of Array.from(this.pending.entries())) {
      if (entry.hostId === hostId) {
        this.settle(token, new Error('Provider sandbox was torn down'));
      }
    }

    if (!wasActive) {
      return;
    }

    const fallback = this.foregroundHost ?? this.backgroundHost;
    if (!fallback) {
      this.activeHostId = null;
      this.clearReadyTimer();
      this.queue.length = 0;
      for (const token of Array.from(this.pending.keys())) {
        this.settle(token, new Error('Provider sandbox was torn down'));
      }
      return;
    }

    this.activeHostId = fallback.id;
    this.clearReadyTimer();
    if (fallback.ready) {
      this.flush();
    } else if (this.pending.size > 0) {
      this.startReadyTimer();
    }
  }

  /** Promotes a ready foreground host or reloads a stalled host if its ready timer expired. */
  ensureReady(hostId?: number): void {
    const host =
      hostId !== undefined ? this.getHostById(hostId) : this.getActiveHost();
    if (!host) {
      return;
    }
    if (host === this.foregroundHost && host.ready) {
      this.activeHostId = host.id;
      this.clearReadyTimer();
      this.flush();
      return;
    }
    if (host.ready) {
      return;
    }
    if (host.id === this.activeHostId && this.readyTimer) {
      return;
    }
    if (host.id === this.activeHostId) {
      this.startReadyTimer();
    }
    host.requestReload();
  }

  private injectMessage(host: SandboxHost, message: HostMessage): void {
    // The frame goes in as a JSON-quoted string literal: JSON.stringify
    // escapes quotes and backslashes, so provider data cannot break out of
    // the injected script. U+2028/U+2029 are escaped by hand because older
    // WebViews (Chrome < 66) reject them inside string literals. This used to
    // be base64, which costs a slow per-character pass on Hermes for every
    // response body.
    const encodeStart = Date.now();
    const frame = JSON.stringify(message)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    host.injector(`window.__sandboxReceive(${JSON.stringify(frame)});true;`);
    if (frame.length > 64 * 1024) {
      console.log(
        `[ProviderPerf] post ${message.type} ${Math.round(
          frame.length / 1024,
        )}KB ${Date.now() - encodeStart}ms`,
      );
    }
  }

  private post(message: HostMessage): void {
    const invocation =
      message.type === 'invoke' ||
      message.type === 'rpc-result' ||
      message.type === 'cancel'
        ? this.pending.get(message.token)
        : undefined;
    if (message.type === 'invoke') {
      if (!invocation) return;
      if (this.activeInvokes >= this.maxActiveInvokes) {
        this.queue.push(message);
        return;
      }
      const host = this.getActiveHost();
      if (!host || !host.ready) {
        this.queue.push(message);
        return;
      }
      invocation.started = true;
      invocation.hostId = host.id;
      this.activeInvokes++;
      clearTimeout(invocation.timer);
      const timedOutHostId = host.id;
      invocation.timer = setTimeout(() => {
        // Block admission before settling: settle flushes queued invokes,
        // but a timed-out host is about to be reloaded.
        const timedOutHost = this.getHostById(timedOutHostId);
        if (timedOutHost) {
          timedOutHost.ready = false;
        }
        this.settle(
          message.token,
          new Error(`Provider ${invocation.providerValue} timed out`),
        );
        this.handleReload(timedOutHostId);
        timedOutHost?.requestReload();
      }, SANDBOX_INVOKE_TIMEOUT_MS + 5_000);
      this.injectMessage(host, message);
      return;
    }

    const targetHost =
      invocation?.hostId != null
        ? this.getHostById(invocation.hostId)
        : this.getActiveHost();
    if (!targetHost || !targetHost.ready) {
      if (message.type === 'cancel') return;
      this.queue.push(message);
      return;
    }
    this.injectMessage(targetHost, message);
  }

  private flush(): void {
    const activeHost = this.getActiveHost();
    if (!activeHost || !activeHost.ready) {
      return;
    }
    const queued = this.queue.splice(0, this.queue.length);
    for (const message of queued) {
      this.post(message);
    }
  }

  private startReadyTimer(): void {
    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      const host = this.getActiveHost();
      if (!host || host.ready) {
        return;
      }
      this.queue.length = 0;
      for (const [token, entry] of Array.from(this.pending.entries())) {
        if (entry.hostId === null || entry.hostId === host.id) {
          this.settle(token, new Error('Provider sandbox failed to start'));
        }
      }
    }, 15_000);
  }

  private settle(token: string, error: Error | null, result?: unknown): void {
    const entry = this.pending.get(token);
    if (!entry) {
      return;
    }
    this.pending.delete(token);
    entry.releaseWafScope();
    entry.controller.abort();
    if (entry.started) this.activeInvokes--;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const queued = this.queue[i];
      if ('token' in queued && queued.token === token) this.queue.splice(i, 1);
    }
    clearTimeout(entry.timer);
    if (entry.onAbort && entry.signal) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    if (error) {
      entry.reject(error);
    } else {
      entry.resolve(result);
    }
    this.flush();
  }

  /** WebView `onMessage` handler. */
  handleSandboxMessage = (raw: string, hostId?: number): void => {
    let message: SandboxMessage;
    try {
      message = JSON.parse(raw) as SandboxMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    const targetHost =
      hostId !== undefined ? this.getHostById(hostId) : this.getActiveHost();
    if (hostId !== undefined && !targetHost) {
      return;
    }

    switch (message.type) {
      case 'ready': {
        if (!targetHost) {
          return;
        }
        targetHost.ready = true;
        if (
          targetHost === this.foregroundHost &&
          this.activeHostId !== targetHost.id
        ) {
          this.activeHostId = targetHost.id;
        }
        if (targetHost.id === this.activeHostId) {
          this.clearReadyTimer();
          this.flush();
        }
        return;
      }

      case 'log':
        if (message.level === 'error') {
          console.error('[provider sandbox]', message.message);
        } else if (message.level === 'warn') {
          console.warn('[provider sandbox]', message.message);
        } else {
          console.log('[provider sandbox]', message.message);
        }
        return;

      case 'rpc': {
        const entry = this.pending.get(message.token);
        if (!entry) {
          return;
        }
        if (hostId !== undefined && entry.hostId !== hostId) {
          return;
        }
        handleProviderRpc(
          entry.providerValue,
          entry.author,
          message.operation,
          message.args,
          entry.controller.signal,
          entry.wafScope,
        )
          .then(result => {
            if (this.pending.get(message.token) !== entry) return;
            this.post({
              type: 'rpc-result',
              token: message.token,
              id: message.id,
              result,
            });
          })
          .catch(error => {
            if (this.pending.get(message.token) !== entry) return;
            this.post({
              type: 'rpc-result',
              token: message.token,
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      case 'result': {
        const entry = this.pending.get(message.token);
        if (!entry) {
          return;
        }
        if (hostId !== undefined && entry.hostId !== hostId) {
          return;
        }
        if (message.error) {
          this.settle(message.token, new Error(message.error));
        } else {
          if (message.state) {
            onStateSaved?.(entry.providerValue, entry.author, message.state);
          }
          this.settle(message.token, null, message.result);
        }
        return;
      }
    }
  };

  invoke<T>(params: {
    moduleCode: string;
    providerValue: string;
    author: string;
    exportName?: string;
    args?: Record<string, unknown>;
    state: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<T> {
    const {moduleCode, providerValue, author, exportName, args, state, signal} =
      params;

    if (moduleCode.length > MAX_MODULE_SIZE) {
      return Promise.reject(new Error('Provider module is too large'));
    }
    if (signal?.aborted) {
      return Promise.reject(providerAbortError());
    }
    if (this.pending.size >= 64)
      return Promise.reject(new Error('Too many queued provider requests'));

    const token = randomToken();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(
          token,
          new Error(`Provider ${providerValue} queue wait timed out`),
        );
      }, 60_000);

      const onAbort = () => {
        if (this.pending.get(token)?.started)
          this.post({type: 'cancel', token});
        this.settle(token, providerAbortError());
      };
      signal?.addEventListener('abort', onAbort, {once: true});

      const controller = new AbortController();
      const wafScope = signal ?? controller.signal;
      this.pending.set(token, {
        hostId: null,
        controller,
        wafScope,
        releaseWafScope: registerWafOperation(wafScope),
        started: false,
        providerValue,
        author,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        onAbort,
        signal,
      });

      const activeHost = this.getActiveHost();
      if (activeHost && !activeHost.ready && !this.readyTimer) {
        this.startReadyTimer();
        activeHost.requestReload();
      }

      this.post({
        type: 'invoke',
        token,
        moduleCode,
        exportName,
        args,
        state,
        timeoutMs: SANDBOX_INVOKE_TIMEOUT_MS,
      });
    });
  }

  /** Called by the host component when the WebView reloads. */
  handleReload(hostId?: number): void {
    const host =
      hostId !== undefined ? this.getHostById(hostId) : this.getActiveHost();
    if (!host) {
      return;
    }
    host.ready = false;
    if (host.id === this.activeHostId) {
      this.queue.length = 0;
      for (const [token, entry] of Array.from(this.pending.entries())) {
        if (entry.hostId === host.id || entry.hostId === null) {
          this.settle(token, new Error('Provider sandbox reloaded'));
        }
      }
      this.startReadyTimer();
      return;
    }
    for (const [token, entry] of Array.from(this.pending.entries())) {
      if (entry.hostId === host.id) {
        this.settle(token, new Error('Provider sandbox reloaded'));
      }
    }
  }
}

let onStateSaved:
  | ((
      providerValue: string,
      author: string,
      state: Record<string, unknown>,
    ) => void)
  | null = null;

/** ProviderManager registers here so provider state survives across invokes. */
export const setSandboxStateHandler = (
  handler: (
    providerValue: string,
    author: string,
    state: Record<string, unknown>,
  ) => void,
): void => {
  onStateSaved = handler;
};

export const sandboxBridge = new SandboxBridge();
