interface NativeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: string;
}

let cookieManager: any = null;
export const getCookieManager = () => {
  if (cookieManager) {
    return cookieManager;
  }
  try {
    cookieManager = require('@preeternal/react-native-cookie-manager').default;
  } catch (e) {
    console.warn('[cookieManager] native module unavailable', e);
    cookieManager = null;
  }
  return cookieManager;
};

// Case-insensitive lookup of the User-Agent from a headers object.
export const pickUserAgent = (
  h?: Record<string, string>,
): string | undefined => {
  if (!h) {
    return undefined;
  }
  const key = Object.keys(h).find(k => k.toLowerCase() === 'user-agent');
  return key ? h[key] : undefined;
};

export const getCookieObjects = async (
  url: string,
): Promise<NativeCookie[]> => {
  const CookieManager = getCookieManager();
  if (!CookieManager) {
    return [];
  }
  try {
    await CookieManager.flush();
  } catch {}
  const stores = await Promise.all([
    CookieManager.get(url, true).catch(() => ({})),
    CookieManager.get(url, false).catch(() => ({})),
  ]);
  const cookies: NativeCookie[] = [];
  const seen = new Set<string>();
  for (const store of stores) {
    for (const key of Object.keys(store)) {
      const cookie = store[key] as NativeCookie;
      if (cookie?.name) {
        const identity = `${cookie.name}\u0000${cookie.domain ?? ''}\u0000${
          cookie.path ?? ''
        }\u0000${cookie.value}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          cookies.push(cookie);
        }
      }
    }
  }
  return cookies;
};

// Reads cookies for `url` as a name -> value map.
export const getCookies = async (
  url: string,
): Promise<Record<string, string>> => {
  const objects = await getCookieObjects(url);
  const map: Record<string, string> = {};
  for (const cookie of objects) {
    map[cookie.name] = cookie.value;
  }
  return map;
};

// Builds the request header from native cookie objects without collapsing
// same-name cookies that are scoped to different domains or paths.
export const getCookieHeader = async (url: string): Promise<string> => {
  const objects = await getCookieObjects(url);
  return objects.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
};

// Deletes a specific cookie for a URL
export const deleteCookie = async (
  url: string,
  name: string,
): Promise<void> => {
  const CookieManager = getCookieManager();
  if (!CookieManager) return;
  try {
    try {
      if (CookieManager.clearByName) {
        await CookieManager.clearByName(url, name);
      } else {
        throw new Error('Not implemented');
      }
    } catch {
      // Android workaround: set it to empty and expired
      await CookieManager.set(url, {
        name,
        value: '',
        expires: '1970-01-01T00:00:00.00Z',
        path: '/',
      });
    }
    await CookieManager.flush();
  } catch (e) {
    console.warn('[cookieManager] failed to delete cookie', e);
  }
};

export const clearAllCookies = async (): Promise<void> => {
  const CookieManager = getCookieManager();
  if (CookieManager) {
    await CookieManager.clearAll();
  }
};

// Builds a Cookie header value from a name -> value map.
export const buildCookieString = (map: Record<string, string>): string =>
  Object.entries(map)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

// Sets cookie string into native CookieManager so OkHttpClient (RCTNetworking) sends them
export const setCookieString = async (
  url: string,
  cookieString: string,
): Promise<void> => {
  const CookieManager = getCookieManager();
  if (!CookieManager || !cookieString) return;
  try {
    if (typeof CookieManager.setFromResponse === 'function') {
      try {
        await CookieManager.setFromResponse(url, cookieString);
        await CookieManager.flush();
        return;
      } catch {}
    }

    const ATTRIBUTES = new Set([
      'expires',
      'max-age',
      'path',
      'domain',
      'samesite',
      'priority',
      'secure',
      'httponly',
    ]);

    const parts = cookieString.split(';').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const name = part.slice(0, eqIdx).trim();
        const value = part.slice(eqIdx + 1).trim();
        if (name && value && !ATTRIBUTES.has(name.toLowerCase())) {
          await CookieManager.set(url, {
            name,
            value,
            path: '/',
          });
        }
      }
    }
    await CookieManager.flush();
  } catch (e) {
    console.warn('[cookieManager] failed to set cookie string', e);
  }
};
