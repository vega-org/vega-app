import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import {getInitialVideoIntent} from '../services/videoIntent';
import {isAdsSupported, preloadAd, showInterstitial} from './unityAds';

// Wait for the splash screen to go away before showing anything.
const COLD_START_DELAY_MS = 2500;
// How long to wait for the ad to load before giving up this time.
const LOAD_WAIT_MS = 8000;
// Show again on return to the app only after it was in the background this long...
const MIN_BACKGROUND_MS = 2 * 60_000;
// ...and never more often than this.
const MIN_GAP_BETWEEN_OPEN_ADS_MS = 5 * 60_000;

const waitForAd = (): Promise<boolean> => {
  const timeout = new Promise<boolean>(resolve =>
    setTimeout(() => resolve(false), LOAD_WAIT_MS),
  );
  return Promise.race([preloadAd('interstitial'), timeout]);
};

/**
 * App-open interstitial: one ad on launch, and again when the viewer comes
 * back after the app sat in the background for a while. Never plays when the
 * app was opened straight into a video.
 */
export function useAppOpenAd() {
  const lastShownAtRef = useRef(0);
  const backgroundedAtRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isAdsSupported()) return;

    const run = async () => {
      if (busyRef.current) return;
      if (Date.now() - lastShownAtRef.current < MIN_GAP_BETWEEN_OPEN_ADS_MS) {
        return;
      }
      busyRef.current = true;
      try {
        if (!(await waitForAd())) return;
        if (AppState.currentState !== 'active') return;
        if (await showInterstitial()) lastShownAtRef.current = Date.now();
      } catch {
        // An ad problem must never affect the app.
      } finally {
        busyRef.current = false;
      }
    };

    preloadAd('interstitial');

    // Cold start: skip it when the app was opened straight into a video.
    let cancelled = false;
    const startTimer = setTimeout(async () => {
      const initialVideo = await getInitialVideoIntent().catch(() => null);
      if (!cancelled && !initialVideo) run();
    }, COLD_START_DELAY_MS);

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        const away = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (away !== null && Date.now() - away >= MIN_BACKGROUND_MS) run();
      } else if (backgroundedAtRef.current === null) {
        backgroundedAtRef.current = Date.now();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      subscription.remove();
    };
  }, []);
}
