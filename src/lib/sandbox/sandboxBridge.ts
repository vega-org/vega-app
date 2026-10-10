import {
  MAX_MODULE_SIZE,
  SANDBOX_INVOKE_TIMEOUT_MS,
  type HostMessage,
  type SandboxMessage,
} from './protocol';
import {handleProviderRpc} from './providerRpc';
import {providerAbortError} from './abort';

/**
 * Native side transport for the provider sandbox.
 *
 * Owns the single hidden WebView that hosts provider workers, correlates
 * invokes by token, relays RPC frames, and enforces the invoke timeout from the
 * native side as a backstop to the document's own timer.
 */

type Injector = (script: string) => void;

interface PendingInvoke {
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
  private injector: Injector | null = null;
  private ready = false;
  private readonly queue: HostMessage[] = [];
  private readonly pending = new Map<string, PendingInvoke>();
  private reloadRequester: (() => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called by the host component once the WebView is mounted. */
  register(injector: Injector, requestReload: () => void): void {
    this.injector = injector;
    this.reloadRequester = requestReload;
    this.startReadyTimer();
  }

  unregister(): void {
    this.injector = null;
    this.ready = false;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.queue.length = 0;
    for (const token of Array.from(this.pending.keys())) {
      this.settle(token, new Error('Provider sandbox was torn down'));
    }
  }

  private post(message: HostMessage): void {
    const invocation =
      message.type === 'invoke' ? this.pending.get(message.token) : undefined;
    if (message.type === 'invoke' && !invocation) return;
    if (invocation && this.activeInvokes >= this.maxActiveInvokes) {
      this.queue.push(message);
      return;
    }
    if (!this.injector || !this.ready) {
      this.queue.push(message);
      return;
    }
    if (invocation) {
      invocation.started = true;
      this.activeInvokes++;
      clearTimeout(invocation.timer);
      invocation.timer = setTimeout(() => {
        // Block admission before settling: settle flushes queued invokes,
        // but a timed-out host is about to be reloaded.
        this.ready = false;
        this.settle(
          message.token,
          new Error(`Provider ${invocation.providerValue} timed out`),
        );
        this.handleReload();
        this.reloadRequester?.();
      }, SANDBOX_INVOKE_TIMEOUT_MS + 5_000);
    }
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
    this.injector(`window.__sandboxReceive(${JSON.stringify(frame)});true;`);
    if (frame.length > 64 * 1024) {
      console.log(
        `[ProviderPerf] post ${message.type} ${Math.round(
          frame.length / 1024,
        )}KB ${Date.now() - encodeStart}ms`,
      );
    }
  }

  private flush(): void {
    if (!this.ready) {
      return;
    }
    const queued = this.queue.splice(0, this.queue.length);
    for (const message of queued) {
      this.post(message);
    }
  }

  private startReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
    }
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.ready) {
        return;
      }
      this.queue.length = 0;
      for (const token of Array.from(this.pending.keys())) {
        this.settle(token, new Error('Provider sandbox failed to start'));
      }
    }, 15_000);
  }

  private settle(token: string, error: Error | null, result?: unknown): void {
    const entry = this.pending.get(token);
    if (!entry) {
      return;
    }
    this.pending.delete(token);
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
  handleSandboxMessage = (raw: string): void => {
    let message: SandboxMessage;
    try {
      message = JSON.parse(raw) as SandboxMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.ready = true;
        if (this.readyTimer) {
          clearTimeout(this.readyTimer);
          this.readyTimer = null;
        }
        this.flush();
        return;

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
        handleProviderRpc(
          entry.providerValue,
          entry.author,
          message.operation,
          message.args,
          entry.controller.signal,
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

      case 'result':
        if (message.error) {
          this.settle(message.token, new Error(message.error));
        } else {
          const entry = this.pending.get(message.token);
          if (entry && message.state) {
            onStateSaved?.(entry.providerValue, entry.author, message.state);
          }
          this.settle(message.token, null, message.result);
        }
        return;
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

      this.pending.set(token, {
        controller: new AbortController(),
        started: false,
        providerValue,
        author,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        onAbort,
        signal,
      });

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
  handleReload(): void {
    this.ready = false;
    this.queue.length = 0;
    for (const token of Array.from(this.pending.keys())) {
      this.settle(token, new Error('Provider sandbox reloaded'));
    }
    this.startReadyTimer();
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
