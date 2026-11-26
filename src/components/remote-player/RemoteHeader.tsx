import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Host, Switch} from '@expo/ui/jetpack-compose';
import {Clipboard, Pressable, ToastAndroid, View} from 'react-native';
import IconButton from '../ui/IconButton';
import AppText from '../ui/Text';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {useM3Colors, useM3HostTheme} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {RemoteSheet, RemoteSheetSectionLabel} from './RemoteSheet';
import {RemoteVolumeRow} from './RemoteVolumeRow';

interface RemoteHeaderProps {
  onBack: () => void;
  onOpenDevicePicker: () => void;
}

export const RemoteHeader: React.FC<RemoteHeaderProps> = ({
  onBack,
  onOpenDevicePicker,
}) => {
  const colors = useM3Colors();
  const connectedDevice = useRemoteStore(state => state.connectedDevice);
  const [menuVisible, setMenuVisible] = useState(false);
  const [castHls, setCastHls] = useState(() =>
    remotePlaybackManager.isCastHlsEnabled(),
  );

  const [volumeKeys, setVolumeKeys] = useState(() =>
    remotePlaybackManager.isVolumeKeysEnabled(),
  );

  if (isTV) return null;

  const copy = (value: string | undefined, label: string) => {
    if (!value) {
      ToastAndroid.show(`No ${label} to copy`, ToastAndroid.SHORT);
      return;
    }
    Clipboard.setString(value);
    ToastAndroid.show(`${label[0].toUpperCase()}${label.slice(1)} copied`, ToastAndroid.SHORT);
    setMenuVisible(false);
  };

  const toggleVolumeKeys = (enabled: boolean) => {
    remotePlaybackManager.setVolumeKeysEnabled(enabled);
    setVolumeKeys(enabled);
  };

  const toggleCastHls = (enabled: boolean) => {
    remotePlaybackManager.setCastHlsEnabled(enabled);
    setCastHls(enabled);
  };

  return (
    <View
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        gap: 4,
        paddingLeft: 4,
        paddingRight: 16,
        paddingTop: 4,
      }}>
      <IconButton
        icon="arrow-left"
        label="Stop casting and go back"
        contentColor={colors.onSurface}
        onPress={onBack}
      />
      <View style={{flex: 1}} />
      <Pressable
        accessibilityLabel="Playback device"
        accessibilityRole="button"
        onPress={onOpenDevicePicker}
        android_ripple={{color: colors.onSurfaceVariant}}
        style={{
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: 20,
          flexDirection: 'row',
          gap: 8,
          height: 40,
          maxWidth: '70%',
          overflow: 'hidden',
          paddingLeft: 12,
          paddingRight: 8,
        }}>
        <MaterialCommunityIcons
          name={
            !connectedDevice
              ? 'cast'
              : connectedDevice.type === 'cast'
                ? 'cast-connected'
                : 'television'
          }
          size={18}
          color={colors.primary}
        />
        <AppText
          role="labelLarge"
          numberOfLines={1}
          style={{color: colors.onSurface, flexShrink: 1}}>
          {connectedDevice?.name || 'Choose a device'}
        </AppText>
        <MaterialCommunityIcons
          name="chevron-down"
          size={20}
          color={colors.onSurfaceVariant}
        />
      </Pressable>
      <IconButton
        icon="dots-vertical"
        label="More options"
        contentColor={colors.onSurface}
        onPress={() => setMenuVisible(true)}
      />
      <RemoteSheet
        visible={menuVisible}
        title="Options"
        enableContentPanningGesture={false}
        onClose={() => setMenuVisible(false)}>
        <RemoteVolumeRow
          active={menuVisible}
          header={<RemoteSheetSectionLabel text="Volume" />}
        />
        <MenuRow
          icon="playlist-play"
          title="HLS for Google Cast"
          detail="Lets the Chromecast seek by itself. Applies to the next video or audio change."
          onPress={() => toggleCastHls(!castHls)}
          right={<M3Switch value={castHls} onChange={toggleCastHls} />}
        />
        <MenuRow
          icon="volume-vibrate"
          title="Volume keys control the TV"
          detail="Phone volume buttons change the receiver volume while Vega is open."
          onPress={() => toggleVolumeKeys(!volumeKeys)}
          right={<M3Switch value={volumeKeys} onChange={toggleVolumeKeys} />}
        />
        <MenuRow
          icon="link-variant"
          title="Copy stream link"
          onPress={() => copy(remotePlaybackManager.getActiveStreamUrl(), 'stream link')}
        />
        <MenuRow
          icon="subtitles-outline"
          title="Copy subtitle link"
          onPress={() => copy(remotePlaybackManager.getActiveSubtitleUrl(), 'subtitle link')}
        />
      </RemoteSheet>
    </View>
  );
};

const M3Switch: React.FC<{value: boolean; onChange: (value: boolean) => void}> = ({
  value,
  onChange,
}) => {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  return (
    <Host matchContents {...hostTheme}>
      <Switch
        value={value}
        onCheckedChange={onChange}
        colors={{
          checkedThumbColor: colors.onPrimary,
          checkedTrackColor: colors.primary,
          uncheckedThumbColor: colors.outline,
          uncheckedTrackColor: colors.surfaceContainerHighest,
          uncheckedBorderColor: colors.outline,
        }}
      />
    </Host>
  );
};

const MenuRow: React.FC<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  detail?: string;
  onPress: () => void;
  right?: React.ReactNode;
}> = ({icon, title, detail, onPress, right}) => {
  const colors = useM3Colors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{color: colors.onSurfaceVariant}}
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        gap: 16,
        minHeight: 56,
        paddingHorizontal: 24,
        paddingVertical: 8,
      }}>
      <MaterialCommunityIcons name={icon} size={24} color={colors.onSurfaceVariant} />
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>
          {title}
        </AppText>
        {detail ? (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
};
