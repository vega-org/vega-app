import React, {useCallback, useRef, useState} from 'react';
import {LayoutChangeEvent, Pressable, View} from 'react-native';
import AppText from '../ui/Text';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {settingsStorage} from '../../lib/storage';
import {isTV} from '../../lib/tv';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSecs = Math.floor(seconds);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const RemoteScrubber: React.FC = () => {
  const colors = useM3Colors();
  const currentTime = useRemoteStore(state => state.currentTime);
  const duration = useRemoteStore(state => state.duration);
  const connectedDevice = useRemoteStore(state => state.connectedDevice);
  const [barWidth, setBarWidth] = useState(0);
  const [showTimeRemaining, setShowTimeRemaining] = useState(() =>
    settingsStorage.isShowTimeRemaining(),
  );
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const gestureOrigin = useRef(0);
  const canSeek = !!connectedDevice && duration > 0 && barWidth > 0;
  const displayedTime = previewTime ?? currentTime;

  const progress = duration > 0 ? Math.max(0, Math.min(displayedTime / duration, 1)) : 0;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  }, []);

  const positionAt = useCallback(
    (x: number) => {
      if (!barWidth || !duration) return 0;
      const pct = Math.max(0, Math.min(x / barWidth, 1));
      return pct * duration;
    },
    [barWidth, duration],
  );

  if (isTV) return null;

  return (
    <View style={{paddingHorizontal: 24}}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{min: 0, max: duration, now: displayedTime}}
        accessibilityState={{disabled: !canSeek}}
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        onAccessibilityAction={event => {
          if (!canSeek) return;
          const direction = event.nativeEvent.actionName;
          if (direction !== 'increment' && direction !== 'decrement') return;
          const target = Math.max(0, Math.min(currentTime + (direction === 'increment' ? 10 : -10), duration));
          remotePlaybackManager.seek(target).catch(() => {});
        }}
        onLayout={handleLayout}
        onStartShouldSetResponder={() => canSeek}
        onResponderGrant={event => {
          gestureOrigin.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
          setPreviewTime(positionAt(event.nativeEvent.locationX));
        }}
        onResponderMove={event => {
          setPreviewTime(positionAt(event.nativeEvent.pageX - gestureOrigin.current));
        }}
        onResponderRelease={event => {
          if (canSeek) {
            const target = positionAt(event.nativeEvent.pageX - gestureOrigin.current);
            remotePlaybackManager.seek(target).catch(() => {});
          }
          setPreviewTime(null);
        }}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => setPreviewTime(null)}
        style={{height: 44, justifyContent: 'center'}}>
        <View
          pointerEvents="none"
          style={{
            backgroundColor: colors.surfaceContainerHighest,
            borderRadius: 2,
            height: 4,
            overflow: 'hidden',
          }}>
          <View
            style={{
              backgroundColor: colors.primary,
              height: '100%',
              width: `${progress * 100}%`,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            backgroundColor: colors.primary,
            borderRadius: 8,
            height: 16,
            left: Math.max(0, Math.min(progress * barWidth - 8, barWidth - 16)),
            position: 'absolute',
            width: 16,
          }}
        />
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            showTimeRemaining ? 'Show total duration' : 'Show remaining time'
          }
          onPress={() => {
            setShowTimeRemaining(prev => {
              const next = !prev;
              settingsStorage.setShowTimeRemaining(next);
              return next;
            });
          }}>
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>
            {formatTime(displayedTime)}
          </AppText>
        </Pressable>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            showTimeRemaining ? 'Show total duration' : 'Show remaining time'
          }
          onPress={() => {
            setShowTimeRemaining(prev => {
              const next = !prev;
              settingsStorage.setShowTimeRemaining(next);
              return next;
            });
          }}>
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>
            {showTimeRemaining && duration > 0
              ? `-${formatTime(Math.max(0, duration - displayedTime))}`
              : formatTime(duration)}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
};
