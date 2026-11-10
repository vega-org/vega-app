import {useCallback, useEffect, useRef} from 'react';
import {preloadAd, showInterstitial, isAdsSupported} from './unityAds';

// Watched time (not seek position) before the first ad, then between ads.
const FIRST_AD_AFTER_S = 5 * 60;
const AD_EVERY_S = 12 * 60;
// Don't interrupt the last minute of a video.
const SKIP_IF_REMAINING_S = 60;
// A progress tick further apart than this is a seek, not watched time.
const MAX_TICK_DELTA_S = 3;

type Options = {
  pause: () => void;
  resume: () => void;
  enabled: boolean;
};

/**
 * Mid-roll interstitials: after enough real playback time, pause the video,
 * show a Unity ad, then resume. Feed it every progress tick.
 */
export function useMidrollAds({pause, resume, enabled}: Options) {
  const watchedRef = useRef(0);
  const nextAtRef = useRef(FIRST_AD_AFTER_S);
  const lastTimeRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);
  pauseRef.current = pause;
  resumeRef.current = resume;

  useEffect(() => {
    if (enabled && isAdsSupported()) preloadAd();
  }, [enabled]);

  const onProgress = useCallback(
    (currentTime: number, duration: number) => {
      if (!enabled || busyRef.current) {
        lastTimeRef.current = currentTime;
        return;
      }
      const last = lastTimeRef.current;
      lastTimeRef.current = currentTime;
      if (last !== null) {
        const delta = currentTime - last;
        if (delta > 0 && delta <= MAX_TICK_DELTA_S) watchedRef.current += delta;
      }
      if (watchedRef.current < nextAtRef.current) return;
      if (duration > 0 && duration - currentTime < SKIP_IF_REMAINING_S) return;

      busyRef.current = true;
      pauseRef.current();
      showInterstitial()
        .then(shown => {
          // Only reschedule after an ad really ran; otherwise try again soon.
          nextAtRef.current = shown
            ? watchedRef.current + AD_EVERY_S
            : watchedRef.current + 30;
        })
        .catch(() => {
          nextAtRef.current = watchedRef.current + 30;
        })
        .finally(() => {
          resumeRef.current();
          busyRef.current = false;
          lastTimeRef.current = null;
        });
    },
    [enabled],
  );

  return {onProgress};
}
