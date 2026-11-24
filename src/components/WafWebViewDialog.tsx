import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Modal,
  View,
  BackHandler,
} from 'react-native';
import {WebView, WebViewMessageEvent} from 'react-native-webview';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useWafStore, WafRequest} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import type {OpenWebViewResult} from '../lib/providers/types';
import {
  buildCookieString,
  clearSiteCookies,
  getCookieObjects,
  getCookies,
  pickUserAgent,
  setCookieString,
} from '../lib/services/cookieManager';
import {
  getJarCookieHeader,
  storeJarCookies,
} from '../lib/sandbox/providerCookieJar';
import {dismissWafOperations} from '../lib/services/wafSession';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import TVTouchable from './tv/TVTouchable';

const GRAB_HTML_JS =
  '(function(){try{window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true,html:document.documentElement.outerHTML}));}catch(e){}})(); true;';

const WafWebViewDialog = () => {
  const request = useWafStore(state => state.requests[0]);
  const remove = useWafStore(state => state.remove);
  const {primary, onPrimary} = useM3Colors();

  // The WebView mounts only after the site's native cookies are swapped for
  // the requesting author's, so it never sees another author's session.
  const [prepared, setPrepared] = useState(false);
  const webViewRef = useRef<WebView>(null);
  // Guards against settling the same request more than once.
  const settledRef = useRef(false);
  // Latest captured page HTML.
  const htmlRef = useRef('');
  // Set while waiting for a fresh HTML capture before resolving.
  const pendingResolveRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCookieValuesRef = useRef<Record<string, string>>({});
  const webViewReadyRef = useRef(false);

  const userAgent =
    pickUserAgent(request?.headers) || commonHeaders['User-Agent'];

  // Reset transient state whenever a new request becomes active.
  useEffect(() => {
    settledRef.current = false;
    pendingResolveRef.current = false;
    htmlRef.current = '';
    setPrepared(false);
    webViewReadyRef.current = false;
    initialCookieValuesRef.current = {};
    let cancelled = false;

    if (request) {
      (async () => {
        // The WebView shares the native cookie store, so start from this
        // author's cookies only.
        await clearSiteCookies(request.url).catch(() => {});
        const seed = getJarCookieHeader(request.author, request.url);
        if (seed) {
          await setCookieString(request.url, seed).catch(() => {});
        }
        // Snapshot existing cookies so we can detect new or updated cookies
        const cookieMap = await getCookies(request.url);
        if (!cancelled) {
          initialCookieValuesRef.current = cookieMap;
          webViewReadyRef.current = true;
          setPrepared(true);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [request?.id]);

  // Resolve the active request with the captured page response + cookies.
  const finalizeResolve = useCallback(
    async (req: WafRequest, dismiss?: boolean) => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      try {
        // Before preparation, the shared native jar may still belong to the
        // previous author. Never save that session into this author's jar.
        if (dismiss !== undefined && !webViewReadyRef.current) {
          if (dismiss) useWafStore.getState().cancelAll();
          else req.reject(new Error('WAF_DIALOG_CANCELLED'));
          return;
        }
        const [cookieObjects, cookieMap] = await Promise.all([
          getCookieObjects(req.url),
          getCookies(req.url),
        ]);
        const cookies = buildCookieString(cookieMap);
        let expiresAt: number | null = null;
        if (req.waitForCookie) {
          const matched = cookieObjects.find(c => c.name === req.waitForCookie);
          if (matched?.expires) {
            const parsed = Date.parse(matched.expires);
            if (!isNaN(parsed)) {
              expiresAt = parsed;
            }
          }
        }
        let host = '';
        try {
          host = new URL(req.url).hostname;
        } catch {}
        storeJarCookies(
          req.author,
          req.url,
          cookieObjects.map(cookie => {
            const expires = cookie.expires ? Date.parse(cookie.expires) : NaN;
            return {
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain || host,
              expiresAt: isNaN(expires) ? null : expires,
            };
          }),
        );
        const result: OpenWebViewResult = {
          data: htmlRef.current,
          cookies,
          cookieMap,
          url: req.url,
          userAgent,
          expires: expiresAt || undefined,
        };
        if (dismiss === true) useWafStore.getState().cancelAll();
        else if (dismiss === false) req.reject(new Error('WAF_DIALOG_CANCELLED'));
        else req.resolve(result);
      } catch (e) {
        if (dismiss === true) useWafStore.getState().cancelAll();
        else req.reject(
          dismiss === false ? new Error('WAF_DIALOG_CANCELLED') :
          e instanceof Error ? e : new Error('Failed to read page response'),
        );
      } finally {
        // Leave nothing of this author's session in the shared store before
        // the next request (maybe another author's) is shown.
        await clearSiteCookies(req.url).catch(() => {});
        remove(req.id);
      }
    },
    [remove, userAgent],
  );

  const cancel = useCallback((all = true) => {
    if (!request || settledRef.current) {
      return;
    }
    settledRef.current = true;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    // Block further prompts immediately, then save cookies before waking the
    // waiting HTTP requests. A challenge may have finished just before X.
    if (all) dismissWafOperations();
    finalizeResolve(request, all);
  }, [request, finalizeResolve]);

  const resolveWithPage = useCallback(() => {
    if (!request || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const req = request;
    pendingResolveRef.current = true;
    webViewRef.current?.injectJavaScript(GRAB_HTML_JS);
    fallbackTimerRef.current = setTimeout(() => {
      if (pendingResolveRef.current) {
        pendingResolveRef.current = false;
        finalizeResolve(req);
      }
    }, 1200);
  }, [request, finalizeResolve]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg && msg.__waf) {
          if (msg.data !== undefined || msg.token !== undefined) {
            if (!settledRef.current && request) {
              settledRef.current = true;
              const payload = msg.data !== undefined ? msg.data : msg.token;
              htmlRef.current =
                typeof payload === 'string'
                  ? payload
                  : JSON.stringify(payload);
              finalizeResolve(request);
            }
            return;
          }
          if (typeof msg.html === 'string') {
            htmlRef.current = msg.html;
            if (pendingResolveRef.current && request) {
              pendingResolveRef.current = false;
              finalizeResolve(request);
            }
          }
        }
      } catch {}
    },
    [request, finalizeResolve],
  );

  useEffect(() => {
    const cookieName = request?.waitForCookie;
    const url = request?.url;
    if (!cookieName || !url) {
      return;
    }
    let cancelled = false;

    const poll = async () => {
      if (cancelled || settledRef.current || !webViewReadyRef.current) {
        return;
      }
      const cookieMap = await getCookies(url);
      const currentVal = cookieMap[cookieName];
      const initialVal = initialCookieValuesRef.current[cookieName];

      // Auto-resolve when the awaited cookie is newly set or updated
      if (currentVal && (!initialVal || currentVal !== initialVal)) {
        resolveWithPage();
      }
    };

    poll();
    const interval = setInterval(poll, 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [request?.id, request?.waitForCookie, request?.url, resolveWithPage]);

  // Hardware back button cancels the dialog.
  useEffect(() => {
    if (!request) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => sub.remove();
  }, [request, cancel]);

  // Optional timeout cancels the dialog.
  useEffect(() => {
    if (!request?.timeoutMs) {
      return;
    }
    const timer = setTimeout(() => cancel(false), request.timeoutMs);
    return () => clearTimeout(timer);
  }, [request, cancel]);

  if (!request) {
    return null;
  }

  return (
    <Modal
      animationType="slide"
      visible={true}
      transparent={true}
      onRequestClose={() => cancel()}>
      <View className="flex-1 bg-black/60 justify-center items-center p-4">
        <View
          className="bg-tertiary rounded-2xl overflow-hidden w-full"
          style={{height: '80%', maxWidth: 560}}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3">
            <View className="flex-1 pr-2">
              <AppText
                className="text-white text-base font-bold"
                numberOfLines={1}>
                {request.title || 'Verify you are human'}
              </AppText>
              <AppText className="text-white/60 text-xs" numberOfLines={2}>
                {request.description ||
                  'Complete the challenge below, then tap Done.'}
              </AppText>
            </View>
            <TVTouchable accessibilityLabel="Cancel verification" onPress={() => cancel()} className="p-1">
              <MaterialIcons name="close" size={22} color="#c1c4c9" />
            </TVTouchable>
          </View>

          {/* WebView */}
          <View className="flex-1">
            {prepared ? (
            <WebView
              ref={webViewRef}
              source={{uri: request.url, headers: request.headers}}
              userAgent={userAgent}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              thirdPartyCookiesEnabled={true}
              sharedCookiesEnabled={true}
              injectedJavaScript={
                request.injectedJavaScript
                  ? `${request.injectedJavaScript};\n${GRAB_HTML_JS}`
                  : GRAB_HTML_JS
              }
              onMessage={onMessage}
              onLoadEnd={() => {
                if (request.injectedJavaScript) {
                  webViewRef.current?.injectJavaScript(
                    `${request.injectedJavaScript};\n true;`,
                  );
                }
                webViewRef.current?.injectJavaScript(GRAB_HTML_JS);
              }}
            />
            ) : null}
          </View>

          {/* Footer */}
          <View className="flex-row items-center gap-3 px-4 py-3">
            <TVTouchable
              onPress={() => webViewRef.current?.reload()}
              className="px-4 py-2 rounded-md bg-white/10">
              <AppText className="text-white text-sm">Reload</AppText>
            </TVTouchable>
            <TVTouchable
              hasTVPreferredFocus
              onPress={resolveWithPage}
              className="flex-1 px-4 py-2 rounded-md items-center"
              style={{backgroundColor: primary}}>
              <AppText
                style={{color: onPrimary}}
                className="text-sm font-semibold">
                Done
              </AppText>
            </TVTouchable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default WafWebViewDialog;

