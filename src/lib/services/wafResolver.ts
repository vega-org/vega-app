import {authorizeVerification, VerificationDeniedError} from '../zustand/verificationConsentStore';
import {extensionStorage} from '../storage/extensionStorage';
import {providerAbortError, throwIfProviderAborted} from '../sandbox/abort';
import {providerFetch} from '../sandbox/providerFetch';
import {base64ToUtf8} from '../sandbox/base64';
import {headers as commonHeaders} from '../providers/headers';
import type {
  OpenWebViewOptions,
  OpenWebViewResult,
} from '../providers/types';
import {useWafStore} from '../zustand/wafStore';
import {buildCookieString, pickUserAgent} from './cookieManager';
import {providerAuthor} from '../sandbox/providerScope';
import {deleteJarCookie, getJarCookieMap} from '../sandbox/providerCookieJar';
import {
  canPromptWaf,
  dismissWafOperation,
  isWafOperationDismissed,
  registerWafOperation,
  wafCancelledError,
} from './wafSession';

/**
 * Opens a dialog WebView so the user can solve a WAF / captcha challenge
 * (e.g. Cloudflare) for the given URL.
 *
 * This is exposed to providers via `providerContext.openWebView`. A provider
 * that detects a WAF response should call this with the blocked URL and the
 * request headers it would normally use (passed via `options.headers`), then
 * await the result. The WebView loads the page with those headers; once the
 * challenge is solved the provider receives the page response (rendered HTML)
 * in `result.data` along with the page cookies.
 *
 * Shortcuts:
 *  - If `options.waitForCookie` is already present for the URL, it resolves
 *    immediately with the existing cookies and does NOT open the dialog
 *    (`result.data` is empty in this case).
 *  - If `options.force` is set, the dialog is always opened (the shortcut
 *    above is skipped). The dialog still auto-closes as soon as the awaited
 *    cookie is present.
 *
 * The returned promise:
 *  - resolves with the page response (`data`) and cookies (including httpOnly
 *    cookies) once the user taps "Done" or the optional `waitForCookie` is
 *    detected.
 *  - retries once over HTTP after dismissal; rejects if it remains blocked.
 * Other calls on the same domain wait, then fetch their own page with the jar.
 *
 * Cookies are read from and saved to the cookie jar of `author` (the
 * provider's source author), never another author's.
 */
// Pending dialogs, keyed by provider author and hostname.
const pendingRequests: Record<string, Promise<OpenWebViewResult>> = {};

const trackScope = (promise: Promise<OpenWebViewResult>, scope?: AbortSignal) => {
  if (scope) {
    const release = registerWafOperation(scope);
    promise.then(release, error => {
      if (error instanceof VerificationDeniedError) dismissWafOperation(scope);
      release();
    });
  }
  return promise;
};

export const openWebView = (
  url: string,
  options?: OpenWebViewOptions,
  authorRaw?: string,
  scope?: AbortSignal,
  providerValue?: string,
): Promise<OpenWebViewResult> => {
  if (scope?.aborted) return Promise.reject(providerAbortError());
  if (isWafOperationDismissed(scope)) return Promise.reject(wafCancelledError());
  const author = providerAuthor(authorRaw);
  if (!url) {
    return Promise.reject(new Error('openWebView: a url is required'));
  }

  const userAgent =
    pickUserAgent(options?.headers) || commonHeaders['User-Agent'];

  // Cookie jars are isolated by author. Paths and cookie options do not create
  // additional challenges for the same host, including while it is queued.
  const cacheKey = `${author}|${new URL(url).hostname.toLowerCase()}`;
  const retryPage = async (solved?: OpenWebViewResult): Promise<OpenWebViewResult> => {
    const retryUserAgent = solved?.userAgent || userAgent;
    const headers = Object.entries(options?.headers || {}).filter(
      ([name]) => !['cookie', 'user-agent'].includes(name.toLowerCase()),
    );
    headers.push(['User-Agent', retryUserAgent]);
    const response = await providerFetch(author, url, {
      method: 'GET', headers, body: {kind: 'none'},
    }, scope);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WAF retry failed: HTTP ${response.status}`);
    }
    const cookieMap = getJarCookieMap(author, response.url || url);
    return {
      data: base64ToUtf8(response.bodyBase64),
      cookies: buildCookieString(cookieMap), cookieMap,
      url: response.url || url, userAgent: retryUserAgent,
    };
  };
  const afterDismissal = async (error: unknown): Promise<OpenWebViewResult> => {
    if (!(error instanceof Error) || error.message !== 'WAF_DIALOG_CANCELLED') {
      throw error;
    }
    // One HTTP attempt only; this path never requests another dialog.
    try {
      return await retryPage();
    } catch {
      throw error;
    }
  };
  if (cacheKey in pendingRequests) {
    // Each waiter needs its own page, not the first catalog's HTML.
    return trackScope(pendingRequests[cacheKey].then(retryPage, afterDismissal), scope);
  }

  let dialogOpened = false;
  const execute = async (): Promise<OpenWebViewResult> => {
    // If not forced and the awaited cookie already exists, return it without a
    // dialog. In force mode we always open.
    if (!options?.force && options?.waitForCookie) {
      const cookieMap = getJarCookieMap(author, url);
      if (cookieMap[options.waitForCookie]) {
        return {
          data: '',
          cookies: buildCookieString(cookieMap),
          cookieMap,
          url,
          userAgent,
        };
      }
    }

    // Background work fails rather than opening a dialog; a solved cookie
    // above can still be reused.
    if (!canPromptWaf(scope)) throw wafCancelledError();

    const installed = extensionStorage.getInstalledProviders().find(provider =>
      provider.value === providerValue && providerAuthor(provider.source?.author) === author,
    );
    await authorizeVerification(installed?.display_name || providerValue || author, url, scope);
    throwIfProviderAborted(scope);
    if (!canPromptWaf(scope) || isWafOperationDismissed(scope)) throw wafCancelledError();
    if (options?.force && options.waitForCookie) deleteJarCookie(author, url, options.waitForCookie);

    return new Promise<OpenWebViewResult>((resolve, reject) => {
      dialogOpened = true;
      useWafStore.getState().enqueue({
        ...options,
        url,
        author,
        resolve,
        reject,
      });
    });
  };

  const promise = execute();

  // Always register the promise for coalescing, even if force: true
  pendingRequests[cacheKey] = promise;

  // Clean up on both outcomes. `then(cleanup, cleanup)` handles the
  // rejection, unlike `finally`, whose derived promise would reject unhandled.
  const cleanup = () => {
    if (pendingRequests[cacheKey] === promise) {
      delete pendingRequests[cacheKey];
    }
  };
  promise.then(cleanup, cleanup);

  return trackScope(promise.catch(error => {
    if (!dialogOpened) throw error;
    return afterDismissal(error);
  }), scope);
};
