import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useCallback, useRef, useState} from 'react';
import {BackHandler, View, findNodeHandle} from 'react-native';
import type {SettingsStackParamList} from '../../App';
import PlayerControlArrangement from '../../components/PlayerControlArrangement';
import AppText from '../../components/ui/Text';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import type {PlayerControl} from '../../components/PlayerControlBar';
import {PLAYER_CONTROL_IDS} from '../../lib/player/controlLayout';
import {settingsStorage} from '../../lib/storage';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';

const descriptors: Record<typeof PLAYER_CONTROL_IDS[number], [string, string]> = {
  sleep: ['Sleep timer', 'power-sleep'],
  lock: ['Lock', 'lock-outline'],
  cast: ['Cast', 'cast'],
  audio: ['Audio', 'waveform'],
  subtitle: ['Subtitles', 'subtitles-outline'],
  speed: ['Speed', 'speedometer'],
  pip: ['Picture in picture', 'picture-in-picture-bottom-right'],
  server: ['Server', 'server'],
  resize: ['Resize', 'aspect-ratio'],
  rotate: ['Rotate screen', 'screen-rotation'],
  episodes: ['Episodes', 'playlist-play'],
  next: ['Next episode', 'skip-next'],
  settings: ['Settings', 'cog-outline'],
  decoder: ['Video decoder', 'memory'],
};
const controls: PlayerControl[] = PLAYER_CONTROL_IDS.map(id => ({
  id,
  title: descriptors[id][0],
  label: descriptors[id][0],
  icon: descriptors[id][1],
  visible: true,
  onPress: () => {},
}));

type Props = NativeStackScreenProps<SettingsStackParamList, 'PlayerControlSettings'>;
export default function PlayerControlSettings({navigation}: Props) {
  const colors = useM3Colors();
  const backRef = useRef<View>(null);
  const [backHandle, setBackHandle] = useState<number>();
  const [entryHandle, setEntryHandle] = useState<number>();
  const [layout, setLayout] = useState(() => settingsStorage.getPlayerControlLayout());
  const [hidden, setHidden] = useState(() => settingsStorage.getHiddenPlayerControls());
  useFocusEffect(useCallback(() => {
    if (!isTV) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {navigation.goBack(); return true;});
    return () => sub.remove();
  }, [navigation]));
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <TVFocusGuide autoFocus style={{flex: 1, backgroundColor: colors.background, padding: 20}}>
        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
          <TVFocusable ref={backRef} onLayout={() => { const handle = findNodeHandle(backRef.current); if (handle) setBackHandle(handle); }}
            nextFocusDown={entryHandle} hasTVPreferredFocus={isTV} accessibilityLabel="Go back"
            accessibilityRole="button" onPress={() => navigation.goBack()} borderRadius={22}
            style={{alignItems: 'center', height: 44, justifyContent: 'center', marginRight: 10, width: 44}}>
            <MaterialCommunityIcons name="arrow-left" size={28} color={colors.onBackground} />
          </TVFocusable>
          <AppText role="headlineLargeEmphasized" className="text-m3-on-background" style={{flex: 1}}>
            Control layout
          </AppText>
        </View>
        <AppText role="bodyLarge" className="mb-7 mt-1 text-m3-on-surface-variant">
          Changes save automatically
        </AppText>
        <View style={{flex: 1, paddingTop: 12}}>
          <PlayerControlArrangement page exitUpHandle={backHandle} onEntryHandle={setEntryHandle} layout={layout} hiddenControls={hidden} controls={controls}
            color={colors.primary} onChange={(next, nextHidden) => {
              settingsStorage.setPlayerControlLayout(next);
              settingsStorage.setHiddenPlayerControls(nextHidden);
              setLayout(next); setHidden(nextHidden);
            }} />
        </View>
      </TVFocusGuide>
    </GestureHandlerRootView>
  );
}
