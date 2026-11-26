import {Host, Slider} from '@expo/ui/jetpack-compose';
import {fillMaxWidth} from '@expo/ui/jetpack-compose/modifiers';
import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import IconButton from '../ui/IconButton';
import AppText from '../ui/Text';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {useM3Colors, useM3HostTheme} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';

const STEP = 0.05;

/** Receiver volume. Hidden until the receiver reports its level. */
export const RemoteVolumeRow: React.FC<{header?: React.ReactNode; active?: boolean}> = ({
  header,
  active: isActive = true,
}) => {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const connectedDevice = useRemoteStore(state => state.connectedDevice);
  const volume = useRemoteStore(state => state.volume);
  const isMuted = useRemoteStore(state => state.isMuted);
  const [available, setAvailable] = useState(false);
  // Shown while dragging; the receiver gets the value when the drag ends.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive || !connectedDevice) {
      setAvailable(false);
      return;
    }
    let active = true;
    const refresh = () =>
      remotePlaybackManager.refreshVolume().then(ok => {
        if (active) setAvailable(ok);
      });
    refresh();
    // The TV remote can change the level too.
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connectedDevice, isActive]);

  if (isTV || !available) return null;

  const shown = dragValue ?? (isMuted ? 0 : volume);
  const apply = (next: number) => {
    remotePlaybackManager
      .setVolume(Math.round(next / STEP) * STEP)
      .catch(() => {});
  };

  return (
    <>
      {header}
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          gap: 4,
          paddingHorizontal: 16,
        }}>
        <IconButton
          icon={shown <= 0 ? 'volume-off' : 'volume-minus'}
          label="Volume down"
          size={22}
          buttonSize={44}
          contentColor={colors.onSurfaceVariant}
          disabled={shown <= 0}
          onPress={() => apply(Math.max(0, shown - STEP))}
        />
        <View style={{flex: 1}}>
          <Host
            matchContents={{vertical: true}}
            style={{width: '100%'}}
            {...hostTheme}>
            <Slider
              value={shown}
              min={0}
              max={1}
              colors={{
                thumbColor: colors.primary,
                activeTrackColor: colors.primary,
                inactiveTrackColor: colors.surfaceContainerHighest,
              }}
              onValueChange={next => {
                dragRef.current = next;
                setDragValue(next);
              }}
              onValueChangeFinished={() => {
                if (dragRef.current !== null) apply(dragRef.current);
                dragRef.current = null;
                setDragValue(null);
              }}
              modifiers={[fillMaxWidth()]}
            />
          </Host>
        </View>
        <IconButton
          icon="volume-plus"
          label="Volume up"
          size={22}
          buttonSize={44}
          contentColor={colors.onSurfaceVariant}
          disabled={shown >= 1}
          onPress={() => apply(Math.min(1, shown + STEP))}
        />
        <AppText
          role="labelMedium"
          style={{
            color: colors.onSurfaceVariant,
            textAlign: 'right',
            width: 40,
          }}>
          {Math.round(shown * 100)}%
        </AppText>
      </View>
    </>
  );
};
