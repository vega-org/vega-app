import {NativeModules, Platform} from 'react-native';
import {clearAllCookies} from './services/cookieManager';
import {providerCookieStorage} from './storage/StorageService';

export const clearWebViewData = async (): Promise<void> => {
  const nativeModule = NativeModules?.WebViewDataModule;
  if (Platform?.OS === 'android' && typeof nativeModule?.clearAll === 'function') {
    await nativeModule.clearAll();
  }
  await clearAllCookies().catch(() => undefined);
  providerCookieStorage.clearAll();
};
