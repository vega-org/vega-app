const mockNativeClearAll = jest.fn(() => Promise.resolve(true));
const mockClearAllCookies = jest.fn(() => Promise.resolve());
const mockClearProviderCookies = jest.fn();

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {
    WebViewDataModule: {
      clearAll: () => mockNativeClearAll(),
    },
  },
}));

jest.mock('../src/lib/services/cookieManager', () => ({
  clearAllCookies: () => mockClearAllCookies(),
}));

jest.mock('../src/lib/storage/StorageService', () => ({
  providerCookieStorage: {
    clearAll: () => mockClearProviderCookies(),
  },
}));

import {clearWebViewData} from '../src/lib/clearWebViewData';

describe('clearWebViewData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears native WebView data, cookies, and provider cookie storage', async () => {
    await clearWebViewData();

    expect(mockNativeClearAll).toHaveBeenCalledTimes(1);
    expect(mockClearAllCookies).toHaveBeenCalledTimes(1);
    expect(mockClearProviderCookies).toHaveBeenCalledTimes(1);
  });

  it('still clears provider cookies when cookieManager rejects', async () => {
    mockClearAllCookies.mockRejectedValueOnce(new Error('unavailable'));

    await clearWebViewData();

    expect(mockNativeClearAll).toHaveBeenCalledTimes(1);
    expect(mockClearProviderCookies).toHaveBeenCalledTimes(1);
  });
});
