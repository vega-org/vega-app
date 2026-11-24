import {afterEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('../src/lib/sandbox/providerRpc', () => ({
  handleProviderRpc: jest.fn(),
}));

import {sandboxBridge} from '../src/lib/sandbox/sandboxBridge';
import {SANDBOX_INVOKE_TIMEOUT_MS} from '../src/lib/sandbox/protocol';
import {handleProviderRpc} from '../src/lib/sandbox/providerRpc';

const PREFIX = 'window.__sandboxReceive(';
const SUFFIX = ');true;';

// The frame is a JSON string literal holding the JSON message.
const decodeInjected = (script: string) => {
  if (!script.startsWith(PREFIX) || !script.endsWith(SUFFIX)) {
    throw new Error(`Unexpected injected script: ${script}`);
  }
  const literal = script.slice(PREFIX.length, -SUFFIX.length);
  return JSON.parse(JSON.parse(literal));
};

describe('sandboxBridge', () => {
  it('reloads a wedged host on the native timeout backstop', async () => {
    jest.useFakeTimers();
    const injected: string[] = [];
    const reload = jest.fn();
    sandboxBridge.register(script => injected.push(script), reload);
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));
    const calls = Promise.allSettled(Array.from({length: 2}, () => sandboxBridge.invoke({moduleCode: 'code', providerValue: 'p', author: 'x', state: {}})));
    expect(injected).toHaveLength(2);
    jest.advanceTimersByTime(SANDBOX_INVOKE_TIMEOUT_MS);
    // Queue late so this request has not expired when the host times out.
    const queued = Promise.allSettled([sandboxBridge.invoke({moduleCode: 'code', providerValue: 'queued', author: 'x', state: {}})]);
    jest.advanceTimersByTime(5_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(injected.map(decodeInjected).filter(frame => frame.type === 'invoke')).toHaveLength(2);
    expect((await calls).every(result => result.status === 'rejected')).toBe(true);
    expect((await queued)[0].status).toBe('rejected');
    sandboxBridge.unregister();
    jest.useRealTimers();
  });

  it('bounds active invokes and removes cancelled queued calls', async () => {
    const injected: string[] = [];
    sandboxBridge.register(script => injected.push(script), jest.fn());
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));
    const controllers = Array.from({length: 5}, () => new AbortController());
    const completed = Promise.allSettled(
      controllers.map((controller, i) =>
        sandboxBridge.invoke({
          moduleCode: 'code',
          providerValue: 'p' + i,
          author: 'x',
          state: {},
          signal: controller.signal,
        }),
      ),
    );
    expect(injected).toHaveLength(2);
    controllers[4].abort();
    expect(injected).toHaveLength(2);
    for (let i = 0; i < injected.length; i++) {
      const frame = decodeInjected(injected[i]);
      sandboxBridge.handleSandboxMessage(
        JSON.stringify({type: 'result', token: frame.token, result: []}),
      );
    }
    expect(injected).toHaveLength(4);
    expect(
      (await completed).filter(result => result.status === 'fulfilled'),
    ).toHaveLength(4);
  });

  it('aborts host RPC work and never injects its late response', async () => {
    const injected: string[] = [];
    let resolveRpc!: (value: unknown) => void;
    (
      handleProviderRpc as jest.MockedFunction<typeof handleProviderRpc>
    ).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRpc = resolve;
        }),
    );
    sandboxBridge.register(script => injected.push(script), jest.fn());
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));
    const controller = new AbortController();
    const invocation = sandboxBridge.invoke({
      moduleCode: 'code',
      providerValue: 'p',
      author: 'x',
      state: {},
      signal: controller.signal,
    });
    const outcome = expect(invocation).rejects.toMatchObject({
      name: 'AbortError',
    });
    const {token} = decodeInjected(injected[0]);
    sandboxBridge.handleSandboxMessage(
      JSON.stringify({
        type: 'rpc',
        token,
        id: 'rpc1',
        operation: 'fetch',
        args: {},
      }),
    );
    const rpcSignal = (
      handleProviderRpc as jest.MockedFunction<typeof handleProviderRpc>
    ).mock.calls.at(-1)![4];
    controller.abort();
    expect(rpcSignal?.aborted).toBe(true);
    resolveRpc({bodyBase64: 'obsolete'});
    await outcome;
    await Promise.resolve();
    expect(
      injected.map(decodeInjected).filter(frame => frame.type === 'rpc-result'),
    ).toHaveLength(0);
  });

  it('injects frames that provider data cannot break out of', () => {
    const injected: string[] = [];
    sandboxBridge.register(
      script => injected.push(script),
      () => {},
    );
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));
    const tricky = 'a"b\\c\u2028d\u2029e</script>);alert(1);//';
    sandboxBridge
      .invoke({
        moduleCode: tricky,
        providerValue: 'p',
        author: 'x',
        args: {},
        state: {},
      } as any)
      .catch(() => {});
    const script = injected[injected.length - 1];
    expect(script).not.toMatch(/[\u2028\u2029]/);
    // Evaluating the literal must give back exactly the frame that was sent.
    expect(decodeInjected(script).moduleCode).toBe(tricky);
  });

  afterEach(() => {
    sandboxBridge.unregister();
    jest.useRealTimers();
  });

  it('queues invokes until the sandbox reports ready', () => {
    const injected: string[] = [];
    sandboxBridge.register(script => injected.push(script), jest.fn());

    const invocation = sandboxBridge.invoke({
      moduleCode: 'exports.catalog = [];',
      providerValue: 'fixture',
      state: {},
    });

    expect(injected).toEqual([]);

    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));
    expect(injected).toHaveLength(1);
    const frame = decodeInjected(injected[0]);
    expect(frame.type).toBe('invoke');
    expect(frame.moduleCode).toBe('exports.catalog = [];');

    sandboxBridge.handleSandboxMessage(
      JSON.stringify({type: 'result', token: frame.token, result: []}),
    );
    return expect(invocation).resolves.toEqual([]);
  });

  it('sends a cancel frame and rejects when aborted', async () => {
    const injected: string[] = [];
    sandboxBridge.register(script => injected.push(script), jest.fn());
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));

    const controller = new AbortController();
    const invocation = sandboxBridge.invoke({
      moduleCode: 'while (true) {}',
      providerValue: 'fixture',
      state: {},
      signal: controller.signal,
    });

    const invokeFrame = decodeInjected(injected[0]);
    controller.abort();

    await expect(invocation).rejects.toThrow('Provider request aborted');
    expect(decodeInjected(injected[1])).toEqual({
      type: 'cancel',
      token: invokeFrame.token,
    });
  });

  it('rejects oversized modules before posting them', async () => {
    sandboxBridge.register(jest.fn(), jest.fn());
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}));

    await expect(
      sandboxBridge.invoke({
        moduleCode: 'x'.repeat(2_000_001),
        providerValue: 'fixture',
        state: {},
      }),
    ).rejects.toThrow('Provider module is too large');
  });

  it('keeps foreground host alive when background host unregisters and finishes in-flight invokes', async () => {
    const bgInjected: string[] = [];
    const fgInjected: string[] = [];
    const bgHostId = sandboxBridge.register(
      script => bgInjected.push(script),
      jest.fn(),
      'background',
    );
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}), bgHostId);

    const bgInvoke = sandboxBridge.invoke({
      moduleCode: 'exports.bg = 1;',
      providerValue: 'provBg',
      author: 'a',
      state: {},
    });
    const bgFrame = decodeInjected(bgInjected[0]);

    const fgHostId = sandboxBridge.register(
      script => fgInjected.push(script),
      jest.fn(),
      'foreground',
    );
    expect(fgInjected).toHaveLength(0);

    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}), fgHostId);
    const fgInvoke = sandboxBridge.invoke({
      moduleCode: 'exports.fg = 2;',
      providerValue: 'provFg',
      author: 'a',
      state: {},
    });
    const fgFrame = decodeInjected(fgInjected[0]);

    sandboxBridge.handleSandboxMessage(
      JSON.stringify({type: 'result', token: bgFrame.token, result: ['bg-ok']}),
      bgHostId,
    );
    await expect(bgInvoke).resolves.toEqual(['bg-ok']);

    sandboxBridge.unregister(bgHostId);
    expect(sandboxBridge.isRegistered()).toBe(true);
    expect(sandboxBridge.isReady()).toBe(true);

    sandboxBridge.handleSandboxMessage(
      JSON.stringify({type: 'result', token: fgFrame.token, result: ['fg-ok']}),
      fgHostId,
    );
    await expect(fgInvoke).resolves.toEqual(['fg-ok']);
  });

  it('falls back to unready foreground host when background host unregisters', async () => {
    const fgInjected: string[] = [];
    const bgHostId = sandboxBridge.register(jest.fn(), jest.fn(), 'background');
    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}), bgHostId);

    const fgHostId = sandboxBridge.register(
      script => fgInjected.push(script),
      jest.fn(),
      'foreground',
    );

    sandboxBridge.unregister(bgHostId);
    expect(sandboxBridge.isRegistered()).toBe(true);
    expect(sandboxBridge.isReady()).toBe(false);

    const fgInvoke = sandboxBridge.invoke({
      moduleCode: 'exports.fg = 3;',
      providerValue: 'provFg',
      author: 'a',
      state: {},
    });
    expect(fgInjected).toHaveLength(0);

    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}), fgHostId);
    expect(fgInjected).toHaveLength(1);
    const fgFrame = decodeInjected(fgInjected[0]);
    sandboxBridge.handleSandboxMessage(
      JSON.stringify({type: 'result', token: fgFrame.token, result: ['recovered']}),
      fgHostId,
    );
    await expect(fgInvoke).resolves.toEqual(['recovered']);
  });

  it('reloads and recovers on subsequent invoke after a ready timeout', async () => {
    jest.useFakeTimers();
    const injected: string[] = [];
    const reload = jest.fn();
    const hostId = sandboxBridge.register(
      script => injected.push(script),
      reload,
      'foreground',
    );

    const first = expect(
      sandboxBridge.invoke({
        moduleCode: 'exports.first = 1;',
        providerValue: 'prov',
        author: 'a',
        state: {},
      }),
    ).rejects.toThrow('Provider sandbox failed to start');

    jest.advanceTimersByTime(15_000);
    await first;
    expect(reload).not.toHaveBeenCalled();

    const second = sandboxBridge.invoke({
      moduleCode: 'exports.second = 2;',
      providerValue: 'prov',
      author: 'a',
      state: {},
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(injected).toHaveLength(0);

    sandboxBridge.handleSandboxMessage(JSON.stringify({type: 'ready'}), hostId);
    expect(injected).toHaveLength(1);
    const frame = decodeInjected(injected[0]);
    sandboxBridge.handleSandboxMessage(
      JSON.stringify({type: 'result', token: frame.token, result: ['ok']}),
      hostId,
    );
    await expect(second).resolves.toEqual(['ok']);
  });
});
