import {describe, expect, it} from '@jest/globals';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import path from 'node:path';

// Exercise the real bundled worker and injected axios, not a copied adapter.
const workerSource = buildSync({
  entryPoints: [path.join(__dirname, '../src/lib/sandbox/runtime/sandboxWorker.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
}).outputFiles[0].text;

const invokeWithHeaders = (headers: Array<[string, string]>, preamble = '') =>
  new Promise<any>((resolve, reject) => {
    const logs: any[] = [];
    let receive!: (event: {data: any}) => Promise<void>;
    runInNewContext(workerSource, {
      Response,
      Headers,
      URL,
      URLSearchParams,
      AbortController,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console,
      addEventListener: (_type: string, handler: typeof receive) => {
        receive = handler;
      },
      postMessage: (message: any) => {
        if (message.type === 'rpc') {
          void receive({data: {
            type: 'rpc-result', token: message.token, id: message.id,
            result: {
              status: 200, statusText: 'OK', url: 'https://example.com/final',
              headers, bodyBase64: Buffer.from('<form>continue</form>').toString('base64'),
            },
          }});
        } else if (message.type === 'log') {
          logs.push(message);
        } else if (message.type === 'result') {
          if (message.error) reject(new Error(message.error));
          else resolve({...message.result, logs});
        }
      },
    });
    void receive({data: {
      type: 'invoke', token: 'cookie-regression', exportName: 'getStream',
      moduleCode: `exports.getStream = async ({providerContext}) => {
        ${preamble}
        const response = await providerContext.axios.get('https://example.com/start');
        const cookies = response.headers['set-cookie'];
        return {
          cookies,
          cookieHeader: cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '',
          alias: response.headers['x-set-cookie'],
          contentType: response.headers['content-type'],
          responseURL: response.request.responseURL,
          data: response.data,
        };
      };`,
    }}).catch(reject);
  });

describe('provider axios cookie compatibility', () => {
  it('preserves individual cookies, Expires commas and alias deduplication for the UHD bypass', async () => {
    const cookies = [
      'lp_ck_test=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
      'token=abc; Path=/; HttpOnly',
    ];
    const result = await invokeWithHeaders([
      ['Set-Cookie', cookies[0]], ['set-cookie', cookies[1]],
      ['x-set-cookie', cookies[0]], ['x-set-cookie', cookies[1]],
      ['Content-Type', 'text/html'],
    ]);
    expect(result.cookies).toEqual(cookies);
    expect(result.alias).toEqual(cookies);
    expect(result.cookieHeader).toBe('lp_ck_test=1; token=abc');
    expect(result.contentType).toBe('text/html');
    expect(result.responseURL).toBe('https://example.com/final');
    expect(result.data).toBe('<form>continue</form>');
  });

  it('also exposes alias-only cookies as an array', async () => {
    const result = await invokeWithHeaders([['x-set-cookie', 'session=123; Path=/']]);
    expect(result.cookies).toEqual(['session=123; Path=/']);
    expect(result.cookieHeader).toBe('session=123');
  });

  it('does not invent cookies when none were returned', async () => {
    const result = await invokeWithHeaders([['Content-Type', 'text/html']]);
    expect(result.cookies).toBeUndefined();
    expect(result.alias).toBeUndefined();
    expect(result.cookieHeader).toBe('');
  });

  it('relays swallowed provider warnings with bounded message count and size', async () => {
    const result = await invokeWithHeaders([], `
      for (let i = 0; i < 40; i++) console.warn('bypass failed', 'x'.repeat(3000));
    `);
    expect(result.logs).toHaveLength(32);
    expect(result.logs[0].level).toBe('warn');
    expect(result.logs[0].message).toMatch(/^bypass failed /);
    expect(result.logs.every((log: any) => log.message.length <= 2000)).toBe(true);
  });
});
