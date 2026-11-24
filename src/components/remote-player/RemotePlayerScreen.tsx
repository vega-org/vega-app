import type {SavedSubtitle, SubtitleInput} from '../../lib/subtitles/savedSubtitles';
import React, {useCallback, useState} from 'react';
import {Image, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {OrientationLocker, PORTRAIT} from 'react-native-orientation-locker';
import {SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {RemoteHeader} from './RemoteHeader';
import {RemoteMediaCard} from './RemoteMediaCard';
import {RemoteStatusLine} from './RemoteStatusLine';
import {RemoteScrubber} from './RemoteScrubber';
import {RemoteControls} from './RemoteControls';
import {RemoteActionBar} from './RemoteActionBar';
import {RemoteSettingsSheets, RemoteSheetType} from './RemoteSettingsSheets';
import {DevicePickerModal} from './DevicePickerModal';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {
  RemoteAudioTrack,
  RemoteQuality,
  RemoteServer,
  RemoteSubtitleTrack,
} from '../../lib/remote/types';
import {EpisodeLink} from '../../lib/providers/types';
import {useDetailPalette} from '../../lib/hooks/useDetailPalette';
import {M3PaletteContext} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';

interface RemotePlayerScreenProps {
  savedSubtitles?: SavedSubtitle[];
  onAddSavedSubtitle?: (track: SubtitleInput, origin: SavedSubtitle['origin']) => Promise<SavedSubtitle | undefined>;
  onRemoveSavedSubtitle?: (id: string) => Promise<void>;
  title?: string;
  subtitle?: string;
  /** Portrait artwork shown in the card. */
  poster?: string;
  /** Wide artwork behind the header; also the accent source, as on Info. */
  backdrop?: string;
  /** Leaves the screen; the Player ends casting when the screen is removed. */
  onBack: () => void;
  episodes?: EpisodeLink[];
  activeEpisodeIndex?: number;
  onSelectEpisode?: (index: number) => void;
  skipIntervals?: {from: number; to: number; title?: string}[];
  onSkipPress?: (seconds: number) => void;
  /** Shown with a spinner while servers load or the stream resolves. */
  preparingText?: string | null;
  /** Small line under the status, such as torrent download progress. */
  detailText?: string | null;
  onSelectServer?: (server: RemoteServer) => void;
  onSelectAudio?: (track: RemoteAudioTrack) => void;
  onSelectSubtitle?: (track?: RemoteSubtitleTrack) => void;
  onSelectQuality?: (q: RemoteQuality) => void;
}

const BACKDROP_HEIGHT = 360;

export const RemotePlayerScreen: React.FC<RemotePlayerScreenProps> = ({
  savedSubtitles,
  onAddSavedSubtitle,
  onRemoveSavedSubtitle,
  title,
  subtitle,
  poster,
  backdrop,
  onBack,
  episodes,
  activeEpisodeIndex,
  onSelectEpisode,
  skipIntervals,
  onSkipPress,
  preparingText,
  detailText,
  onSelectServer,
  onSelectAudio,
  onSelectSubtitle,
  onSelectQuality,
}) => {
  const colors = useDetailPalette(backdrop || poster);
  const [activeSheet, setActiveSheet] = useState<RemoteSheetType | null>(null);
  // Open the picker on arrival when nothing is connected yet.
  const [devicePickerVisible, setDevicePickerVisible] = useState(
    () => !useRemoteStore.getState().connectedDevice,
  );
  const closeDevicePicker = useCallback(() => setDevicePickerVisible(false), []);

  if (isTV) return null;

  return (
    <M3PaletteContext.Provider value={colors}>
      <View style={{backgroundColor: colors.background, flex: 1}}>
        <StatusBar style="light" />
        <OrientationLocker orientation={PORTRAIT} />

        {!!(backdrop || poster) && (
          <View
            pointerEvents="none"
            style={{height: BACKDROP_HEIGHT, left: 0, position: 'absolute', right: 0, top: 0}}>
            <Image
              source={{uri: backdrop || poster}}
              resizeMode="cover"
              resizeMethod="resize"
              blurRadius={backdrop ? 0 : 12}
              style={{height: BACKDROP_HEIGHT, opacity: 0.35, width: '100%'}}
            />
            <LinearGradient
              colors={[`${colors.background}00`, colors.background]}
              style={{bottom: 0, height: BACKDROP_HEIGHT * 0.7, left: 0, position: 'absolute', right: 0}}
            />
          </View>
        )}

        <SafeAreaView style={{flex: 1}} edges={['top', 'bottom']}>
          <RemoteHeader
            onBack={onBack}
            onOpenDevicePicker={() => setDevicePickerVisible(true)}
          />
          <RemoteMediaCard title={title} subtitle={subtitle} poster={poster || backdrop} />
          <RemoteStatusLine
            skipIntervals={skipIntervals}
            onSkipPress={onSkipPress}
            preparingText={preparingText}
            detailText={detailText}
          />
          <RemoteScrubber />
          <View style={{paddingBottom: 16, paddingTop: 8}}>
            <RemoteControls />
          </View>
          <View style={{paddingBottom: 8}}>
            <RemoteActionBar
              hasEpisodes={!!episodes && episodes.length > 1}
              onOpenSheet={setActiveSheet}
            />
          </View>
        </SafeAreaView>

        <RemoteSettingsSheets
          savedSubtitles={savedSubtitles}
          onAddSavedSubtitle={onAddSavedSubtitle}
          onRemoveSavedSubtitle={onRemoveSavedSubtitle}
          sheetType={activeSheet}
          onClose={() => setActiveSheet(null)}
          episodes={episodes}
          activeEpisodeIndex={activeEpisodeIndex}
          onSelectEpisode={onSelectEpisode}
          onSelectServer={onSelectServer}
          onSelectAudio={onSelectAudio}
          onSelectSubtitle={onSelectSubtitle}
          onSelectQuality={onSelectQuality}
          subtitleSearchQuery={title}
        />

        <DevicePickerModal
          visible={devicePickerVisible}
          onClose={closeDevicePicker}
          onStopCasting={onBack}
        />
      </View>
    </M3PaletteContext.Provider>
  );
};
