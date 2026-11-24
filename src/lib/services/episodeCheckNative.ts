import {NativeModules, Platform} from 'react-native';

export const BACKGROUND_SANDBOX_MESSAGE_EVENT = 'VegaBackgroundSandboxMessage';
export const BACKGROUND_SANDBOX_RELOAD_EVENT = 'VegaBackgroundSandboxReload';

interface EpisodeCheckNativeModule {
  schedule(intervalHours: number, wifiOnly: boolean): Promise<boolean>;
  scheduleAt(nextAt: number, wifiOnly: boolean): Promise<boolean>;
  cancel(): Promise<boolean>;
  startBackgroundSandbox(html: string, baseUrl: string): Promise<boolean>;
  injectBackgroundSandbox(script: string): void;
  stopBackgroundSandbox(): Promise<boolean>;
}

const nativeModule: EpisodeCheckNativeModule | undefined =
  Platform.OS === 'android'
    ? (NativeModules.EpisodeCheck as EpisodeCheckNativeModule | undefined)
    : undefined;

export const episodeCheckNative = {
  isAvailable(): boolean {
    return Boolean(nativeModule);
  },

  supportsCustomSchedule(): boolean {
    return typeof nativeModule?.scheduleAt === 'function';
  },

  async schedule(intervalHours: number, wifiOnly: boolean): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.schedule(intervalHours, wifiOnly);
  },

  async scheduleAt(nextAt: number, wifiOnly: boolean): Promise<boolean> {
    if (!nativeModule?.scheduleAt) return false;
    return nativeModule.scheduleAt(nextAt, wifiOnly);
  },

  async cancel(): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.cancel();
  },

  async startBackgroundSandbox(html: string, baseUrl: string): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.startBackgroundSandbox(html, baseUrl);
  },

  injectBackgroundSandbox(script: string): void {
    nativeModule?.injectBackgroundSandbox(script);
  },

  async stopBackgroundSandbox(): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.stopBackgroundSandbox();
  },
};
