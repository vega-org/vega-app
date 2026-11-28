import {NativeModules, Platform} from 'react-native';

export const BACKGROUND_SANDBOX_MESSAGE_EVENT = 'VegaBackgroundSandboxMessage';
export const BACKGROUND_SANDBOX_RELOAD_EVENT = 'VegaBackgroundSandboxReload';

interface EpisodeCheckNativeModule {
  schedule(intervalHours: number, wifiOnly: boolean): Promise<boolean>;
  scheduleAt(nextAt: number, wifiOnly: boolean): Promise<boolean>;
  cancel(): Promise<boolean>;
  isIgnoringBatteryOptimizations?(): Promise<boolean>;
  requestIgnoreBatteryOptimizations?(): Promise<boolean>;
  startBackgroundSandbox(html: string, baseUrl: string): Promise<boolean>;
  injectBackgroundSandbox(script: string): void;
  stopBackgroundSandbox(): Promise<boolean>;
}

const getNativeModule = (): EpisodeCheckNativeModule | undefined =>
  Platform.OS === 'android'
    ? (NativeModules.EpisodeCheck as EpisodeCheckNativeModule | undefined)
    : undefined;

export const episodeCheckNative = {
  isAvailable(): boolean {
    return Boolean(getNativeModule());
  },

  supportsCustomSchedule(): boolean {
    return typeof getNativeModule()?.scheduleAt === 'function';
  },

  supportsBatteryOptimization(): boolean {
    const mod = getNativeModule();
    return (
      typeof mod?.isIgnoringBatteryOptimizations === 'function' &&
      typeof mod?.requestIgnoreBatteryOptimizations === 'function'
    );
  },

  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    const mod = getNativeModule();
    if (typeof mod?.isIgnoringBatteryOptimizations !== 'function') {
      return false;
    }
    return mod.isIgnoringBatteryOptimizations();
  },

  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    const mod = getNativeModule();
    if (typeof mod?.requestIgnoreBatteryOptimizations !== 'function') {
      return false;
    }
    return mod.requestIgnoreBatteryOptimizations();
  },

  async schedule(intervalHours: number, wifiOnly: boolean): Promise<boolean> {
    const mod = getNativeModule();
    if (!mod) return false;
    return mod.schedule(intervalHours, wifiOnly);
  },

  async scheduleAt(nextAt: number, wifiOnly: boolean): Promise<boolean> {
    const mod = getNativeModule();
    if (!mod?.scheduleAt) return false;
    return mod.scheduleAt(nextAt, wifiOnly);
  },

  async cancel(): Promise<boolean> {
    const mod = getNativeModule();
    if (!mod) return false;
    return mod.cancel();
  },

  async startBackgroundSandbox(html: string, baseUrl: string): Promise<boolean> {
    const mod = getNativeModule();
    if (!mod) return false;
    return mod.startBackgroundSandbox(html, baseUrl);
  },

  injectBackgroundSandbox(script: string): void {
    getNativeModule()?.injectBackgroundSandbox(script);
  },

  async stopBackgroundSandbox(): Promise<boolean> {
    const mod = getNativeModule();
    if (!mod) return false;
    return mod.stopBackgroundSandbox();
  },
};
