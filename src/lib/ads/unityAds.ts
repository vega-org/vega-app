import {NativeModules, Platform} from 'react-native';
import Constants from 'expo-constants';

type UnityAdsNative = {
  initialize(gameId: string, testMode: boolean): Promise<boolean>;
  load(placementId: string): Promise<boolean>;
  show(placementId: string): Promise<'completed' | 'skipped' | 'failed'>;
};

const native: UnityAdsNative | undefined = NativeModules.VegaUnityAds;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

// Placement ID comes from the Unity dashboard (Monetization > Placements);
// "Interstitial_Android" is Unity's default interstitial placement name.
export const UNITY_PLACEMENT_ID = String(
  extra.unityAdsPlacementId || 'Interstitial_Android',
).trim();
const GAME_ID = String(extra.unityAdsGameId || '800358312').trim();
const TEST_MODE = __DEV__ || Boolean(extra.unityAdsTestMode);

// Never show two ads closer together than this, whatever the trigger.
const MIN_GAP_MS = 45_000;

let initPromise: Promise<boolean> | null = null;
let loadPromise: Promise<boolean> | null = null;
let adReady = false;
let showing = false;
let lastShownAt = 0;

export const isAdsSupported = () =>
  Platform.OS === 'android' && !Platform.isTV && !!native && !!GAME_ID;

export const initUnityAds = (): Promise<boolean> => {
  if (!isAdsSupported()) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = native!
      .initialize(GAME_ID, TEST_MODE)
      .catch(() => false)
      .then(ok => {
        if (!ok) initPromise = null; // allow a retry later
        return ok;
      });
  }
  return initPromise;
};

/** Loads the next ad in the background so show() is instant. */
export const preloadAd = async (): Promise<boolean> => {
  if (!isAdsSupported() || adReady) return adReady;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      if (!(await initUnityAds())) return false;
      adReady = await native!.load(UNITY_PLACEMENT_ID);
      return adReady;
    } catch {
      return false;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
};

export const canShowAdNow = () =>
  isAdsSupported() && !showing && Date.now() - lastShownAt >= MIN_GAP_MS;

/**
 * Shows one interstitial if one is ready. Always resolves (never rejects), and
 * resolves false when nothing was shown so callers can simply continue.
 */
export const showInterstitial = async (): Promise<boolean> => {
  if (!canShowAdNow()) return false;
  if (!adReady) {
    // Not loaded yet: start loading for next time instead of making the
    // viewer wait on a spinner.
    preloadAd();
    return false;
  }
  showing = true;
  adReady = false;
  try {
    const result = await native!.show(UNITY_PLACEMENT_ID);
    if (result !== 'failed') lastShownAt = Date.now();
    return result !== 'failed';
  } catch {
    return false;
  } finally {
    showing = false;
    preloadAd();
  }
};

/**
 * Runs a download while a Unity ad plays on top of it. The download is never
 * delayed or blocked by the ad, and an ad failure never fails the download.
 */
export const runWithDownloadAd = async <T>(task: () => Promise<T>): Promise<T> => {
  const running = task();
  // Swallow ad errors only; the task's own result/error is returned below.
  await showInterstitial().catch(() => false);
  return running;
};
