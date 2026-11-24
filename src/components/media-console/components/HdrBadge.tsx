import {topControlPillStyle} from '../../../lib/player/topControlPillStyle';
import React, {useEffect, useState} from 'react';
import HdrFormatIcon, {hdrIconWidth} from './HdrFormatIcon';
import {AppState, findNodeHandle, Modal, NativeModules, Platform, Text, View} from 'react-native';
import {TVFocusable, TVFocusGuide} from '../../tv';

type HdrStatus = {
  type: string; codec: string; resolution: string; transfer: string;
  colorSpace: string; headroom?: number; displayTypes: string;
  maxCllNits?: number;
};

export default function HdrBadge({videoView, source, suspended, scale, backgroundOpacity = 0, onInteract, onWidthChange}: {
  videoView: React.RefObject<View | null>; source: string; suspended: boolean;
  scale: number; onInteract: () => void; onWidthChange?: (width: number) => void;
  backgroundOpacity?: number;
}) {
  const [status, setStatus] = useState<HdrStatus | null>(null);
  const [details, setDetails] = useState<HdrStatus | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {setStatus(null);}, [source]);
  useEffect(() => {
    if (!active || suspended || Platform.OS !== 'android' || !NativeModules.AmbientVideo?.hdrStatus) return;
    let cancelled = false;
    let missingChecks = 0;
    const update = (next: HdrStatus | null) => {
      if (cancelled) return;
      if (next) {
        missingChecks = 0;
        setStatus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } else if (++missingChecks >= 2) {
        // A single sample can land during a seek, buffering or a surface transition.
        // Sustained loss still clears the badge rather than latching HDR indefinitely.
        setStatus(null);
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const tag = findNodeHandle(videoView.current);
        const next = tag ? await NativeModules.AmbientVideo.hdrStatus(tag) : null;
        update(next);
      } catch { update(null); }
      if (!cancelled) timer = setTimeout(check, 2500);
    };
    check();
    return () => {cancelled = true; clearTimeout(timer);};
  }, [active, suspended, source, videoView]);
  useEffect(() => {setDetails(null);}, [source]);
  // Dolby's symbol and lettering need comparable height, not the same width.
  const iconHeight = status ? status.type === 'Dolby Vision'
    ? 16 * scale : (32 * scale) / hdrIconWidth(status.type, 1) : 0;
  const buttonWidth = status ? Math.max(56 * scale, hdrIconWidth(status.type, iconHeight) + 32) : 0;
  const width = status ? buttonWidth + 20 * scale : 0;
  useEffect(() => {
    onWidthChange?.(width);
    return () => onWidthChange?.(0);
  }, [width, onWidthChange]);
  return <>
    {status && <View style={{justifyContent: 'center', marginRight: 20 * scale,
      backgroundColor: `rgba(0,0,0,${backgroundOpacity})`, borderRadius: 20 * scale}}>
      <TVFocusable registerScreenFocus={false} accessibilityRole="button" accessibilityLabel="HDR playback details"
        onPress={() => {onInteract(); setDetails(status);}}
        borderRadius={20 * scale} style={{...topControlPillStyle(scale), width: buttonWidth,
          alignItems: 'center', justifyContent: 'center', borderRadius: 20 * scale}}>
        <HdrFormatIcon type={status.type} height={status.type === 'Dolby Vision' ? 14 * scale : iconHeight} />
      </TVFocusable>
    </View>}
    {details && <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => {setDetails(null); onInteract();}}>
      <View style={{flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center', padding: 20}}>
        <TVFocusGuide trapFocusUp trapFocusDown trapFocusLeft trapFocusRight
          style={{width: '100%', maxWidth: 440, padding: 20, borderRadius: 20, backgroundColor: '#171717'}}>
          <Text style={{color: '#eee', fontSize: 19, fontWeight: '700', marginBottom: 12}}>HDR playback</Text>
          {[
            ['Format', details.type], ['Resolution', details.resolution], ['Codec', details.codec],
            ['Transfer', details.transfer], ['Color space', details.colorSpace],
            ['HDR/SDR brightness ratio', typeof details.headroom === 'number' ? `${details.headroom.toFixed(2)}×` : 'Not reported'], ['Display supports', details.displayTypes],
          ].map(([label, value]) => <Text key={label} style={{color: '#ccc', fontSize: 13, marginBottom: 8}}>{label}: {value}</Text>)}
          {typeof details.maxCllNits === 'number' && Number.isFinite(details.maxCllNits) && details.maxCllNits > 0 && details.maxCllNits <= 10000 && (
            <Text style={{color: '#ccc', fontSize: 13, marginBottom: 8}}>
              Video peak: {details.maxCllNits} nits (metadata, MaxCLL)
            </Text>
          )}
          <TVFocusable registerScreenFocus={false} hasTVPreferredFocus accessibilityLabel="Close HDR details"
            onPress={() => {setDetails(null); onInteract();}} style={{alignSelf: 'flex-end', padding: 12}}>
            <Text style={{color: '#eee'}}>Close</Text>
          </TVFocusable>
        </TVFocusGuide>
      </View>
    </Modal>}
  </>;
}
