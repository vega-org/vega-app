import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Pressable, View} from 'react-native';
import AppText from '../ui/Text';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import type {RemoteSheetType} from './RemoteSettingsSheets';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface RemoteActionBarProps {
  hasEpisodes: boolean;
  onOpenSheet: (sheet: RemoteSheetType) => void;
}

const Action = ({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) => {
  const colors = useM3Colors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{color: colors.onSurfaceVariant, borderless: true, radius: 36}}
      style={{alignItems: 'center', flex: 1, gap: 4, paddingVertical: 8}}>
      <MaterialCommunityIcons name={icon} size={24} color={colors.onSurfaceVariant} />
      <AppText
        role="labelMedium"
        numberOfLines={1}
        style={{color: colors.onSurfaceVariant}}>
        {label}
      </AppText>
    </Pressable>
  );
};

/** One row of options, like a music player's bottom bar. Values live in the sheets. */
export const RemoteActionBar: React.FC<RemoteActionBarProps> = ({
  hasEpisodes,
  onOpenSheet,
}) => {
  const servers = useRemoteStore(state => state.servers);
  const qualities = useRemoteStore(state => state.qualities);
  const connectedDevice = useRemoteStore(state => state.connectedDevice);

  if (isTV) return null;

  return (
    <View style={{flexDirection: 'row', paddingHorizontal: 12}}>
      {servers.length > 1 && (
        <Action icon="server" label="Server" onPress={() => onOpenSheet('server')} />
      )}
      {qualities.length > 1 && (
        <Action
          icon="high-definition-box"
          label="Quality"
          onPress={() => onOpenSheet('quality')}
        />
      )}
      <Action icon="music-note-outline" label="Audio" onPress={() => onOpenSheet('audio')} />
      <Action
        icon="subtitles-outline"
        label="Subtitles"
        onPress={() => onOpenSheet('subtitles')}
      />
      {(connectedDevice?.type === 'cast' || connectedDevice?.type === 'vega-cast') && (
        <Action icon="speedometer" label="Speed" onPress={() => onOpenSheet('speed')} />
      )}
      {hasEpisodes && (
        <Action icon="playlist-play" label="Episodes" onPress={() => onOpenSheet('episodes')} />
      )}
    </View>
  );
};
