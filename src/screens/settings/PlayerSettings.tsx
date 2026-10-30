import ExternalAppPreference from './components/ExternalAppPreference';
import DropdownField from '../../components/ui/DropdownField';
import {getPlayerControlStyleRows} from '../../components/PlayerControlStyleEditor';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useState, useCallback} from 'react';
import {View, ToastAndroid, BackHandler, Platform} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {SettingsStackParamList} from '../../App';
import {settingsStorage, PLAYER_RESIZE_MODES, SEEK_INTERVAL_OPTIONS, PLAYBACK_SPEED_MIN, PLAYBACK_SPEED_MAX, PLAYBACK_SPEED_STEP} from '../../lib/storage';
import {setVideoIntentsEnabled, supportsVideoIntents} from '../../lib/services/videoIntent';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import AppText from '../../components/ui/Text';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import SettingsSliderRow from '../../components/ui/SettingsSliderRow';
import SettingsRow from '../../components/ui/SettingsRow';
import BufferPreference from './components/BufferPreference';

type Props = NativeStackScreenProps<SettingsStackParamList, 'PlayerSettings'>;
export default function PlayerSettings({navigation}: Props) {
  const colors = useM3Colors();
  const [controlStyle, setControlStyle] = useState(() => settingsStorage.getPlayerControlStyle());
  useFocusEffect(useCallback(() => {
    if (!isTV) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack(); return true;
    });
    return () => sub.remove();
  }, [navigation]));
  const [defaultResizeMode, setDefaultResizeMode] = useState(() =>
    settingsStorage.getDefaultResizeMode(),
  );
  const [playbackSpeed, setPlaybackSpeed] = useState(() => settingsStorage.getPlaybackSpeed());
  const [showMediaControls, setShowMediaControls] = useState<boolean>(() =>
    settingsStorage.showMediaControls(),
  );

  const [hideSeekButtons, setHideSeekButtons] = useState<boolean>(() =>
    settingsStorage.hideSeekButtons(),
  );

  const [seekInterval, setSeekInterval] = useState<number>(() =>
    settingsStorage.getSeekInterval(),
  );


  const [ambientVideo, setAmbientVideo] = useState(() => settingsStorage.isAmbientVideoEnabled());
  const [ambientIntensity, setAmbientIntensity] = useState(() => Math.round(settingsStorage.getAmbientIntensity() * 100));
  const [ambientSpread, setAmbientSpread] = useState(() => Math.round(settingsStorage.getAmbientSpread() * 100));
  const [ambientResponseMs, setAmbientResponseMs] = useState(() => settingsStorage.getAmbientResponseMs());
  useFocusEffect(useCallback(() => {
    setAmbientVideo(settingsStorage.isAmbientVideoEnabled());
    setAmbientIntensity(Math.round(settingsStorage.getAmbientIntensity() * 100));
    setAmbientSpread(Math.round(settingsStorage.getAmbientSpread() * 100));
    setAmbientResponseMs(settingsStorage.getAmbientResponseMs());
  }, []));

  const [autoPlayNextEpisode, setAutoPlayNextEpisode] = useState<boolean>(() =>
    settingsStorage.isAutoPlayNextEpisodeEnabled(),
  );

  const [showTimeRemaining, setShowTimeRemaining] = useState<boolean>(() =>
    settingsStorage.isShowTimeRemaining(),
  );

  const [enableSwipeGesture, setEnableSwipeGesture] = useState<boolean>(() =>
    settingsStorage.isSwipeGestureEnabled(),
  );
  const [enableVolumeBoost, setEnableVolumeBoost] = useState(() =>
    settingsStorage.isVolumeBoostEnabled(),
  );

  const [openVideosFromOtherApps, setOpenVideosFromOtherApps] = useState(() =>
    settingsStorage.isOpenVideosFromOtherAppsEnabled(),
  );
  const updatingVideoIntents = React.useRef(false);

  const [OpenExternalPlayer, setOpenExternalPlayer] = useState(() =>
    settingsStorage.getBool('useExternalPlayer', false),
  );

  const [torrentFullDownload, setTorrentFullDownload] = useState<boolean>(() =>
    settingsStorage.isTorrentFullDownload(),
  );
  const [alwaysCastMode, setAlwaysCastMode] = useState<boolean>(() =>
    settingsStorage.isAlwaysCastMode(),
  );
  const [askLocalFileFirst, setAskLocalFileFirst] = useState<boolean>(() =>
    settingsStorage.isAskLocalFileFirst(),
  );

  return (
    <TVFocusGuide
      autoFocus={true}
      trapFocusRight={true}
      trapFocusDown={true}
      style={{flex: 1}}>
      <SettingsPage>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              Player settings
            </AppText>
          </View>
          <AppText
            role="bodyLarge"
            className="mb-7 mt-1 text-m3-on-surface-variant">
            Playback, controls, appearance, and subtitles
          </AppText>

          <SettingsSection title="Customize player">
            <SettingsRow title="Control layout" description="Arrange, move, and hide controls"
              icon="view-dashboard-outline" onPress={() => navigation.navigate('PlayerControlSettings')} />
            <SettingsRow title="Subtitle style" description="Font, colors, background, placement, and more"
              icon="subtitles-outline" divider={false} onPress={() => navigation.navigate('SubTitlesPreferences')} />
          </SettingsSection>
          <SettingsSection title="Control appearance">
            {getPlayerControlStyleRows({value: controlStyle, color: colors.primary,
              onChange: next => {settingsStorage.setPlayerControlStyle(next); setControlStyle(next);},
            }).map((row, index) => <View key={'appearance:' + index} style={{paddingHorizontal: 16, paddingTop: index === 0 ? 16 : 0, paddingBottom: 12}}>{row}</View>)}
          </SettingsSection>
          <SettingsSection title="Opening videos">
            {supportsVideoIntents && (
              <SettingsSwitchRow
                title="Open videos from other apps"
                description="Show Vega in Android’s Open with and video sharing options"
                value={openVideosFromOtherApps}
                onValueChange={async next => {
                  if (updatingVideoIntents.current) return;
                  updatingVideoIntents.current = true;
                  try {
                    await setVideoIntentsEnabled(next);
                    settingsStorage.setOpenVideosFromOtherAppsEnabled(next);
                    setOpenVideosFromOtherApps(next);
                  } catch {
                    ToastAndroid.show('Unable to update video opening support', ToastAndroid.SHORT);
                  } finally {
                    updatingVideoIntents.current = false;
                  }
                }}
              />
            )}
            {!isTV && (
              <SettingsSwitchRow
                title="Ask for local file first"
                description="Before loading online streams, offer to play a video file from this device"
                value={askLocalFileFirst}
                onValueChange={next => {
                  settingsStorage.setAskLocalFileFirst(next);
                  setAskLocalFileFirst(next);
                }}
              />
            )}
            {!isTV && (
              <SettingsSwitchRow
                title="Always cast mode"
                description="Stream directly to TV instead of opening the local phone player"
                value={alwaysCastMode}
                divider={false}
                onValueChange={next => {
                  settingsStorage.setAlwaysCastMode(next);
                  setAlwaysCastMode(next);
                }}
              />
            )}
          </SettingsSection>
          <SettingsSection title="Playback">
            <View
              className="px-4 py-3"
              style={{
                borderBottomColor: colors.outlineVariant,
                borderBottomWidth: 1,
              }}>
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                Default video fit
              </AppText>
              <AppText
                role="bodySmall"
                style={{color: colors.onSurfaceVariant, marginTop: 3}}>
                How videos fill the screen when playback starts
              </AppText>
              <View style={{width: '100%', minHeight: 56, marginTop: 12}}>
                <DropdownField
                  placeholder="Default video fit"
                  options={PLAYER_RESIZE_MODES}
                  value={PLAYER_RESIZE_MODES.find(
                    option => option.mode === defaultResizeMode,
                  )}
                  getKey={option => option.mode}
                  getLabel={option => option.label}
                  onChange={option => {
                    settingsStorage.setDefaultResizeMode(option.mode);
                    setDefaultResizeMode(option.mode);
                  }}
                />
              </View>
            </View>
            <SettingsSliderRow title="Playback speed" value={playbackSpeed}
              min={PLAYBACK_SPEED_MIN} max={PLAYBACK_SPEED_MAX} step={PLAYBACK_SPEED_STEP}
              valueDisplay={`${playbackSpeed.toFixed(2)}x`} widestValue="2.00x"
              onValueChange={setPlaybackSpeed}
              onValueChangeFinished={speed => settingsStorage.setPlaybackSpeed(speed)} />
            {Platform.OS === 'android' && <>
            <SettingsSwitchRow title="Ambient lighting" description="Soft video colors in the black bars around the picture"
              value={ambientVideo} onValueChange={next => {settingsStorage.setAmbientVideoEnabled(next); setAmbientVideo(next);}} />
            {ambientVideo && <>
              <SettingsSliderRow title="Ambient intensity" value={ambientIntensity} min={0} max={100} step={5}
                valueDisplay={`${ambientIntensity}%`} widestValue="100%" onValueChange={setAmbientIntensity}
                onValueChangeFinished={value => settingsStorage.setAmbientIntensity(value / 100)} />
              <SettingsSliderRow title="Ambient spread" description="Above 100%, the glow retains more color at the screen edges"
                value={ambientSpread} min={10} max={300} step={5}
                valueDisplay={`${ambientSpread}%`} widestValue="300%" onValueChange={setAmbientSpread}
                onValueChangeFinished={value => settingsStorage.setAmbientSpread(value / 100)} />
              <SettingsSliderRow title="Ambient responsiveness"
                description="Lower values follow the video faster and use more power. Higher values are smoother and use less power."
                value={ambientResponseMs} min={16} max={1000} step={2}
                valueDisplay={`${ambientResponseMs} ms`} widestValue="1000 ms" onValueChange={setAmbientResponseMs}
                onValueChangeFinished={value => settingsStorage.setAmbientResponseMs(value)} />
            </>}
            </>}

            <SettingsSwitchRow
              title="External player"
              description="Open streams in your preferred video app"
              value={OpenExternalPlayer}
              onValueChange={next => {
                settingsStorage.setBool('useExternalPlayer', next);
                setOpenExternalPlayer(next);
              }}
            />
            <ExternalAppPreference kind="player" />
            <SettingsSwitchRow
              title="Notification media controls"
              value={showMediaControls}
              onValueChange={next => {
                settingsStorage.setShowMediaControls(next);
                setShowMediaControls(next);
              }}
            />
            <SettingsSwitchRow
              title="Hide seek buttons"
              value={hideSeekButtons}
              onValueChange={next => {
                settingsStorage.setHideSeekButtons(next);
                setHideSeekButtons(next);
              }}
            />
            <SettingsSliderRow
              title="Seek interval"
              description="Used by double tap, seek buttons and the TV remote"
              value={SEEK_INTERVAL_OPTIONS.indexOf(seekInterval as typeof SEEK_INTERVAL_OPTIONS[number])}
              min={0}
              max={SEEK_INTERVAL_OPTIONS.length - 1}
              step={1}
              valueDisplay={`${seekInterval} seconds`}
              widestValue="90 seconds"
              onValueChange={index => setSeekInterval(SEEK_INTERVAL_OPTIONS[index])}
              onValueChangeFinished={index => settingsStorage.setSeekInterval(SEEK_INTERVAL_OPTIONS[index])}
            />
            <SettingsSwitchRow
              title="Auto play next episode"
              description="Start the next episode after a short countdown"
              value={autoPlayNextEpisode}
              onValueChange={next => {
                settingsStorage.setAutoPlayNextEpisode(next);
                setAutoPlayNextEpisode(next);
              }}
            />
            <SettingsSwitchRow
              title="Show remaining time"
              description="Display time remaining instead of total duration on the timeline (tap time to toggle)"
              value={showTimeRemaining}
              onValueChange={next => {
                settingsStorage.setShowTimeRemaining(next);
                setShowTimeRemaining(next);
              }}
            />
            <SettingsSwitchRow
              title="Swipe gestures"
              description="Adjust playback with gestures over the video"
              value={enableSwipeGesture}
              onValueChange={next => {
                settingsStorage.setSwipeGestureEnabled(next);
                setEnableSwipeGesture(next);
              }}
            />
            <SettingsSwitchRow
              title="Volume boost"
              description="Allow volume up to 200% in the built-in Android player"
              value={enableVolumeBoost}
              onValueChange={next => {
                settingsStorage.setVolumeBoostEnabled(next);
                setEnableVolumeBoost(next);
              }}
            />
            <SettingsSwitchRow
              title="Download full torrent"
              description={
                torrentFullDownload
                  ? 'Keep downloading the whole video while it plays'
                  : 'Download only about 1 minute ahead of playback'
              }
              value={torrentFullDownload}
              divider={false}
              onValueChange={next => {
                settingsStorage.setTorrentFullDownload(next);
                setTorrentFullDownload(next);
              }}
            />
          </SettingsSection>

          <BufferPreference />

      </SettingsPage>
    </TVFocusGuide>
  );
}
