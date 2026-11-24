import React, {memo, useEffect, useRef, useState} from 'react';
import {
  AppState,
  NativeModules,
  Platform,
  StyleSheet,
  View,
  findNodeHandle,
} from 'react-native';
import NativeAmbientGlow from './NativeAmbientGlow';
import {
  AmbientBars,
  AmbientColors,
  validAmbientColors,
  blendAmbientHistory,
  validAmbientBars,
  getAmbientSampleInterval,
} from '../../../lib/player/ambient';

const EMPTY: AmbientBars = {top: 0, bottom: 0, left: 0, right: 0};
const BLACK: AmbientColors = ['#000000', '#000000', '#000000', '#000000'];
type Props = {
  videoView: React.RefObject<View | null>;
  bars: AmbientBars;
  paused: boolean;
  intensity: number;
  spread: number;
  responseMs: number;
};

function AmbientBackground({videoView, bars, paused, intensity, spread, responseMs}: Props) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [palette, setPalette] = useState<AmbientColors>(BLACK);
  const [confirmed, setConfirmed] = useState<{
    geometry: AmbientBars;
    bounds: AmbientBars;
  } | null>(null);
  const confirmedBars = confirmed?.geometry === bars ? confirmed.bounds : EMPTY;
  const latest = useRef<AmbientColors>(BLACK);
  const previousSample = useRef<AmbientColors | null>(null);
  const response = useRef(responseMs);
  useEffect(() => { response.current = responseMs; }, [responseMs]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const native = NativeModules.AmbientVideo;
    if (
      !active ||
      paused ||
      intensity <= 0 ||
      Platform.OS !== 'android' ||
      !native
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let interval = getAmbientSampleInterval(response.current);
    previousSample.current = null;
    const sample = async () => {
      try {
        const tag = findNodeHandle(videoView.current);
        const started = Date.now();
        const result = tag ? await native.sample(tag) : null;
        if (cancelled) return;
        if (validAmbientBars(result?.bars)) {
          setConfirmed(previous =>
            previous?.geometry === bars &&
            Object.keys(previous.bounds).every(
              key =>
                previous.bounds[key as keyof AmbientBars] === result.bars[key],
            )
              ? previous
              : {geometry: bars, bounds: result.bars},
          );
          if (!Object.values(result.bars as AmbientBars).some(n => n > 0)) return;
        }
        if (
          validAmbientColors(result?.colors) &&
          validAmbientBars(result?.bars)
        ) {
          // Include asynchronous readback/bridge delay in the budget too.
          // Schedule after completion, so captures and transitions never queue up.
          interval = Math.max(getAmbientSampleInterval(response.current), Math.min(1500, (Date.now() - started) * 3));
          if (result.durationMs > 24) interval = 1500;
          if (result.durationMs > 80) return;
          const target = blendAmbientHistory(previousSample.current, result.colors);
          previousSample.current = result.colors;
          const next = target;
          if (next.some((color, i) => color !== latest.current[i])) {
            setPalette(next);
            latest.current = next;
          }
        }
      } catch {
        /* An unavailable texture must never affect playback. */
      }
      if (!cancelled) timer = setTimeout(sample, interval);
    };
    timer = setTimeout(sample, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, paused, intensity, bars, videoView]);
  if (!active) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}>
      <NativeAmbientGlow palette={palette} bars={confirmedBars}
        spread={spread} responseMs={responseMs} intensity={Math.max(0, Math.min(1, intensity))} style={StyleSheet.absoluteFill}
        pointerEvents="none" accessible={false} />
    </View>
  );
}

export default memo(AmbientBackground);
