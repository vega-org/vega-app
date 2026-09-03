import {NativeModules, Platform} from 'react-native';
import axios, {type AxiosRequestConfig} from 'axios';
import {headers as commonHeaders} from '../providers/headers';
import {getCookieHeader, setCookieString} from '../services/cookieManager';
import {bytesToBase64, base64ToBytes} from './base64';
import {providerRateLimiter} from './rateLimiter';
import {
  MAX_RESPONSE_BYTES,
  type SerializedRequest,
  type SerializedResponse,
} from './protocol';
import {isPrivateHostname, validateProviderUrl} from './urlGuard';

const REQUEST_TIMEOUT_MS = 30_000;

/** `Set-Cookie` is response-only. `Cookie` remains allowed for provider WAF flows. */
const BLOCKED_REQUEST_HEADERS = new Set(['set-cookie', 'set-cookie2']);

const toAxiosBody = (body: SerializedRequest['body']): unknown => {
  if (body.kind === 'none') {
    return undefined;
  }
  if (body.kind === 'text') {
    return body.value;
  }
  return base64ToBytes(body.value);
};

const normalizeHeaders = (
  entries: Array<[string, string]>,
): Record<string, string> => {
  const merged: Record<string, string> = {...commonHeaders};
  for (const [rawKey, value] of entries) {
    const key = String(rawKey).trim();
    if (!key || BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    // Reject header injection attempts outright.
    if (/[\r\n]/.test(key) || /[\r\n]/.test(String(value))) {
      throw new Error('Invalid header value');
    }
    merged[key] = String(value);
  }
  return merged;
};

const hasHeader = (headers: Record<string, string>, name: string): boolean =>
  Object.keys(headers).some(key => key.toLowerCase() === name.toLowerCase());

const toBytes = (data: unknown): Uint8Array => {
  if (data == null) {
    return new Uint8Array(0);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof data === 'string') {
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      // Axios returns binary strings on some RN versions.
      // eslint-disable-next-line no-bitwise
      bytes[i] = data.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  const text = JSON.stringify(data) ?? '';
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line no-bitwise
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
};

const flattenResponseHeaders = (raw: unknown): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  if (!raw || typeof raw !== 'object') {
    return entries;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      entries.push([key, value.join(', ')]);
    } else if (value != null) {
      entries.push([key, String(value)]);
    }
  }
  return entries;
};

export const providerFetch = async (
  rawUrl: unknown,
  request: SerializedRequest,
): Promise<SerializedResponse> => {
  const url = validateProviderUrl(rawUrl);
  const release = await providerRateLimiter.acquire(url.hostname);

  try {
    const headers = normalizeHeaders(request.headers ?? []);
    const body = request.body ?? {kind: 'none'};
    if (
      body.kind === 'base64' &&
      body.contentType &&
      !hasHeader(headers, 'content-type')
    ) {
      headers['Content-Type'] = body.contentType;
    }
    const cookieKey = Object.keys(headers).find(
      key => key.toLowerCase() === 'cookie',
    );
    if (cookieKey && headers[cookieKey]) {
      // Sync manual Cookie header into native Android CookieManager so OkHttpClient sends it
      await setCookieString(url.toString(), headers[cookieKey]);
    }
    const nativeCookieHeader = await getCookieHeader(url.toString());
    if (nativeCookieHeader) {
      if (cookieKey && headers[cookieKey]) {
        const suppliedCookieNames = new Set(
          headers[cookieKey]
            .split(';')
            .map(cookie => cookie.split('=', 1)[0]?.trim())
            .filter(Boolean),
        );
        const missingNativeCookies = nativeCookieHeader
          .split(';')
          .map(cookie => cookie.trim())
          .filter(cookie => !suppliedCookieNames.has(cookie.split('=', 1)[0]));
        if (missingNativeCookies.length) {
          headers[cookieKey] =
            `${headers[cookieKey]}; ${missingNativeCookies.join('; ')}`;
        }
      } else {
        headers.Cookie = nativeCookieHeader;
      }
    }

    if (Platform.OS === 'android' && NativeModules.ProviderHttpModule?.fetch) {
      const headerPairs: Array<[string, string]> = Object.entries(headers);
      const options: Record<string, any> = {
        method: (request.method || 'GET').toUpperCase(),
        headers: headerPairs,
        redirect: request.redirect || 'follow',
        timeoutMs: REQUEST_TIMEOUT_MS,
      };
      if (body.kind === 'base64') {
        options.bodyBase64 = body.value;
        if (body.contentType) options.contentType = body.contentType;
      } else if (body.kind === 'text') {
        options.bodyText = body.value;
      }

      const res = await NativeModules.ProviderHttpModule.fetch(url.toString(), options);
      const finalUrl: string = res.url || url.toString();
      try {
        const resolved = new URL(finalUrl);
        if (isPrivateHostname(resolved.hostname)) {
          throw new Error('Provider request redirected to a blocked host');
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('blocked host')) {
          throw error;
        }
      }

      return {
        status: res.status,
        statusText: res.statusText || '',
        url: finalUrl,
        headers: res.headers || [],
        bodyBase64: res.bodyBase64 || '',
      };
    }

    const abortController = new AbortController();
    const isManualRedirect = request.redirect === 'manual';
    let abortedEarly = false;

    const config: AxiosRequestConfig = {
      url: url.toString(),
      method: (
        request.method || 'GET'
      ).toUpperCase() as AxiosRequestConfig['method'],
      headers,
      data: toAxiosBody(body),
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: isManualRedirect ? 0 : 5,
      signal: abortController.signal,
      // Providers inspect non-2xx responses (WAF detection), so never throw.
      validateStatus: () => true,
      transformResponse: [],
      onDownloadProgress: (progressEvent: any) => {
        if (
          (isManualRedirect && progressEvent.loaded > 0) ||
          progressEvent.loaded > MAX_RESPONSE_BYTES ||
          (progressEvent.total && progressEvent.total > MAX_RESPONSE_BYTES)
        ) {
          abortedEarly = true;
          abortController.abort();
        }
      },
    };

    let response: any;
    try {
      response = await axios.request(config);
    } catch (err: any) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.name === 'AbortError' || abortedEarly) {
        abortedEarly = true;
        response = err.response || {
          status: isManualRedirect ? 302 : 200,
          statusText: isManualRedirect ? 'Found' : 'OK',
          headers: {},
          data: new Uint8Array(0),
          request: err.request,
        };
      } else {
        throw err;
      }
    }

    const finalUrl: string =
      (response.request?.responseURL as string | undefined) || url.toString();
    try {
      const resolved = new URL(finalUrl);
      if (isPrivateHostname(resolved.hostname)) {
        throw new Error('Provider request redirected to a blocked host');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('blocked host')) {
        throw error;
      }
      // Unparseable responseURL: fall through with the validated request URL.
    }

    const bytes = toBytes(response.data);
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Provider response is too large');
    }

    const resHeaders = flattenResponseHeaders(response.headers);
    if (isManualRedirect && finalUrl && !resHeaders.some(([k]) => k.toLowerCase() === 'location')) {
      resHeaders.push(['location', finalUrl]);
    }

    return {
      status: response.status,
      statusText: response.statusText ?? '',
      url: finalUrl,
      headers: resHeaders,
      bodyBase64: bytesToBase64(bytes),
    };
  } finally {
    release();
  }
};
