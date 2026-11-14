import {NativeModules, Platform, ToastAndroid} from 'react-native';
import Constants from 'expo-constants';

export type AdKind = 'interstitial' | 'rewarded';

type LevelPlayNative = {
  initialize(appKey: string, debug: boolean): Promise<boolean>;
  load(kind: AdKind, adUnitId: string): Promise<boolean>;
  show(
    kind: AdKind,
    adUnitId: string,
  ): Promise<'completed' | 'skipped' | 'failed'>;
};

const native: LevelPlayNative | undefined = NativeModules.VegaUnityAds;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

// Unity LevelPlay (ironSource) dashboard values: the app key (Setup > Apps) and
// the ad unit IDs (Setup > Ad units). They are set in app.config.js.
const APP_KEY = String(extra.levelPlayAppKey || '').trim();
const AD_UNIT_IDS: Record<AdKind, string> = {
  interstitial: String(extra.levelPlayInterstitialAdUnitId || '').trim(),
  rewarded: String(extra.levelPlayRewardedAdUnitId || '').trim(),
};
// When on, a short on-screen message explains why an ad did not show.
const DEBUG = Boolean(extra.levelPlayDebug);

// Two ads of any kind are never closer together than this.
const MIN_GAP_ANY_MS = 10_000;
// Two interstitials (app open, pre-roll, mid-roll) are never closer than this.
const MIN_GAP_INTERSTITIAL_MS = 30_000;

// Each ad kind loads and becomes ready on its own.
const ready: Record<AdKind, boolean> = {interstitial: false, rewarded: false};
const loading: Record<AdKind, Promise<boolean> | null> = {
  interstitial: null,
  rewarded: null,
};
const failures: Record<AdKind, number> = {interstitial: 0, rewarded: 0};
const retryTimer: Record<AdKind, ReturnType<typeof setTimeout> | null> = {
  interstitial: null,
  rewarded: null,
};

let initPromise: Promise<boolean> | null = null;
let showing = false;
let lastAnyShownAt = 0;
let lastInterstitialShownAt = 0;
let debugToastsLeft = 6;

const debugToast = (message: string) => {
  if (!DEBUG || Platform.OS !== 'android' || debugToastsLeft <= 0) return;
  debugToastsLeft -= 1;
  ToastAndroid.show(message, ToastAndroid.LONG);
};

export const isAdsSupported = () =>
  Platform.OS === 'android' && !Platform.isTV && !!native && !!APP_KEY;

export const initUnityAds = (): Promise<boolean> => {
  if (!isAdsSupported()) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = native!
      .initialize(APP_KEY, DEBUG)
      .catch(() => false)
      .then(ok => {
        if (!ok) initPromise = null; // allow a retry later
        return ok;
      });
  }
  return initPromise;
};

// A failed load (no fill, no network) is retried with a growing delay, so one
// bad moment does not leave the app without ads for the whole session.
const scheduleRetry = (kind: AdKind) => {
  if (retryTimer[kind] || failures[kind] >= 20) return;
  const delay = Math.min(15_000 * 2 ** Math.min(failures[kind], 3), 120_000);
  failures[kind] += 1;
  retryTimer[kind] = setTimeout(() => {
    retryTimer[kind] = null;
    preloadAd(kind);
  }, delay);
};

/** Loads the next ad of this kind in the background so show() is instant. */
export const preloadAd = async (
  kind: AdKind = 'interstitial',
): Promise<boolean> => {
  if (!isAdsSupported() || !AD_UNIT_IDS[kind]) return false;
  if (ready[kind]) return true;
  const inFlight = loading[kind];
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      if (await initUnityAds()) {
        ready[kind] = await native!.load(kind, AD_UNIT_IDS[kind]);
      }
    } catch {
      ready[kind] = false;
    } finally {
      loading[kind] = null;
    }
    if (ready[kind]) {
      failures[kind] = 0;
    } else {
      scheduleRetry(kind);
    }
    return ready[kind];
  })();
  loading[kind] = promise;
  return promise;
};

const canShowNow = (kind: AdKind) => {
  const now = Date.now();
  if (!isAdsSupported() || showing) return false;
  if (now - lastAnyShownAt < MIN_GAP_ANY_MS) return false;
  if (
    kind === 'interstitial' &&
    now - lastInterstitialShownAt < MIN_GAP_INTERSTITIAL_MS
  ) {
    return false;
  }
  return true;
};

export const canShowAdNow = () => canShowNow('interstitial');

const wait = (ms: number) =>
  new Promise<false>(resolve => setTimeout(() => resolve(false), ms));

type ShowOptions = {
  /** How long to wait for an ad that is still loading before giving up. */
  waitMs?: number;
};

/**
 * Shows one ad of this kind if one is ready. Always resolves (never rejects).
 * Returns the completion state, or 'unavailable' when nothing was shown so
 * callers can simply continue.
 */
const showAd = async (
  kind: AdKind,
  {waitMs = 0}: ShowOptions = {},
): Promise<'completed' | 'skipped' | 'failed' | 'unavailable'> => {
  if (!isAdsSupported()) return 'unavailable';
  if (!canShowNow(kind)) {
    debugToast(`${kind} ad skipped: too soon after the previous ad`);
    return 'unavailable';
  }
  if (!ready[kind]) {
    const loadResult = preloadAd(kind);
    // Optionally give a still-loading ad a moment instead of skipping it.
    const loaded =
      waitMs > 0 ? await Promise.race([loadResult, wait(waitMs)]) : false;
    if (!loaded || !canShowNow(kind)) {
      debugToast(`${kind} ad not loaded yet`);
      return 'unavailable';
    }
  }
  showing = true;
  ready[kind] = false;
  try {
    const result = await native!.show(kind, AD_UNIT_IDS[kind]);
    if (result === 'failed') {
      debugToast(`${kind} ad could not be shown`);
    } else {
      lastAnyShownAt = Date.now();
      if (kind === 'interstitial') lastInterstitialShownAt = lastAnyShownAt;
    }
    return result;
  } catch {
    return 'failed';
  } finally {
    showing = false;
    preloadAd(kind);
  }
};

/** Shows one interstitial (app open, pre-roll, mid-roll) if one is ready. */
export const showInterstitial = async (
  options: ShowOptions = {},
): Promise<boolean> => {
  const result = await showAd('interstitial', options);
  return result === 'completed' || result === 'skipped';
};

/** Shows one rewarded ad (downloads) if one is ready. */
export const showRewarded = async (
  options: ShowOptions = {},
): Promise<boolean> => {
  const result = await showAd('rewarded', options);
  return result === 'completed' || result === 'skipped';
};

/**
 * Runs a download while a rewarded ad plays on top of it. The download is never
 * delayed or blocked by the ad, and an ad failure never fails the download.
 */
export const runWithDownloadAd = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  const running = task();
  // Swallow ad errors only; the task's own result/error is returned below.
  await showRewarded({waitMs: 5000}).catch(() => false);
  return running;
};

