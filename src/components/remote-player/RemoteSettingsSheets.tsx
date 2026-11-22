import type {SavedSubtitle, SubtitleInput} from '../../lib/subtitles/savedSubtitles';
import RemovableSubtitleRow from '../RemovableSubtitleRow';
import {languageLabel} from '../../lib/player/languageLabel';
import {isRemotePlaybackCanceled} from '../../lib/remote/remotePlaybackErrors';
import * as DocumentPicker from 'expo-document-picker';
import React, {useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {MAX_PLAYER_DELAY_MS, formatDelay} from '../PlayerDelayControl';
import AppText from '../ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import SearchSubtitles, {FoundSubtitle} from '../SearchSubtitles';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {vegaCastService} from '../../lib/remote/vegaCastService';
import {
  RemoteAudioTrack,
  RemoteQuality,
  RemoteServer,
  RemoteSubtitleTrack,
} from '../../lib/remote/types';
import {EpisodeLink} from '../../lib/providers/types';
import {isTV} from '../../lib/tv';
import {
  RemoteSheet,
  RemoteSheetEmpty,
  RemoteSheetOption,
  RemoteSheetSectionLabel,
} from './RemoteSheet';

const qualityDetail = (q: RemoteQuality): string =>
  [
    q.bitrate
      ? q.bitrate >= 1e6
        ? `${(q.bitrate / 1e6).toFixed(1)} Mbps`
        : `${Math.round(q.bitrate / 1e3)} kbps`
      : undefined,
    q.width && q.height ? `${q.width}Ã—${q.height}` : q.resolution,
  ]
    .filter(Boolean)
    .join(' · ');

const qualityIcon = (
  q: RemoteQuality,
): 'video-4k-box' | 'high-definition' | 'standard-definition' =>
  (q.height ?? 0) >= 2160
    ? 'video-4k-box'
    : (q.height ?? 0) >= 720
      ? 'high-definition'
      : 'standard-definition';

export type RemoteSheetType =
  | 'server'
  | 'audio'
  | 'subtitles'
  | 'quality'
  | 'speed'
  | 'episodes';

interface RemoteSettingsSheetsProps {
  savedSubtitles?: SavedSubtitle[];
  onAddSavedSubtitle?: (track: SubtitleInput, origin: SavedSubtitle['origin']) => Promise<SavedSubtitle | undefined>;
  onRemoveSavedSubtitle?: (id: string) => Promise<void>;
  sheetType: RemoteSheetType | null;
  onClose: () => void;
  episodes?: EpisodeLink[];
  activeEpisodeIndex?: number;
  onSelectEpisode?: (index: number) => void;
  onSelectServer?: (server: RemoteServer) => void;
  onSelectAudio?: (track: RemoteAudioTrack) => void;
  onSelectSubtitle?: (track?: RemoteSubtitleTrack) => void;
  onSelectQuality?: (q: RemoteQuality) => void;
  /** Starting text for the online subtitle search. */
  subtitleSearchQuery?: string;
}

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

const TITLES: Record<RemoteSheetType, string> = {
  server: 'Server',
  audio: 'Audio',
  subtitles: 'Subtitles',
  quality: 'Quality',
  speed: 'Playback speed',
  episodes: 'Episodes',
};

const DELAY_STEP_MS = 50;
const DELAY_LONG_STEP_MS = 500;

const DelayStepButton: React.FC<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  disabled?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}> = ({icon, label, disabled, onPress, onLongPress}) => {
  const colors = useM3Colors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{color: colors.onSurface, borderless: true}}
      style={{
        alignItems: 'center',
        backgroundColor: colors.surfaceContainerHighest,
        borderRadius: 20,
        height: 40,
        justifyContent: 'center',
        opacity: disabled ? 0.38 : 1,
        width: 40,
      }}>
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={colors.onSurface}
      />
    </Pressable>
  );
};

/**
 * Delay row laid out like the sheet's list rows. The value is a draft until
 * Apply, because applying reloads the stream at the current position.
 * Tap moves 0.05s, long press 0.5s.
 */
const RemoteDelayRow: React.FC<{
  kind: 'audio' | 'subtitle';
  disabledText?: string;
}> = ({kind, disabledText}) => {
  const colors = useM3Colors();
  const applied = useRemoteStore(state =>
    kind === 'audio' ? state.audioDelayMs : state.subtitleDelayMs,
  );
  const [draft, setDraft] = useState(applied);
  const [applying, setApplying] = useState(false);
  useEffect(() => setDraft(applied), [applied]);
  const disabled = Boolean(disabledText) || applying;
  const changed = draft !== applied;

  const step = (amount: number) =>
    setDraft(current =>
      Math.max(
        -MAX_PLAYER_DELAY_MS,
        Math.min(MAX_PLAYER_DELAY_MS, current + amount),
      ),
    );

  const apply = () => {
    const {audioDelayMs, subtitleDelayMs} = useRemoteStore.getState();
    setApplying(true);
    remotePlaybackManager
      .applyDelays(
        kind === 'subtitle' ? draft : subtitleDelayMs,
        kind === 'audio' ? draft : audioDelayMs,
      )
      .catch((error: Error) => {
        if (!isRemotePlaybackCanceled(error))
          useRemoteStore
            .getState()
            .setErrorMessage(error?.message || 'Unable to apply the delay');
      })
      .finally(() => setApplying(false));
  };

  const later = kind === 'audio' ? 'Sound plays later' : 'Text shows later';
  const earlier =
    kind === 'audio' ? 'Sound plays earlier' : 'Text shows earlier';
  const supportingText =
    disabledText ||
    (applying
      ? 'Reloading the stream\u2026'
      : draft === 0
        ? 'In sync'
        : draft > 0
          ? later
          : earlier);

  return (
    <>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          gap: 16,
          minHeight: 56,
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}>
        <MaterialCommunityIcons
          name={kind === 'audio' ? 'timer-sync-outline' : 'closed-caption-outline'}
          size={22}
          color={colors.onSurfaceVariant}
        />
        <View style={{flex: 1, minWidth: 0}}>
          <AppText
            role="bodyLarge"
            numberOfLines={1}
            style={{color: colors.onSurface}}>
            {kind === 'audio' ? 'Audio delay' : 'Subtitle delay'}
          </AppText>
          <AppText
            role="bodyMedium"
            numberOfLines={1}
            style={{color: colors.onSurfaceVariant}}>
            {supportingText}
          </AppText>
        </View>
        <View style={{alignItems: 'center', flexDirection: 'row'}}>
          <DelayStepButton
            icon="minus"
            label="0.05 seconds earlier"
            disabled={disabled || draft <= -MAX_PLAYER_DELAY_MS}
            onPress={() => step(-DELAY_STEP_MS)}
            onLongPress={() => step(-DELAY_LONG_STEP_MS)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${formatDelay(draft)}. Reset to zero`}
            disabled={disabled}
            onPress={() => setDraft(0)}
            style={{minWidth: 68, paddingVertical: 8}}>
            <AppText
              role="titleMedium"
              style={{
                color: draft === 0 ? colors.onSurface : colors.primary,
                fontVariant: ['tabular-nums'],
                textAlign: 'center',
              }}>
              {formatDelay(draft)}
            </AppText>
          </Pressable>
          <DelayStepButton
            icon="plus"
            label="0.05 seconds later"
            disabled={disabled || draft >= MAX_PLAYER_DELAY_MS}
            onPress={() => step(DELAY_STEP_MS)}
            onLongPress={() => step(DELAY_LONG_STEP_MS)}
          />
        </View>
      </View>
      {changed && !disabledText ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            justifyContent: 'flex-end',
            paddingBottom: 8,
            paddingHorizontal: 16,
          }}>
          <Pressable
            accessibilityRole="button"
            disabled={applying}
            onPress={() => setDraft(applied)}
            style={{borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10}}>
            <AppText role="labelLarge" style={{color: colors.primary}}>
              Cancel
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={applying}
            onPress={apply}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 20,
              opacity: applying ? 0.6 : 1,
              paddingHorizontal: 24,
              paddingVertical: 10,
            }}>
            <AppText role="labelLarge" style={{color: colors.onPrimary}}>
              {applying ? 'Applying\u2026' : 'Apply'}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </>
  );
};

export const RemoteSettingsSheets: React.FC<RemoteSettingsSheetsProps> = ({
  savedSubtitles = [],
  onAddSavedSubtitle,
  onRemoveSavedSubtitle,
  sheetType,
  onClose,
  episodes,
  activeEpisodeIndex,
  onSelectEpisode,
  onSelectServer,
  onSelectAudio,
  onSelectSubtitle,
  onSelectQuality,
  subtitleSearchQuery,
}) => {
  const [searchQuery, setSearchQuery] = useState(subtitleSearchQuery || '');
  const colors = useM3Colors();
  const servers = useRemoteStore(state => state.servers);
  const activeServerId = useRemoteStore(state => state.activeServerId);
  const audioTracks = useRemoteStore(state => state.audioTracks);
  const activeAudioTrackId = useRemoteStore(state => state.activeAudioTrackId);
  const subtitleTracks = useRemoteStore(state => state.subtitleTracks);
  const activeSubtitleTrackId = useRemoteStore(
    state => state.activeSubtitleTrackId,
  );
  const qualities = useRemoteStore(state => state.qualities);
  const activeQualityId = useRemoteStore(state => state.activeQualityId);
  const playbackRate = useRemoteStore(state => state.playbackRate);
  const connectedDevice = useRemoteStore(state => state.connectedDevice);

  if (isTV) return null;

  const select = (action: () => void) => {
    action();
    onClose();
  };

  const handleSelectSpeed = (speed: number) => {
    if(connectedDevice?.type==='vega-cast'){
      void vegaCastService.command('SPEED',speed).catch(error=>useRemoteStore.getState().setErrorMessage(error.message));return;
    }
    const client = remotePlaybackManager.getCastClient();
    if (!client || connectedDevice?.type !== 'cast') {
      useRemoteStore
        .getState()
        .setErrorMessage('Playback speed is unavailable on this receiver');
      return;
    }
    client
      .setPlaybackRate(speed)
      .then(() => useRemoteStore.getState().setPlaybackRate(speed))
      .catch((error: Error) => {
        if (!isRemotePlaybackCanceled(error))
          useRemoteStore.getState().setErrorMessage(error.message || 'Unable to change playback speed');
      });
  };

  const addSubtitle = async (track: SubtitleInput, origin: SavedSubtitle['origin'] = 'search') => {
    try {
      const saved = onAddSavedSubtitle ? await onAddSavedSubtitle(track, origin) : undefined;
      if (onAddSavedSubtitle && !saved) return; // Episode changed while downloading.
      onClose();
      await remotePlaybackManager.addExternalSubtitle(saved ? {...saved, savedSubtitleId: saved.id} : track);
    } catch (error) {
      if (!isRemotePlaybackCanceled(error)) useRemoteStore.getState().setErrorMessage(error instanceof Error ? error.message : 'Could not add subtitle');
    }
  };
  const removeSubtitle = async (saved: SavedSubtitle) => {
    try {
      const active = useRemoteStore.getState().subtitleTracks.find(sub => sub.id === useRemoteStore.getState().activeSubtitleTrackId);
      if (active?.uri === saved.uri || active?.savedSubtitleId === saved.id) await remotePlaybackManager.setActiveSubtitleTrack(undefined);
      await onRemoveSavedSubtitle?.(saved.id);
      // Keep receiver ordinals stable for the active session. Removed cache rows
      // are hidden below; the next media load rebuilds the receiver's track list.
    } catch (error) {useRemoteStore.getState().setErrorMessage(error instanceof Error ? error.message : 'Could not remove subtitle');}
  };

  const pickSubtitleFile = async () => {
    try {
      // The picker copies the file into the app cache, the only local
      // folder the phone server shares with the receiver.
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'text/vtt',
          'application/x-subrip',
          'text/srt',
          'application/ttml+xml',
          'text/plain',
          'application/octet-stream',
        ],
        multiple: false,
        copyToCacheDirectory: true,
      });
      const asset = !res.canceled ? res.assets?.[0] : undefined;
      if (!asset) return;
      await addSubtitle({
        uri: asset.uri,
        title: asset.name || 'External subtitle',
        language: 'und',
        type: asset.mimeType && !['text/plain', 'application/octet-stream'].includes(asset.mimeType) ? asset.mimeType : undefined,
      }, 'file');
    } catch (error: any) {
      useRemoteStore
        .getState()
        .setErrorMessage(error?.message || 'Could not open the subtitle file');
    }
  };

  const renderContent = () => {
    switch (sheetType) {
      case 'server': {
        const qualityRows = qualities.map((q, i) => (
          <RemoteSheetOption
            key={`q-${q.id || i}`}
            icon={qualityIcon(q)}
            title={q.height ? `${q.height}p` : q.label}
            supportingText={qualityDetail(q)}
            selected={q.id === activeQualityId}
            onPress={() => select(() => onSelectQuality?.(q))}
          />
        ));
        return (
          <>
            <RemoteSheetSectionLabel text="Server" />
            {servers.length === 0 ? (
              <RemoteSheetEmpty text="No other servers for this title" />
            ) : (
              servers.map((server, i) => (
                <RemoteSheetOption
                  key={server.id || i}
                  icon="dns"
                  title={server.name}
                  supportingText={[
                    server.quality,
                    ...(server.tags || []).filter(
                      t => t && t !== server.quality,
                    ),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={server.id === activeServerId}
                  onPress={() =>
                    select(() => {
                      useRemoteStore.getState().setActiveServerId(server.id);
                      onSelectServer?.(server);
                    })
                  }
                />
              ))
            )}
            {qualities.length > 1 && (
              <>
                <RemoteSheetSectionLabel text="Quality" />
                {qualityRows}
              </>
            )}
          </>
        );
      }

      case 'quality':
        return qualities.length === 0 ? (
          <RemoteSheetEmpty text="This stream has a single quality" />
        ) : (
          qualities.map((q, i) => (
            <RemoteSheetOption
              key={q.id || i}
              icon={qualityIcon(q)}
              title={q.height ? `${q.height}p` : q.label}
              supportingText={qualityDetail(q)}
              selected={q.id === activeQualityId}
              onPress={() => select(() => onSelectQuality?.(q))}
            />
          ))
        );

      case 'audio':
        return (
          <>
            {audioTracks.length === 0 ? (
              <RemoteSheetEmpty text="Reading audio tracksâ€¦" />
            ) : (
              audioTracks.map((track, i) => {
                const language = languageLabel(track.language);
                return (
                  <RemoteSheetOption
                    key={track.id || i}
                    title={languageLabel(track.title, language || `Track ${i + 1}`)}
                    supportingText={[language, track.codec]
                      .filter(Boolean)
                      .join(' · ')}
                    selected={
                      activeAudioTrackId
                        ? track.id === activeAudioTrackId
                        : Boolean(track.isSelected)
                    }
                    onPress={() =>
                      select(() =>
                        onSelectAudio
                          ? onSelectAudio(track)
                          : remotePlaybackManager
                              .switchAudioTrack(track)
                              .catch(() => {}),
                      )
                    }
                  />
                );
              })
            )}
            <RemoteSheetSectionLabel text="Sync" />
            <RemoteDelayRow kind="audio" />
          </>
        );

      case 'subtitles':
        return (
          <>
            <RemoteSheetOption
              title="Off"
              selected={!activeSubtitleTrackId}
              onPress={() => select(() => onSelectSubtitle?.(undefined))}
            />
            {subtitleTracks.filter(sub => !sub.savedSubtitleId || savedSubtitles.some(saved => saved.id === sub.savedSubtitleId)).map((sub, i) => {
              const language = languageLabel(sub.language);
              const saved = savedSubtitles.find(item => item.uri === sub.uri || item.id === sub.savedSubtitleId);
              return (
                <RemovableSubtitleRow key={sub.id || i} title={saved?.title || ''}
                  color={colors.onSurface} onRemove={saved && onRemoveSavedSubtitle ? () => {void removeSubtitle(saved);} : undefined}>
                <RemoteSheetOption
                  key={sub.id || i}
                  title={languageLabel(sub.title, language || `Subtitle ${i + 1}`)}
                  supportingText={[
                    language,
                    saved ? (saved.origin === 'search' ? 'Saved search' : 'Saved file') : sub.isEmbedded ? 'Embedded' : 'External',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={sub.id === activeSubtitleTrackId}
                  onPress={() => select(() => onSelectSubtitle?.(sub))}
                />
                </RemovableSubtitleRow>
              );
            })}
            {savedSubtitles.filter(saved => !subtitleTracks.some(sub => sub.uri === saved.uri)).map(saved => (
              <RemovableSubtitleRow key={saved.id} title={saved.title} color={colors.onSurface}
                onRemove={onRemoveSavedSubtitle ? () => {void removeSubtitle(saved);} : undefined}>
                <RemoteSheetOption title={saved.title} supportingText={`${languageLabel(saved.language)} · Saved`}
                  onPress={() => {onClose(); void remotePlaybackManager.addExternalSubtitle({...saved, savedSubtitleId: saved.id}).catch(() => {});}} />
              </RemovableSubtitleRow>
            ))}
            <RemoteSheetSectionLabel text="Sync" />
            <RemoteDelayRow
              kind="subtitle"
              disabledText={
                activeSubtitleTrackId ? undefined : 'Turn on a subtitle first'
              }
            />
            <RemoteSheetSectionLabel text="Add subtitles" />
            <RemoteSheetOption
              icon="file-document-outline"
              title="Add external file"
              supportingText="SRT, VTT or TTML from this phone"
              onPress={pickSubtitleFile}
            />
            <SearchSubtitles
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onAddSubtitle={addSubtitle}
              renderTrigger={open => (
                <RemoteSheetOption
                  icon="earth"
                  title="Search subtitles online"
                  supportingText="Find subtitles for this video"
                  onPress={open}
                />
              )}
            />
          </>
        );

      case 'speed':
        return SPEEDS.map(speed => (
          <RemoteSheetOption
            key={speed}
            title={speed === 1 ? 'Normal' : `${speed}x`}
            selected={playbackRate === speed}
            onPress={() => select(() => handleSelectSpeed(speed))}
          />
        ));

      case 'episodes':
        return !episodes || episodes.length === 0 ? (
          <RemoteSheetEmpty text="No episodes available" />
        ) : (
          episodes.map((ep, i) => (
            <RemoteSheetOption
              key={ep.id || ep.link || i}
              thumbnail={ep.image}
              icon="play-circle"
              thumbnailPlaceholder
              title={ep.title || `Episode ${i + 1}`}
              supportingText={ep.description}
              selected={i === activeEpisodeIndex}
              onPress={() => select(() => onSelectEpisode?.(i))}
            />
          ))
        );

      default:
        return null;
    }
  };

  return (
    <RemoteSheet
      visible={Boolean(sheetType)}
      title={sheetType ? TITLES[sheetType] : ''}
      onClose={onClose}>
      {renderContent()}
    </RemoteSheet>
  );
};
