import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, View} from 'react-native';
import {WebView} from 'react-native-webview';
import type {WebViewMessageEvent} from 'react-native-webview';
import {SANDBOX_RUNTIME} from '../lib/sandbox/generated/sandboxRuntime.generated';
import {sandboxBridge} from '../lib/sandbox/sandboxBridge';
import {buildSandboxHtml, SANDBOX_ORIGIN} from '../lib/sandbox/sandboxHtml';

const SANDBOX_SOURCE = {
  html: buildSandboxHtml(SANDBOX_RUNTIME),
  baseUrl: SANDBOX_ORIGIN,
};

const ProviderSandboxHost = () => {
  const webViewRef = useRef<WebView>(null);
  const hostIdRef = useRef<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const remountWebView = useCallback(() => {
    setReloadKey(current => current + 1);
  }, []);

  const handleProcessTerminated = useCallback(() => {
    if (hostIdRef.current !== null) {
      sandboxBridge.handleReload(hostIdRef.current);
    }
    setReloadKey(current => current + 1);
  }, []);

  useEffect(() => {
    const hostId = sandboxBridge.register(
      inject,
      remountWebView,
      'foreground',
    );
    hostIdRef.current = hostId;
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active' && hostIdRef.current !== null) {
        sandboxBridge.ensureReady(hostIdRef.current);
      }
    });
    return () => {
      appStateSub.remove();
      hostIdRef.current = null;
      sandboxBridge.unregister(hostId);
    };
  }, [inject, remountWebView]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    sandboxBridge.handleSandboxMessage(
      event.nativeEvent.data,
      hostIdRef.current ?? undefined,
    );
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{width: 0, height: 0, opacity: 0, position: 'absolute'}}>
      <WebView
        key={reloadKey}
        ref={webViewRef}
        source={SANDBOX_SOURCE}
        originWhitelist={['https://provider-sandbox.invalid']}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        allowsFullscreenVideo={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mediaPlaybackRequiresUserAction={true}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        cacheEnabled={false}
        incognito={true}
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={request =>
          request.url === SANDBOX_ORIGIN || request.url === 'about:blank'
        }
        onRenderProcessGone={handleProcessTerminated}
        onContentProcessDidTerminate={handleProcessTerminated}
        style={{width: 0, height: 0}}
      />
    </View>
  );
};

export default ProviderSandboxHost;
