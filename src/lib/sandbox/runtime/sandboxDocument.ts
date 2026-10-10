/**
 * Sandbox document: the WebView page that hosts provider workers.
 *
 * It holds no provider code itself. Its only jobs are:
 *  - spawn one nested Worker per invoke (fresh realm, no shared prototypes)
 *  - relay RPC frames between the worker and the native host
 *  - terminate a worker that overruns its timeout, which is the only way to
 *    stop a runaway `while (true) {}`
 *
 * The worker bundle is inlined at build time as `__WORKER_SOURCE__`.
 */
import type {HostMessage, SandboxMessage} from '../protocol';

declare const __WORKER_SOURCE__: string;

interface NativeBridge {
  postMessage: (message: string) => void;
}

const nativeBridge = (window as unknown as {ReactNativeWebView: NativeBridge})
  .ReactNativeWebView;

const send = (message: SandboxMessage): void => {
  try {
    nativeBridge.postMessage(JSON.stringify(message));
  } catch {
    // Nothing else to do: the bridge is the only channel out.
  }
};

interface ActiveInvoke {
  worker: Worker;
  timer: number;
}

const active = new Map<string, ActiveInvoke>();
let workerUrl = '';

const getWorkerUrl = (): string => {
  if (!workerUrl) {
    const blob = new Blob([__WORKER_SOURCE__], {
      type: 'application/javascript',
    });
    workerUrl = URL.createObjectURL(blob);
  }
  return workerUrl;
};

/**
 * A single idle worker kept ready so the bundle parse/compile cost happens
 * before the next invoke instead of on the user's critical path.
 *
 * This does NOT weaken isolation: a warm worker has never received an `invoke`
 * message, so it has executed no provider code and shares no state. Each
 * provider call still gets its own fresh realm that is terminated afterwards.
 */
let warmWorker: Worker | null = null;

const spawnWorker = (): Worker => new Worker(getWorkerUrl());

const prewarmWorker = (): void => {
  if (warmWorker) {
    return;
  }
  try {
    warmWorker = spawnWorker();
  } catch {
    // If pre-warming fails we simply fall back to spawning on demand.
    warmWorker = null;
  }
};

const takeWorker = (): Worker => {
  const worker = warmWorker ?? spawnWorker();
  warmWorker = null;
  // Kick off the next warm worker so it is ready for the following invoke.
  prewarmWorker();
  return worker;
};

const cleanup = (token: string): void => {
  const entry = active.get(token);
  if (!entry) {
    return;
  }
  active.delete(token);
  clearTimeout(entry.timer);
  try {
    entry.worker.terminate();
  } catch {
    // already gone
  }
};

const handleInvoke = (
  message: Extract<HostMessage, {type: 'invoke'}>,
): void => {
  const {token} = message;
  if (active.has(token)) {
    return;
  }

  let worker: Worker;
  try {
    worker = takeWorker();
  } catch (error) {
    // Fail closed rather than falling back to the document realm, which would
    // silently give provider code a DOM and an escape route.
    send({
      type: 'result',
      token,
      error: `Sandbox worker unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return;
  }

  const timer = setTimeout(() => {
    cleanup(token);
    send({type: 'result', token, error: 'Provider execution timed out'});
  }, message.timeoutMs) as unknown as number;

  active.set(token, {worker, timer});

  worker.onmessage = (event: MessageEvent<SandboxMessage>) => {
    const payload = event.data;
    if (!payload || !('type' in payload)) {
      return;
    }
    if (payload.type === 'rpc' || payload.type === 'log') {
      send(payload);
      return;
    }
    if (payload.type === 'result') {
      send(payload);
      cleanup(token);
    }
  };

  worker.onerror = event => {
    send({
      type: 'result',
      token,
      error: event.message || 'Provider execution failed',
    });
    cleanup(token);
  };

  worker.postMessage(message);
};

const handleHostMessage = (message: HostMessage): void => {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'invoke') {
    handleInvoke(message);
    return;
  }
  if (message.type === 'cancel') {
    cleanup(message.token);
    return;
  }
  if (message.type === 'rpc-result') {
    const entry = active.get(message.token);
    if (entry) {
      entry.worker.postMessage(message);
    }
  }
};

/**
 * Native entry point. Frames arrive as a JSON-quoted string literal, so no
 * quoting or line separator (U+2028/U+2029) can break out of the injected
 * script.
 */
(window as unknown as Record<string, unknown>).__sandboxReceive = (
  encoded: string,
) => {
  try {
    handleHostMessage(JSON.parse(encoded) as HostMessage);
  } catch (error) {
    send({
      type: 'log',
      level: 'error',
      message: `Malformed host frame: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
};

// Warm the first worker up front so even the initial invoke skips the cold
// parse/compile of the worker bundle.
prewarmWorker();

send({type: 'ready'});
