import {useCallback, useEffect, useRef} from 'react';
import {preloadAd, showInterstitial, isAdsSupported} from './unityAds';

// Watched time (not seek position) before the first mid-roll, then between ads.
const FIRST_AD_AFTER_S = 3 * 60;
const AD_EVERY_S = 10 * 60;
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
 * Video interstitials: a pre-roll as soon as playback starts, then mid-rolls
 * after enough real playback time. Each one pauses the video, shows a Unity
 * ad, then resumes. Feed it every progress tick.
 */
export function useMidrollAds({pause, resume, enabled}: Options) {
  const watchedRef = useRef(0);
  const nextAtRef = useRef(FIRST_AD_AFTER_S);
  const lastTimeRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const prerollDoneRef = useRef(false);
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

      // Pre-roll: the first progress tick of this player screen.
      if (!prerollDoneRef.current) {
        prerollDoneRef.current = true;
        lastTimeRef.current = currentTime;
        busyRef.current = true;
        pauseRef.current();
        // Give a still-loading ad a moment, so the pre-roll is not lost.
        showInterstitial({waitMs: 2000})
          .catch(() => false)
          .then(shown => {
            // No pre-roll (ad not ready or too soon after another ad): bring
            // the first mid-roll forward instead of skipping ads altogether.
            if (!shown) nextAtRef.current = Math.min(nextAtRef.current, 60);
          })
          .finally(() => {
            resumeRef.current();
            busyRef.current = false;
            lastTimeRef.current = null;
          });
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
