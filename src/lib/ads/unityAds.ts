import {NativeModules, Platform} from 'react-native';
import Constants from 'expo-constants';

type UnityAdsNative = {
  initialize(gameId: string, testMode: boolean): Promise<boolean>;
  load(placementId: string): Promise<boolean>;
  show(placementId: string): Promise<'completed' | 'skipped' | 'failed'>;
};

const native: UnityAdsNative | undefined = NativeModules.VegaUnityAds;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

// Placement IDs come from the Unity dashboard (Monetization > Placements);
// these are Unity's default placement names.
export const UNITY_PLACEMENT_ID = String(
  extra.unityAdsPlacementId || 'Interstitial_Android',
).trim();
export const UNITY_REWARDED_PLACEMENT_ID = String(
  extra.unityAdsRewardedPlacementId || 'Rewarded_Android',
).trim();
const GAME_ID = String(extra.unityAdsGameId || '800358312').trim();
const TEST_MODE = __DEV__ || Boolean(extra.unityAdsTestMode);

// Never show two ads closer together than this, whatever the trigger.
const MIN_GAP_MS = 45_000;
export type AdKind = 'interstitial' | 'rewarded';

const PLACEMENT_IDS: Record<AdKind, string> = {
  interstitial: UNITY_PLACEMENT_ID,
  rewarded: UNITY_REWARDED_PLACEMENT_ID,
};

// Each placement loads and becomes ready on its own.
const ready: Record<AdKind, boolean> = {interstitial: false, rewarded: false};
const loading: Record<AdKind, Promise<boolean> | null> = {
  interstitial: null,
  rewarded: null,
};

let initPromise: Promise<boolean> | null = null;
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

/** Loads the next ad of this kind in the background so show() is instant. */
export const preloadAd = async (
  kind: AdKind = 'interstitial',
): Promise<boolean> => {
  if (!isAdsSupported() || ready[kind]) return ready[kind];
  const inFlight = loading[kind];
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      if (!(await initUnityAds())) return false;
      ready[kind] = await native!.load(PLACEMENT_IDS[kind]);
      return ready[kind];
    } catch {
      return false;
    } finally {
      loading[kind] = null;
    }
  })();
  loading[kind] = promise;
  return promise;
};

export const canShowAdNow = () =>
  isAdsSupported() && !showing && Date.now() - lastShownAt >= MIN_GAP_MS;

/**
 * Shows one ad of this kind if one is ready. Always resolves (never rejects).
 * Returns the completion state, or 'unavailable' when nothing was shown so
 * callers can simply continue.
 */
const showAd = async (
  kind: AdKind,
): Promise<'completed' | 'skipped' | 'failed' | 'unavailable'> => {
  if (!canShowAdNow()) return 'unavailable';
  if (!ready[kind]) {
    // Not loaded yet: start loading for next time instead of making the
    // viewer wait on a spinner.
    preloadAd(kind);
    return 'unavailable';
  }
  showing = true;
  ready[kind] = false;
  try {
    const result = await native!.show(PLACEMENT_IDS[kind]);
    if (result !== 'failed') lastShownAt = Date.now();
    return result;
  } catch {
    return 'failed';
  } finally {
    showing = false;
    preloadAd(kind);
  }
};

/** Shows one interstitial (pre-roll, mid-roll) if one is ready. */
export const showInterstitial = async (): Promise<boolean> => {
  const result = await showAd('interstitial');
  return result === 'completed' || result === 'skipped';
};

/** Shows one rewarded ad (downloads) if one is ready. */
export const showRewarded = async (): Promise<boolean> => {
  const result = await showAd('rewarded');
  return result === 'completed' || result === 'skipped';
};

/**
 * Runs a download while a Unity rewarded ad plays on top of it. The download is never
 * delayed or blocked by the ad, and an ad failure never fails the download.
 */
export const runWithDownloadAd = async <T>(task: () => Promise<T>): Promise<T> => {
  const running = task();
  // Swallow ad errors only; the task's own result/error is returned below.
  await showRewarded().catch(() => false);
  return running;
};
