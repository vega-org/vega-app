import {usePlayerControlAnimations} from '../../components/media-console/hooks/usePlayerControlAnimations';
import {isRemotePlaybackCanceled} from '../../lib/remote/remotePlaybackErrors';
import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {
  Animated as NativeAnimated,
  AppState,
  AppStateStatus,
  BackHandler,
  FlatList,
  findNodeHandle,
  Image,
  Pressable,
  ScrollView,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  Platform,
  TouchableNativeFeedback,
  Modal,
  UIManager,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../../App';
import {
  cacheStorage,
  PLAYBACK_SPEEDS,
  settingsStorage,
} from '../../lib/storage';
import Orientation, {
  OrientationLocker,
  PORTRAIT,
  LANDSCAPE,
} from 'react-native-orientation-locker';
import {SystemBars} from 'react-native-edge-to-edge';
import VideoPlayer from '../../components/media-console';
import {playPauseRef} from '../../components/media-console/components/PlayPause/PlayPause';
import {Back} from '../../components/media-console/components/Back';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  VideoRef,
  SelectedVideoTrackType,
  ResizeMode,
  SelectedTrackType,
  BufferingStrategyType,
} from 'react-native-video';
import useContentStore from '../../lib/zustand/contentStore';
import GoogleCast, {
  useCastDevice,
  useRemoteMediaClient,
} from 'react-native-google-cast';
import {SafeAreaView} from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {FlashList} from '@shopify/flash-list';
import SearchSubtitles from '../../components/SearchSubtitles';
import {
  isLocalPath,
  getCompletedDownloadPathSync,
  useStream,
  useVideoSettings,
} from '../../lib/hooks/useStream';
import {useStreamTrackSelections} from '../../lib/hooks/useStreamTrackSelections';
import {useStreamResumePosition} from '../../lib/hooks/useStreamResumePosition';
import {
  usePlayerProgress,
  usePlayerSettings,
} from '../../lib/hooks/usePlayerSettings';
import * as NavigationBar from 'expo-navigation-bar';
import {StatusBar} from 'react-native';
import {torrentManager} from '../../lib/torrentManager';
import {
  isDummyTorrentLink,
  isTorrentStream,
  resolveTorrentStream,
} from '../../lib/torrentStream';
import {syncFromSharedFolder} from '../../lib/sync/syncService';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import useContinueWatchingStore from '../../lib/zustand/continueWatchingStore';
import useLocalVideoStore from '../../lib/zustand/localVideoStore';
import useDownloadsStore, {
  type DownloadItem,
} from '../../lib/zustand/downloadsStore';
import {RemotePlayerScreen} from '../../components/remote-player';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {remoteDeliveryService} from '../../lib/remote/remoteDeliveryService';
import {
  RemoteAudioTrack,
  RemoteDevice,
  RemoteServer,
  RemoteSubtitleTrack,
} from '../../lib/remote/types';
import {
  getEpisodeIdentity,
  getLocalVideoAssociationKey,
} from '../../lib/utils/episodeIdentity';
import {takePersistableUriPermission} from '../../lib/uriPermission';
import AnimatedHourglass from '../../components/AnimatedHourglass';
import PlayerMenuRow from '../../components/PlayerMenuRow';
import PlayerDelayControl from '../../components/PlayerDelayControl';
import {extractImageAccent} from '../../lib/imageAccent';
import {mixHex} from '../../theme/seeds';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {syncParallelStreaming} from '../../lib/parallelStreaming';
import {EpisodeLink, SkipInterval} from '../../lib/providers/types';
import {getValidImageUri} from '../../components/EpisodeRowContent';
import {Feather} from '@expo/vector-icons';
import {isTV, usePlayerTVControls} from '../../lib/tv';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import AutoNextOverlay from '../../components/AutoNextOverlay';
import {
  AUTO_NEXT_COUNTDOWN_SECONDS,
  isSeekAwayFromEnd,
  shouldAutoPlayNext,
} from '../../lib/player/autoNext';
import {useSleepTimer} from '../../lib/hooks/useSleepTimer';
import {
  SLEEP_TIMER_OPTIONS,
  formatSleepRemaining,
  getSleepOptionLabel,
} from '../../lib/player/sleepTimer';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const readCachedProgress = (link?: string) => {
  if (!link) {
    return {position: 0, duration: 0};
  }
  try {
    const cached = cacheStorage.getString(link);
    if (!cached) {
      return {position: 0, duration: 0};
    }
    const parsed = JSON.parse(cached) as {
      position?: number;
      duration?: number;
    };
    return {
      position: parsed.position || 0,
      duration: parsed.duration || 0,
    };
  } catch {
    return {position: 0, duration: 0};
  }
};

const getCachedSkips = (keys: (string | undefined)[]): SkipInterval[] => {
  for (const key of keys) {
    if (!key) continue;
    try {
      const cached = cacheStorage.getString(`skips_${key}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
  }
  return [];
};

const cacheSkips = (keys: (string | undefined)[], skips: SkipInterval[]) => {
  if (!skips || skips.length === 0) return;
  const serialized = JSON.stringify(skips);
  for (const key of keys) {
    if (!key) continue;
    try {
      cacheStorage.setString(`skips_${key}`, serialized);
    } catch {}
  }
};

// Download that holds the file or source of the playing episode, if any.
const findDownloadForEpisode = (
  downloads: Record<string, DownloadItem>,
  activeEpisode: any,
  selectedStream: any,
): DownloadItem | undefined =>
  Object.values(downloads).find(
    d =>
      (activeEpisode?.id && d.id === activeEpisode.id) ||
      (activeEpisode?.link &&
        (d.filePath === activeEpisode.link ||
          d.url === activeEpisode.link ||
          d.sourceLink === activeEpisode.link)) ||
      (activeEpisode?.sourceLink &&
        (d.sourceLink === activeEpisode.sourceLink ||
          d.url === activeEpisode.sourceLink ||
          d.filePath === activeEpisode.sourceLink)) ||
      (selectedStream?.link &&
        (d.filePath === selectedStream.link || d.url === selectedStream.link)),
  );

// Everything the screen renders from the playback position: the active skip
// interval and whether the "Next" button shows (past 80% of the video).
const getPlaybackRenderKey = (
  time: number,
  skips: SkipInterval[],
  duration: number,
) => {
  const skipIndex = skips.findIndex(s => time >= s.from && time < s.to);
  const nearEnd = duration > 0 && time / duration > 0.8;
  return `${skipIndex}:${nearEnd}`;
};

const getResumePosition = (position: number, duration: number) => {
  if (!Number.isFinite(position) || position <= 5) {
    return 0;
  }

  // Completed episodes (including the 1/1 and legacy 10000/1 "watched"

  if (Number.isFinite(duration) && duration > 0 && position / duration > 0.85) {
    return 0;
  }

  return position;
};

const formatTVTimelineTime = (time: number): string => {
  if (!Number.isFinite(time) || time < 0) return '00:00';
  const seconds = Math.floor(time);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const minuteText = minutes.toString().padStart(2, '0');
  const secondText = remainder.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
};

const SHOW_FULLSCREEN_BUTTON = false;
const BOTTOM_CONTROL_ICON_COLOR = 'rgba(255,255,255,0.68)';
const BOTTOM_CONTROL_LABEL_STYLE = {
  color: BOTTOM_CONTROL_ICON_COLOR,
  fontWeight: '300' as const,
};
const BottomControlButton = isTV ? Pressable : TouchableOpacity;

/** "#RGB" / "#RRGGBB" / "#AARRGGBB" to Android "#AARRGGBB" with the given alpha. */
const withAlpha = (hex: string, opacity: number) => {
  let rgb = hex.replace('#', '');
  if (rgb.length === 3)
    rgb = rgb
      .split('')
      .map(c => c + c)
      .join('');
  if (rgb.length === 8) rgb = rgb.slice(2);
  if (!/^[0-9a-f]{6}$/i.test(rgb) || opacity >= 1) return hex;
  const alpha = Math.round(Math.max(0, opacity) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${alpha}${rgb}`;
};

type QualityIconName = '8k' | '4k' | '2k' | 'hd' | 'sd' | 'video-settings';

const getQualityIconName = (
  height?: number | string,
  fallbackQuality?: string,
): QualityIconName => {
  const normalizedFallback = fallbackQuality?.trim().toLowerCase() || '';
  const parsedHeight =
    Number(height) || Number(normalizedFallback.match(/\d+/)?.[0]);

  if (parsedHeight >= 3000 || /(?:8k|4320)/.test(normalizedFallback)) {
    return '8k';
  }
  if (parsedHeight >= 1500 || /(?:4k|2160)/.test(normalizedFallback)) {
    return '4k';
  }
  if (parsedHeight >= 1200 || normalizedFallback.includes('1440')) {
    return '2k';
  }
  if (parsedHeight >= 500 || /(?:1080|720|\bhd\b)/.test(normalizedFallback)) {
    return 'hd';
  }
  if (
    parsedHeight > 0 ||
    /(?:480|360|240|144|\bsd\b)/.test(normalizedFallback)
  ) {
    return 'sd';
  }

  return 'video-settings';
};

// URL of the phone's torrent stream server, which only listens on loopback.
const TORRENT_STREAM_URL = /^http:\/\/127\.0\.0\.1:\d+\/stream\//i;

const isCastableStreamUrl = (streamUrl: string, streamType?: string) => {
  // The delivery server relays the torrent stream to the receiver.
  if (TORRENT_STREAM_URL.test(streamUrl)) {
    return true;
  }
  if (streamType === 'torrent') {
    return false;
  }
  // Downloaded files are served to the receiver by the phone's delivery server.
  if (/^(content|file):\/\//i.test(streamUrl) || streamUrl.startsWith('/')) {
    return true;
  }
  if (!/^https?:\/\//i.test(streamUrl)) {
    return false;
  }

  try {
    const hostname = new URL(streamUrl).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
  } catch {
    return false;
  }
};

const goFullScreen = () => {
  SystemBars.setHidden(true);
  if (Platform.OS === 'android') {
    // Sticky-immersive behavior is handled by the system under edge-to-edge;
    NavigationBar.setVisibilityAsync('hidden').catch(() => {
      // Activity teardown can race this request during a dev reload or Back.
    });
    StatusBar.setHidden(true, 'slide');
  }
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PlayerSettingsLayer = ({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) => {
  if (isTV) {
    return (
      <Modal
        transparent={true}
        visible={true}
        animationType="fade"
        statusBarTranslucent={true}
        navigationBarTranslucent={true}
        onRequestClose={onClose}>
        {children}
      </Modal>
    );
  }
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(180)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        elevation: 50,
      }}>
      {children}
    </Animated.View>
  );
};

const exitFullScreen = () => {
  SystemBars.setHidden(false);
  if (Platform.OS === 'android') {
    // Show the navigation bar
    NavigationBar.setVisibilityAsync('visible').catch(() => {
      // The activity may already be gone when exiting the player.
    });
    StatusBar.setHidden(false, 'slide');
  }
};

const applyFullscreenMode = (isFullScreenEnabled: boolean) => {
  if (isFullScreenEnabled) {
    goFullScreen();
    return;
  }

  exitFullScreen();
};

const reapplyFullscreenMode = (
  isFullScreenEnabled: boolean,
  stillFullscreen: () => boolean = () => true,
) => {
  applyFullscreenMode(isFullScreenEnabled);

  if (Platform.OS === 'android' && isFullScreenEnabled) {
    setTimeout(() => {
      // The remote screen may have taken over during the delay.
      if (stillFullscreen()) applyFullscreenMode(true);
    }, 150);
  }
};

type SidebarEpisodeRowProps = {
  episode: EpisodeLink;
  index: number;
  title: string;
  description?: string;
  imageUri?: string;
  isActive: boolean;
  isFocusable: boolean;
  primaryColor: string;
  onSelect: () => void;
};

const SidebarEpisodeRow = React.memo<SidebarEpisodeRowProps>(
  ({
    index,
    title,
    description,
    imageUri,
    isActive,
    isFocusable,
    primaryColor,
    onSelect,
  }) => {
    const [imageFailed, setImageFailed] = useState(false);
    const [tvFocused, setTvFocused] = useState(false);
    const focusBorderColor = useTVFocusBorderColor(primaryColor);

    useEffect(() => {
      setImageFailed(false);
    }, [imageUri]);

    const content = (
      <>
        {/* Thumbnail */}
        <View
          style={{
            width: 80,
            height: 50,
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: '#1C1C1E',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 10,
            position: 'relative',
          }}>
          {imageUri && !imageFailed ? (
            <Image
              source={{uri: imageUri}}
              style={{width: '100%', height: '100%'}}
              resizeMode="cover"
              resizeMethod="resize"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={{alignItems: 'center', justifyContent: 'center'}}>
              <MaterialCommunityIcons
                name="movie-outline"
                size={20}
                color="rgba(255,255,255,0.4)"
              />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 10,
                  fontWeight: '600',
                  marginTop: 2,
                }}>
                EP {index + 1}
              </Text>
            </View>
          )}
          {isActive && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
              <MaterialCommunityIcons
                name="play-circle"
                size={24}
                color={primaryColor}
              />
            </View>
          )}
        </View>
        <View style={{flex: 1, justifyContent: 'center'}}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 13,
              fontWeight: isActive ? '700' : '600',
              color: isActive ? primaryColor : '#FFFFFF',
              marginBottom: description ? 3 : 0,
            }}>
            {title}
          </Text>
          {Boolean(description) && (
            <Text
              numberOfLines={2}
              style={{
                fontSize: 11,
                color: 'rgba(255, 255, 255, 0.55)',
                lineHeight: 14,
              }}>
              {description}
            </Text>
          )}
        </View>
      </>
    );

    if (!isTV) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onSelect}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 8,
            marginVertical: 4,
            borderRadius: 8,
            backgroundColor: isActive
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.03)',
            borderWidth: 1,
            borderColor: isActive ? primaryColor : 'rgba(255, 255, 255, 0.08)',
          }}>
          {content}
        </TouchableOpacity>
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        focusable={isFocusable}
        isTVSelectable={isFocusable}
        hasTVPreferredFocus={isFocusable && isActive}
        onFocus={() => setTvFocused(true)}
        onBlur={() => setTvFocused(false)}
        onPress={onSelect}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 8,
          marginVertical: 4,
          borderRadius: 8,
          backgroundColor: tvFocused
            ? 'rgba(255, 255, 255, 0.16)'
            : isActive
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.03)',
          // Fixed width so focus does not shift the row content.
          borderWidth: 2.5,
          borderColor: tvFocused
            ? focusBorderColor
            : isActive
              ? primaryColor
              : 'rgba(255, 255, 255, 0.08)',
        }}>
        {content}
      </Pressable>
    );
  },
);

const Player = ({route}: Props): React.JSX.Element => {
  const [syncReady, setSyncReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    syncFromSharedFolder()
      .catch(error => console.warn('[VegaSync] Player sync failed:', error))
      .finally(() => {
        if (mounted) {
          setSyncReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const colors = useM3Colors();
  const primary = colors.primary;
  const dynamicInfoAccentEnabled = settingsStorage.isDynamicInfoAccentEnabled();
  const hourglassArtwork =
    route.params?.poster?.poster || route.params?.poster?.background;
  const [hourglassSandColor, setHourglassSandColor] = useState(primary);

  useEffect(() => {
    let active = true;
    if (!dynamicInfoAccentEnabled || !hourglassArtwork) {
      setHourglassSandColor(primary);
      return () => {
        active = false;
      };
    }

    extractImageAccent(
      hourglassArtwork,
      `detail-poster-accent-v1:${hourglassArtwork}`,
    ).then(accent => {
      if (active) {
        setHourglassSandColor(
          accent ? mixHex(accent, '#FFFFFF', 0.72) : primary,
        );
      }
    });

    return () => {
      active = false;
    };
  }, [dynamicInfoAccentEnabled, hourglassArtwork, primary]);
  const provider = useContentStore(state => state.provider);
  const navigation = useNavigation();
  const upsertContinueWatching = useContinueWatchingStore(
    state => state.upsertItem,
  );
  const updateContinueWatchingProgress = useContinueWatchingStore(
    state => state.updateProgress,
  );
  const continueWatchingItems = useContinueWatchingStore(state => state.items);
  const localVideoAssociations = useLocalVideoStore(
    state => state.associations,
  );
  const setLocalVideoAssociation = useLocalVideoStore(
    state => state.setLocalVideo,
  );
  const clearLocalVideoAssociation = useLocalVideoStore(
    state => state.clearLocalVideo,
  );

  // Player ref
  const playerRef = useRef<VideoRef>(null as unknown as VideoRef);
  const remoteMediaClient = useRemoteMediaClient({
    ignoreSessionUpdatesInBackground: true,
  });
  // The cast button opens the remote screen before any device is connected.
  const [castRequested, setCastRequested] = useState(false);
  const castDevice = useCastDevice({ignoreSessionUpdatesInBackground: true});
  const hasSetInitialAudioRef = useRef(false);
  const hasSetInitialTextRef = useRef(false);
  const videoLoadedRef = useRef(false);
  const resumeAppliedRef = useRef(false);
  const loadedCastMediaRef = useRef('');
  const loadingCastMediaRef = useRef('');
  const remoteCastPositionRef = useRef(0);
  const wasCastingRef = useRef(false);
  const appliedPersistedLocalVideoRef = useRef(false);

  // Custom hooks for player settings
  const {
    showControls,
    setShowControls,
    showSettings,
    setShowSettings,
    activeTab,
    setActiveTab,
    resizeMode,
    playbackRate,
    selectPlaybackRate,
    isPlayerLocked,
    showUnlockButton,
    toastMessage,
    showToast,
    setToast,
    isTextVisible,
    isFullScreen,
    // setIsFullScreen,
    handleResizeMode,
    togglePlayerLock,
    toggleFullScreen,
    handleLockedScreenTap,
    unlockButtonTimerRef,
  } = usePlayerSettings();

  // Shared values for animations
  const loadingOpacity = useSharedValue(1);
  const loadingScale = useSharedValue(1);
  const lockButtonTranslateY = useSharedValue(-150);
  const lockButtonOpacity = useSharedValue(0);
  const textVisibility = useSharedValue(0);
  const speedIconOpacity = useSharedValue(1);
  const {
    topStyle: controlsTopStyle,
    bottomStyle: controlsStyle,
    opacityStyle: controlsOpacityStyle,
    animations: sharedControlAnimations,
  } = usePlayerControlAnimations(showControls, 350);
  const useSharedControlAnimations = useCallback(
    () => sharedControlAnimations,
    [sharedControlAnimations],
  );
  const toastOpacity = useSharedValue(0);
  const sidebarTranslateX = useSharedValue(400);
  const sidebarBackdropOpacity = useSharedValue(0);

  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState(false);
  const episodeListRef = useRef<FlatList>(null);
  const showEpisodeSidebarSetting = settingsStorage.showPlayerEpisodeSidebar();
  const hasMultipleEpisodes = useMemo(
    () =>
      Array.isArray(route.params?.episodeList) &&
      route.params.episodeList.length > 1 &&
      route.params?.type !== 'movie',
    [route.params?.episodeList, route.params?.type],
  );

  const loadingContainerStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
    transform: [{scale: loadingScale.value}],
  }));

  const LockAnimatedView = isPlayerLocked ? Animated.View : NativeAnimated.View;
  const lockButtonStyle = useAnimatedStyle(() => ({
    transform: [{translateY: lockButtonTranslateY.value}],
    opacity: lockButtonOpacity.value,
  }));

  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const sidebarDrawerStyle = useAnimatedStyle(() => ({
    transform: [{translateX: sidebarTranslateX.value}],
  }));

  const sidebarBackdropStyle = useAnimatedStyle(() => ({
    opacity: sidebarBackdropOpacity.value,
  }));

  // Active episode state
  const [activeEpisode, setActiveEpisode] = useState(
    route.params?.episodeList?.[route.params.linkIndex],
  );

  // Search subtitles state
  const [searchQuery, setSearchQuery] = useState('');

  const continueWatchingId = route.params.infoUrl || activeEpisode?.link;
  const activeEpisodeKey = useMemo(
    () =>
      getLocalVideoAssociationKey({
        episode: activeEpisode,
        provider: route.params.providerValue || provider.value,
        infoUrl: continueWatchingId,
      }),
    [
      activeEpisode,
      continueWatchingId,
      provider.value,
      route.params.providerValue,
    ],
  );
  const localVideoForEpisode = activeEpisodeKey
    ? localVideoAssociations[activeEpisodeKey]
    : undefined;

  // Per-episode choice made on the "play a local file?" prompt.
  //  - pending: waiting for the user, nothing is fetched yet
  //  - local:   a device file is (or will be) playing, online streams stay
  //             unloaded until the Server tab or an error needs them
  //  - online:  stream list is fetched from the provider as before
  const [localDecisions, setLocalDecisions] = useState<
    Record<string, 'local' | 'online'>
  >({});
  const skipLocalPrompt = useMemo(
    () =>
      isTV ||
      !settingsStorage.isAskLocalFileFirst() ||
      Boolean((route.params as any)?.alwaysCast) ||
      settingsStorage.isAlwaysCastMode() ||
      Boolean(getCompletedDownloadPathSync(activeEpisode, route.params)),
    [activeEpisode, route.params],
  );
  const localDecision: 'pending' | 'local' | 'online' =
    (activeEpisodeKey ? localDecisions[activeEpisodeKey] : undefined) ??
    (localVideoForEpisode?.uri
      ? 'local'
      : skipLocalPrompt || !activeEpisodeKey
        ? 'online'
        : 'pending');
  const localDecisionRef = useRef(localDecision);
  localDecisionRef.current = localDecision;
  const activeEpisodeKeyRef = useRef(activeEpisodeKey);
  activeEpisodeKeyRef.current = activeEpisodeKey;
  const markStreamsOnline = useCallback(() => {
    const key = activeEpisodeKeyRef.current;
    if (key) {
      setLocalDecisions(prev =>
        prev[key] === 'online' ? prev : {...prev, [key]: 'online'},
      );
    }
  }, []);

  // Custom hooks for stream management
  const {
    streamData,
    selectedStream,
    setSelectedStream,
    externalSubs,
    setExternalSubs,
    isLoading: streamLoading,
    error: streamError,
    switchToNextStream,
  } = useStream({
    activeEpisode,
    routeParams: route.params,
    provider: provider.value,
    enabled: localDecision === 'online',
  });

  // Custom hooks for video settings
  const {
    audioTracks,
    textTracks,
    videoTracks,
    loadedVideoSize,
    selectedAudioTrackIndex,
    selectedTextTrackIndex,
    selectedQualityIndex,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    setTextTracks,
    processAudioTracks,
    processVideoTracks,
    handleVideoLoad,
    resetVideoTracks,
  } = useVideoSettings();
  const isFullScreenRef = useRef(isFullScreen);
  const syncedContinueWatching = useMemo(
    () => continueWatchingItems.find(item => item.id === continueWatchingId),
    [continueWatchingId, continueWatchingItems],
  );
  const syncedEpisodeMatches =
    Boolean(syncedContinueWatching) &&
    getEpisodeIdentity(syncedContinueWatching?.episode) ===
      getEpisodeIdentity(activeEpisode);
  const syncedPosition = syncedEpisodeMatches
    ? syncedContinueWatching?.position || 0
    : 0;
  const syncedDuration = syncedEpisodeMatches
    ? syncedContinueWatching?.duration || 0
    : 0;
  const syncedUpdatedAt = syncedEpisodeMatches
    ? syncedContinueWatching?.updatedAt || 0
    : 0;

  useEffect(() => {
    if (
      !syncReady ||
      !continueWatchingId ||
      !route.params.infoUrl ||
      !route.params.primaryTitle ||
      !route.params.providerValue ||
      !activeEpisode?.link
    ) {
      return;
    }
    const cachedProgress = readCachedProgress(activeEpisode.link);
    const position = syncedEpisodeMatches
      ? syncedPosition
      : cachedProgress.position;
    const duration = syncedEpisodeMatches
      ? syncedDuration
      : cachedProgress.duration;
    upsertContinueWatching({
      id: continueWatchingId,
      title: route.params.primaryTitle,
      episodeTitle: activeEpisode.title || route.params.secondaryTitle,
      seasonTitle: route.params.secondaryTitle,
      episode: activeEpisode,
      type: route.params.type,
      poster: route.params.poster?.poster,
      background: route.params.poster?.background,
      providerValue: route.params.providerValue,
      infoUrl: route.params.infoUrl,
      position,
      duration,
      updatedAt: syncedUpdatedAt || (position > 0 ? Date.now() : 0),
    });
  }, [
    activeEpisode,
    continueWatchingId,
    route.params.infoUrl,
    route.params.poster?.background,
    route.params.poster?.poster,
    route.params.primaryTitle,
    route.params.providerValue,
    route.params.secondaryTitle,
    route.params.type,
    syncReady,
    syncedDuration,
    syncedEpisodeMatches,
    syncedPosition,
    syncedUpdatedAt,
    upsertContinueWatching,
  ]);

  const saveContinueWatchingProgress = useCallback(
    (position: number, duration: number) => {
      if (continueWatchingId) {
        updateContinueWatchingProgress(
          continueWatchingId,
          position,
          duration,
          activeEpisode,
        );
      }
    },
    [activeEpisode, continueWatchingId, updateContinueWatchingProgress],
  );

  // currentPlaybackTime is render state. The video reports progress every
  // second, but this screen is large, so the state only changes when a value
  // rendered from it changes (skip button, Next button) or while the TV
  // timeline is visible. playbackTimeRef always holds the latest position.
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const playbackTimeRef = useRef(0);
  const playbackRenderKeyRef = useRef('');
  const combinedSkipsRef = useRef<SkipInterval[]>([]);
  const liveTimelineRef = useRef(false);
  const [settingsCloseFocused, setSettingsCloseFocused] = useState(false);
  const timelineRef = useRef<View>(null);
  const [timelineFocusHandle, setTimelineFocusHandle] = useState<number | null>(
    null,
  );
  const playPauseTVRef = useRef<View>(null);
  const [playPauseTVHandle, setPlayPauseTVHandle] = useState<number | null>(
    null,
  );
  const videoSurfaceTVRef = useRef<View>(null);
  const preferredMenuRowRef = useRef<View>(null);

  useEffect(() => {
    if (!isTV || !showSettings) return;
    const timer = setTimeout(() => {
      const handle = findNodeHandle(preferredMenuRowRef.current);
      if (handle)
        UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
    }, 400);
    return () => clearTimeout(timer);
  }, [
    showSettings,
    activeTab,
    audioTracks.length,
    textTracks.length,
    videoTracks.length,
  ]);

  useEffect(() => {
    if (
      !isTV ||
      showControls ||
      showSettings ||
      showEpisodeSidebar ||
      streamLoading ||
      isPlayerLocked
    )
      return;
    const timer = setTimeout(() => {
      const handle = findNodeHandle(videoSurfaceTVRef.current);
      if (handle)
        UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
    }, 100);
    return () => clearTimeout(timer);
  }, [
    showControls,
    showSettings,
    showEpisodeSidebar,
    streamLoading,
    isPlayerLocked,
  ]);

  const {videoPositionRef, handleProgress, flushProgress, hasProgressRef} =
    usePlayerProgress({
      activeEpisode,
      onProgressSaved: saveContinueWatchingProgress,
    });

  const [isPaused, setIsPaused] = useState(false);
  const [autoNextVisible, setAutoNextVisible] = useState(false);
  const [showSleepTimer] = useState(() => settingsStorage.showSleepTimer());
  const {
    sleepTimer,
    sleepMinutesLeft,
    selectSleepOption,
    checkSleepTimer,
    consumeEpisodeEnd,
  } = useSleepTimer(reason => {
    if (reason === 'deadline') {
      setAutoNextVisible(false);
      if (isCasting) remotePlaybackManager.pause().catch(() => {});
      else if (isTV) setIsPaused(true);
      else playerRef.current?.pause();
    }
    setToast(
      reason === 'episode'
        ? 'Sleep timer: stopped at end of episode'
        : 'Sleep timer: playback paused',
      3000,
    );
  });
  const handleTogglePlayPause = useCallback(() => {
    if (isTV) {
      setIsPaused(prev => !prev);
      return;
    }
    if (playPauseRef.current?.props?.onPress) {
      playPauseRef.current.props.onPress();
    } else {
      setIsPaused(prev => !prev);
    }
  }, []);

  const handleSeekNotification = useCallback(
    (text: string) => setToast(text, 1500),
    [setToast],
  );

  const {
    getTVFocusProps,
    tvFocusedControl,
    showTVControls,
    scrubPosition,
    confirmScrub,
    cancelScrub,
    hideTVControls,
  } = usePlayerTVControls({
    playerRef,
    videoPositionRef,
    showSettings,
    setShowSettings,
    showControls,
    setShowControls,
    showEpisodeSidebar,
    setShowEpisodeSidebar,
    primaryColor: primary,
    onTogglePlayPause: handleTogglePlayPause,
    onSeekNotification: handleSeekNotification,
    remoteSuspended: autoNextVisible,
  });

  const handleProgressWithTime = useCallback(
    (e: {currentTime: number; seekableDuration: number}) => {
      handleProgress(e);
      checkSleepTimer();
      playbackTimeRef.current = e.currentTime;
      if (liveTimelineRef.current) {
        setCurrentPlaybackTime(e.currentTime);
        return;
      }
      const renderKey = getPlaybackRenderKey(
        e.currentTime,
        combinedSkipsRef.current,
        videoPositionRef.current.duration,
      );
      if (renderKey !== playbackRenderKeyRef.current) {
        playbackRenderKeyRef.current = renderKey;
        setCurrentPlaybackTime(e.currentTime);
      }
    },
    [handleProgress, videoPositionRef, checkSleepTimer],
  );

  // The TV timeline shows the running time, so it needs every progress tick.
  useEffect(() => {
    liveTimelineRef.current = isTV && showControls;
    if (liveTimelineRef.current) {
      setCurrentPlaybackTime(playbackTimeRef.current);
    }
  }, [showControls]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') flushProgress();
    });
    return () => subscription.remove();
  }, [flushProgress]);

  // Select only the matching download's skip list. Subscribing to all
  // downloads re-rendered the player on every download progress update.
  const matchedDownloadSkip = useDownloadsStore(
    state =>
      findDownloadForEpisode(state.downloads, activeEpisode, selectedStream)
        ?.skip,
  );

  // Combined skip intervals from episode, direct links, stream, downloads, and cache
  const combinedSkips: SkipInterval[] = useMemo(() => {
    const list: SkipInterval[] = [];
    const addSkips = (items?: SkipInterval[]) => {
      if (!items || !Array.isArray(items)) return;
      for (const item of items) {
        if (
          item &&
          typeof item.from === 'number' &&
          typeof item.to === 'number' &&
          item.to > item.from &&
          item.from >= 0
        ) {
          const exists = list.some(
            s =>
              Math.abs(s.from - item.from) < 1 && Math.abs(s.to - item.to) < 1,
          );
          if (!exists) {
            list.push({
              title: item.title || 'Intro',
              from: item.from,
              to: item.to,
            });
          }
        }
      }
    };

    addSkips(activeEpisode?.skip);
    addSkips((activeEpisode as any)?.skips);
    addSkips(selectedStream?.skip);
    addSkips((selectedStream as any)?.skips);

    const rawLinkList = (route.params as any)?.linkList;
    if (Array.isArray(rawLinkList)) {
      for (const linkGroup of rawLinkList) {
        if (Array.isArray(linkGroup?.directLinks)) {
          const match = linkGroup.directLinks.find(
            (d: any) => d?.link === activeEpisode?.link,
          );
          if (match) {
            addSkips(match.skip);
          }
        }
      }
    }

    // Check downloadsStore for matching download item with skip intervals
    if (matchedDownloadSkip) {
      addSkips(matchedDownloadSkip);
    }

    // Check cacheStorage if no skips found yet
    if (list.length === 0) {
      const episodeKey = getEpisodeIdentity(activeEpisode);
      const cached = getCachedSkips([
        activeEpisode?.link,
        activeEpisode?.sourceLink,
        activeEpisodeKey,
        episodeKey ? `${continueWatchingId}:${episodeKey}` : undefined,
      ]);
      addSkips(cached);
    }

    const sorted = list.sort((a, b) => a.from - b.from);

    // Save to cache for future offline / download playback if skips exist
    if (sorted.length > 0) {
      const episodeKey = getEpisodeIdentity(activeEpisode);
      cacheSkips(
        [
          activeEpisode?.link,
          activeEpisode?.sourceLink,
          activeEpisodeKey,
          episodeKey ? `${continueWatchingId}:${episodeKey}` : undefined,
        ],
        sorted,
      );
    }

    return sorted;
  }, [
    activeEpisode,
    activeEpisodeKey,
    continueWatchingId,
    matchedDownloadSkip,
    selectedStream,
    (route.params as any)?.linkList,
  ]);

  // New skip intervals change what the current position renders.
  useEffect(() => {
    combinedSkipsRef.current = combinedSkips;
    playbackRenderKeyRef.current = getPlaybackRenderKey(
      playbackTimeRef.current,
      combinedSkips,
      videoPositionRef.current.duration,
    );
    setCurrentPlaybackTime(playbackTimeRef.current);
  }, [combinedSkips, videoPositionRef]);

  // Currently active skip interval based on playback position
  const activeSkip = useMemo(() => {
    if (!combinedSkips || combinedSkips.length === 0) return null;
    return (
      combinedSkips.find(
        s => currentPlaybackTime >= s.from && currentPlaybackTime < s.to,
      ) || null
    );
  }, [combinedSkips, currentPlaybackTime]);

  const handleSkip = useCallback(() => {
    if (!activeSkip) return;
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    playerRef.current?.seek(activeSkip.to);
    playbackTimeRef.current = activeSkip.to;
    setCurrentPlaybackTime(activeSkip.to);
  }, [activeSkip]);

  // Memoized values
  const playbacks = PLAYBACK_SPEEDS;
  const hideSeekButtons = useMemo(
    () => settingsStorage.hideSeekButtons() || false,
    [],
  );

  const enableSwipeGesture = useMemo(
    () => settingsStorage.isSwipeGestureEnabled(),
    [],
  );
  const forwardBufferMB = useMemo(
    () => settingsStorage.getForwardBufferMB(),
    [],
  );
  // Sent again before the video loads, in case the setting changed since startup.
  useMemo(() => syncParallelStreaming(), []);
  const backBufferMB = useMemo(() => settingsStorage.getBackBufferMB(), []);
  const showMediaControls = useMemo(
    () => settingsStorage.showMediaControls(),
    [],
  );

  // Memoized watched duration
  const watchedDuration = useMemo(() => {
    if (syncedEpisodeMatches) {
      return getResumePosition(syncedPosition, syncedDuration);
    }
    const cachedProgress = readCachedProgress(activeEpisode?.link);
    return getResumePosition(cachedProgress.position, cachedProgress.duration);
  }, [
    activeEpisode?.link,
    syncedDuration,
    syncedEpisodeMatches,
    syncedPosition,
  ]);

  useEffect(() => {
    hasSetInitialAudioRef.current = false;
    hasSetInitialTextRef.current = false;
    resumeAppliedRef.current = false;
    videoLoadedRef.current = false;
    appliedPersistedLocalVideoRef.current = false;
    remoteCastPositionRef.current = 0;
  }, [activeEpisode?.id, activeEpisode?.link, activeEpisode?.sourceLink]);

  // Auto-resume a remembered local video file for this episode (e.g. when
  // opening this title again from Continue Watching) instead of forcing the
  // user to pick the file again. Only applied once per episode so it never
  // fights a manual server switch made later in the same session. Looked up
  // directly by the current episode's identity, so it can never carry over
  // a different episode's file.
  useEffect(() => {
    if (appliedPersistedLocalVideoRef.current) {
      return;
    }
    if (!localVideoForEpisode?.uri) {
      return;
    }
    appliedPersistedLocalVideoRef.current = true;
    setSelectedStream({
      server: 'Local Video',
      link: localVideoForEpisode.uri,
      type: 'local',
    });
  }, [localVideoForEpisode, setSelectedStream]);

  useEffect(() => {
    if (
      videoLoadedRef.current &&
      !resumeAppliedRef.current &&
      watchedDuration > 5 &&
      videoPositionRef.current.position < 5
    ) {
      playerRef.current?.seek(watchedDuration);
      resumeAppliedRef.current = true;
    }
  }, [videoPositionRef, watchedDuration]);

  // A server switch continues from the live position, not the saved one.
  const {getStartPosition, markStreamLoaded} = useStreamResumePosition({
    episodeKey: getEpisodeIdentity(activeEpisode),
    stream: selectedStream,
    savedPosition: watchedDuration,
    videoPositionRef,
  });

  // Selected tracks, reset to the defaults whenever the stream changes
  const {
    selectedAudioTrack,
    setSelectedAudioTrack,
    selectedTextTrack,
    setSelectedTextTrack,
    selectedVideoTrack,
    setSelectedVideoTrack,
  } = useStreamTrackSelections(selectedStream);

  // Sync fixes for the current video. Each source can be off by a different
  // amount, so both reset when the stream changes.
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  useEffect(() => {
    setSubtitleDelayMs(0);
    setAudioDelayMs(0);
  }, [selectedStream.link]);

  const [processedStreamUrl, setProcessedStreamUrl] = useState<string>('');
  // Resume point handed to the player with a torrent source, fixed per stream so
  // progress updates never reload it. Starting there skips buffering the opening
  // seconds, which on a torrent means downloading pieces that are then skipped.
  const [torrentStartMs, setTorrentStartMs] = useState<number | undefined>();
  const canCastStream = useMemo(
    () =>
      !Platform.isTV &&
      isCastableStreamUrl(processedStreamUrl, selectedStream?.type),
    [processedStreamUrl, selectedStream?.type],
  );
  const isLocalOrDownloadedStream = useMemo(
    () =>
      selectedStream?.type === 'local' ||
      selectedStream?.server === 'Downloaded' ||
      Boolean(selectedStream?.link && isLocalPath(selectedStream.link)),
    [selectedStream?.link, selectedStream?.server, selectedStream?.type],
  );
  const connectedRemoteDevice = useRemoteStore(state => state.connectedDevice);
  const isRemoteActive =
    !Platform.isTV &&
    (Boolean(remoteMediaClient) ||
      Boolean(connectedRemoteDevice) ||
      castRequested ||
      Boolean((route.params as any)?.alwaysCast) ||
      settingsStorage.isAlwaysCastMode());
  const isCasting =
    !Platform.isTV && (Boolean(remoteMediaClient) || isRemoteActive);
  const isRemoteActiveRef = useRef(isRemoteActive);
  isRemoteActiveRef.current = isRemoteActive;

  useEffect(() => {
    if (Platform.isTV) return;
    (navigation as any).setOptions({
      orientation: isRemoteActive ? 'portrait' : 'landscape',
      statusBarHidden: !isRemoteActive,
      navigationBarHidden: !isRemoteActive,
      autoHideHomeIndicator: !isRemoteActive,
    });
    if (isRemoteActive) {
      Orientation.lockToPortrait();
      exitFullScreen();
    } else {
      Orientation.lockToLandscape();
      goFullScreen();
    }
  }, [isRemoteActive, navigation]);
  const [isResolvingStream, setIsResolvingStream] = useState(false);
  const progressIntervalRef = useRef<any>(null);
  const [torrentState, setTorrentState] = useState<string>('');
  const [torrentDownloaded, setTorrentDownloaded] = useState<number>(0);
  const [torrentDownloadSpeed, setTorrentDownloadSpeed] = useState<number>(0);
  const findVideoFileIndex = async (infoHash: string): Promise<number> => {
    const files = await torrentManager.getFiles(infoHash);
    if (!files || files.length === 0) {
      throw new Error('No files found in torrent');
    }

    const videoExts = [
      '.mp4',
      '.mkv',
      '.avi',
      '.webm',
      '.mov',
      '.ts',
      '.flv',
      '.wmv',
      '.m4v',
    ];
    let bestIndex = 0;
    let bestSize = 0;
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (videoExts.some(ext => name.endsWith(ext)) && f.size > bestSize) {
        bestIndex = f.index;
        bestSize = f.size;
      }
    }
    return bestIndex;
  };

  const activeTorrentRef = useRef<string | null>(null);

  // Download progress for the cast screen, which has no torrent overlay.
  const torrentCastDetail = useMemo(() => {
    const isTorrent =
      selectedStream?.type === 'torrent' ||
      Boolean(selectedStream?.link?.startsWith('magnet:'));
    if (!isTorrent || !torrentState) return null;
    if (torrentState === 'Fetching Metadata...')
      return 'Fetching torrent info…';
    if (torrentState === 'seeding' || torrentState === 'finished') {
      // Without full download, 'finished' only means the buffer is filled.
      return settingsStorage.isTorrentFullDownload()
        ? 'Torrent fully downloaded'
        : `${torrentDownloaded.toFixed(1)} MB downloaded · buffer full`;
    }
    const speed =
      torrentDownloadSpeed > 0
        ? ` · ${(torrentDownloadSpeed / 1024 / 1024).toFixed(1)} MB/s`
        : '';
    return `${torrentDownloaded.toFixed(1)} MB downloaded${speed}`;
  }, [
    selectedStream?.link,
    selectedStream?.type,
    torrentDownloaded,
    torrentDownloadSpeed,
    torrentState,
  ]);

  // Handle torrent proxy resolution
  useEffect(() => {
    let isMounted = true;

    const cleanupPreviousTorrent = async () => {
      const prevHash = activeTorrentRef.current;
      if (prevHash) {
        activeTorrentRef.current = null;
        try {
          await torrentManager.deleteTorrent(prevHash, true);
        } catch {}
      }
    };

    const resolveStream = async () => {
      if (!selectedStream?.link) {
        setProcessedStreamUrl('');
        setIsResolvingStream(false);
        return;
      }

      setProcessedStreamUrl('');
      setTorrentStartMs(undefined);
      setIsResolvingStream(true);

      if (isTorrentStream(selectedStream)) {
        try {
          if (isDummyTorrentLink(selectedStream.link)) {
            console.warn(
              'Ignoring empty or dummy torrent hash:',
              selectedStream.link,
            );
            if (!switchToNextStream()) {
              setIsResolvingStream(false);
              ToastAndroid.show('Failed to load torrent', ToastAndroid.SHORT);
            }
            return;
          }
          console.log('Adding torrent link:', selectedStream.link);
          setTorrentState('Fetching Metadata...');
          setTorrentDownloaded(0);
          setTorrentDownloadSpeed(0);
          const resolved = await resolveTorrentStream(selectedStream.link, {
            addTorrent: link => torrentManager.addTorrent(link),
            deleteTorrent: hash => torrentManager.deleteTorrent(hash, true),
            findVideoFileIndex,
            prepareVideoFile: (hash, fileIndex) =>
              torrentManager.prepareVideoFile(
                hash,
                fileIndex,
                getStartPosition() > 0,
                settingsStorage.isTorrentFullDownload(),
              ),
            getStreamUrl: (hash, fileIndex) =>
              torrentManager.getStreamUrl(hash, fileIndex),
            onAdded: infoHash => {
              activeTorrentRef.current = infoHash;

              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
              }
              progressIntervalRef.current = setInterval(async () => {
                try {
                  const stats = await torrentManager.getStats(infoHash);
                  if (isMounted) {
                    setTorrentState(stats.state || '');
                    setTorrentDownloaded((stats.totalDone || 0) / 1024 / 1024);
                    setTorrentDownloadSpeed(stats.downloadRate || 0);
                  }
                } catch {}
              }, 1000);
            },
            isCancelled: () => !isMounted,
          });

          if (resolved) {
            const {streamUrl, preparation} = resolved;
            console.log('Torrent stream URL:', streamUrl);
            setTorrentStartMs(
              getStartPosition() > 5
                ? Math.floor(getStartPosition() * 1000)
                : undefined,
            );
            setProcessedStreamUrl(streamUrl);
            setIsResolvingStream(false);
            await preparation;
          }
        } catch (error) {
          console.error('Failed to start torrent stream:', error);
          if (isMounted) {
            setIsResolvingStream(false);
            if (!switchToNextStream()) {
              ToastAndroid.show('Failed to load torrent', ToastAndroid.SHORT);
            }
          }
        }
      } else {
        setProcessedStreamUrl(selectedStream.link);
        setIsResolvingStream(false);
      }
    };

    cleanupPreviousTorrent().then(() => {
      if (isMounted) resolveStream();
    });

    return () => {
      isMounted = false;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      const hash = activeTorrentRef.current;
      if (hash) {
        activeTorrentRef.current = null;
        // A receiver still streaming this torrent keeps it until casting stops.
        if (remotePlaybackManager.adoptTorrent(hash)) return;
        try {
          torrentManager.deleteTorrent(hash, true);
        } catch (e) {
          console.warn('Failed to delete active torrent on unmount', e);
        }
      }
    };
  }, [selectedStream]);

  // Memoized format quality function
  const formatQuality = useCallback((quality: string) => {
    if (quality === 'auto') {
      return quality;
    }
    const num = Number(quality);
    if (num > 1080) {
      return '4K';
    }
    if (num > 720) {
      return '1080p';
    }
    if (num > 480) {
      return '720p';
    }
    if (num > 360) {
      return '480p';
    }
    if (num > 240) {
      return '360p';
    }
    if (num > 144) {
      return '240p';
    }
    return quality;
  }, []);

  const selectedPlayerQuality = useMemo(() => {
    // On adaptive bitrate there is no explicit choice, so fall back to the track
    // the player reports as active, then to the decoded size from onLoad.
    const activeTrack = videoTracks?.find((track: any) => track.selected);
    const selectedTrack =
      videoTracks?.length === 1
        ? videoTracks[0]
        : (videoTracks?.[selectedQualityIndex] ?? activeTrack);
    const selectedTrackHeight =
      Number(selectedTrack?.height) || Number(loadedVideoSize?.height) || 0;
    const quality =
      (selectedTrackHeight > 0 ? selectedTrackHeight.toString() : undefined) ||
      selectedStream?.quality ||
      'auto';

    if (selectedStream?.type === 'local') {
      return {icon: 'video-settings' as const, label: 'Local'};
    }

    return {
      icon: getQualityIconName(selectedTrackHeight, selectedStream?.quality),
      label: formatQuality(quality),
    };
  }, [
    formatQuality,
    loadedVideoSize?.height,
    selectedQualityIndex,
    selectedStream?.quality,
    selectedStream?.type,
    videoTracks,
  ]);

  // Memoized next episode handler
  const handleNextEpisode = useCallback(() => {
    if (!route.params?.episodeList?.length || !activeEpisode) {
      ToastAndroid.show('No more episodes', ToastAndroid.SHORT);
      return;
    }
    const currentIndex = route.params.episodeList.findIndex(
      ep =>
        (activeEpisode?.id && ep?.id && activeEpisode.id === ep.id) ||
        (activeEpisode?.link && ep?.link && activeEpisode.link === ep.link) ||
        (activeEpisode?.sourceLink &&
          ep?.sourceLink &&
          activeEpisode.sourceLink === ep.sourceLink) ||
        activeEpisode === ep,
    );
    if (
      currentIndex >= 0 &&
      currentIndex < route.params.episodeList.length - 1
    ) {
      const nextEpisode = route.params.episodeList[currentIndex + 1];
      // Binge-watching online: don't re-ask on every next episode.
      if (localDecisionRef.current === 'online') {
        const nextKey = getLocalVideoAssociationKey({
          episode: nextEpisode,
          provider: route.params.providerValue || provider.value,
          infoUrl: continueWatchingId,
        });
        if (nextKey) {
          setLocalDecisions(prev => ({...prev, [nextKey]: 'online'}));
        }
      }
      setActiveEpisode(nextEpisode);
      hasSetInitialAudioRef.current = false;
      hasSetInitialTextRef.current = false;
      setShowControls(true);
    } else {
      ToastAndroid.show('No more episodes', ToastAndroid.SHORT);
    }
  }, [
    activeEpisode,
    continueWatchingId,
    provider.value,
    route.params?.episodeList,
    route.params?.providerValue,
  ]);

  const currentEpisodeIndex = useMemo(() => {
    if (!route.params?.episodeList?.length || !activeEpisode) return -1;
    return route.params.episodeList.findIndex(
      ep =>
        (activeEpisode?.id && ep?.id && activeEpisode.id === ep.id) ||
        (activeEpisode?.link && ep?.link && activeEpisode.link === ep.link) ||
        (activeEpisode?.sourceLink &&
          ep?.sourceLink &&
          activeEpisode.sourceLink === ep.sourceLink) ||
        activeEpisode === ep,
    );
  }, [activeEpisode, route.params?.episodeList]);

  const hasNextEpisode = useMemo(() => {
    return (
      currentEpisodeIndex >= 0 &&
      currentEpisodeIndex < (route.params?.episodeList?.length || 0) - 1
    );
  }, [currentEpisodeIndex, route.params?.episodeList]);

  const handleVideoEnd = useCallback(() => {
    if (consumeEpisodeEnd()) return;
    const allowed = shouldAutoPlayNext({
      enabled: settingsStorage.isAutoPlayNextEpisodeEnabled(),
      hasNext: hasNextEpisode,
      isCasting,
      isMovie: route.params?.type === 'movie',
    });
    if (allowed) setAutoNextVisible(true);
  }, [hasNextEpisode, isCasting, route.params?.type, consumeEpisodeEnd]);

  // Going back in the video means the viewer is not done with it yet.
  const handleVideoSeek = useCallback(
    (e: {currentTime: number; seekTime: number}) => {
      const target = e.seekTime ?? e.currentTime;
      if (isSeekAwayFromEnd(target, videoPositionRef.current.duration)) {
        setAutoNextVisible(false);
      }
    },
    [videoPositionRef],
  );

  useEffect(() => setAutoNextVisible(false), [activeEpisode]);

  // Memoized error handler
  const selectedStreamRef = useRef(selectedStream);
  selectedStreamRef.current = selectedStream;
  const streamDataRef = useRef(streamData);
  streamDataRef.current = streamData;

  const handleVideoError = useCallback(
    (e: any) => {
      console.log('PlayerError', e);

      if (selectedStreamRef.current?.type === 'local') {
        if (activeEpisodeKey) {
          clearLocalVideoAssociation(activeEpisodeKey);
        }
        appliedPersistedLocalVideoRef.current = true;
        ToastAndroid.show(
          'Local video not found. Trying online sources...',
          ToastAndroid.SHORT,
        );
        markStreamsOnline();
        const sd = streamDataRef.current;
        setSelectedStream(
          sd && sd.length > 0 ? sd[0] : {server: '', link: '', type: ''},
        );
        setShowControls(true);
        return;
      }

      if (!switchToNextStream()) {
        ToastAndroid.show(
          'Video could not be played, try again later',
          ToastAndroid.SHORT,
        );
        navigation.goBack();
      }
      setShowControls(true);
    },
    [
      activeEpisodeKey,
      clearLocalVideoAssociation,
      markStreamsOnline,
      navigation,
      setSelectedStream,
      setShowControls,
      switchToNextStream,
    ],
  );

  // Playing a device file skips the stream fetch. Opening the Server tab is the
  // moment the user wants alternatives, so load them then.
  useEffect(() => {
    if (localDecision === 'local' && showSettings && activeTab === 'server') {
      markStreamsOnline();
    }
  }, [activeTab, localDecision, markStreamsOnline, showSettings]);

  const handleSelectLocalVideo = useCallback(async (): Promise<boolean> => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'video/*',
          'video/mp4',
          'video/x-matroska',
          'video/quicktime',
          'video/x-msvideo',
          'video/webm',
          'video/x-m4v',
        ],
        multiple: false,

        copyToCacheDirectory: false,
      });

      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        setSelectedStream({
          server: 'Local Video',
          link: asset.uri,
          type: 'local',
        });
        setShowSettings(false);
        // Answering the pre-stream prompt with a file: keep online streams
        // unloaded. If streams are already loading/loaded, leave them be.
        const decisionKey = activeEpisodeKeyRef.current;
        if (decisionKey && localDecisionRef.current === 'pending') {
          setLocalDecisions(prev => ({...prev, [decisionKey]: 'local'}));
        }
        // Remember this file against the current episode so reopening it
        // later (e.g. from Continue Watching) resumes it automatically
        // instead of prompting the picker again.
        appliedPersistedLocalVideoRef.current = true;
        if (activeEpisodeKey) {
          setLocalVideoAssociation(
            activeEpisodeKey,
            asset.uri,
            asset.name || undefined,
            continueWatchingId,
          );
        }

        const persisted = await takePersistableUriPermission(asset.uri);

        ToastAndroid.show(
          persisted
            ? `Playing local file: ${asset.name || 'video'}`
            : `Playing local file: ${asset.name || 'video'} (may need to be re-selected after closing the app)`,
          ToastAndroid.LONG,
        );
        return true;
      }
    } catch (err) {
      console.log(err);
      ToastAndroid.show('Could not open the selected file', ToastAndroid.SHORT);
    }
    return false;
  }, [
    activeEpisodeKey,
    continueWatchingId,
    setLocalVideoAssociation,
    setSelectedStream,
    setShowSettings,
  ]);

  useEffect(() => {
    if (isTV || !remoteMediaClient) {
      return;
    }

    const subProgress = remoteMediaClient.onMediaProgressUpdated(
      (progress, duration) => {
        if (
          remotePlaybackManager.isEnding() ||
          remotePlaybackManager.isReloading()
        )
          return;
        const timeline = remotePlaybackManager.mapTimeline(progress, duration);
        if (timeline.duration > 0) {
          useRemoteStore
            .getState()
            .setTimeline(timeline.position, timeline.duration);
        }
      },
      1,
    );

    const subStatus = remoteMediaClient.onMediaStatusUpdated(status =>
      remotePlaybackManager.handleCastStatus(status, selectedStream?.type),
    );

    return () => {
      subProgress.remove();
      subStatus.remove();
    };
  }, [handleProgress, remoteMediaClient, selectedStream?.type]);

  // Cast and DLNA use the same confirmed timeline and persistence as local playback.
  useEffect(() => {
    if (isTV || !isRemoteActive || !processedStreamUrl) return;
    const mediaSuffix = `:${getEpisodeIdentity(activeEpisode)}:${processedStreamUrl}`;
    const unsubscribe = useRemoteStore.subscribe((state, previous) => {
      if (!loadedCastMediaRef.current.endsWith(mediaSuffix)) return;
      if (!state.connectedDevice && previous.connectedDevice) {
        flushProgress();
        return;
      }
      if (state.pendingSeek || state.duration <= 0) return;
      if (
        state.status !== 'playing' &&
        state.status !== 'paused' &&
        state.status !== 'stopped'
      )
        return;
      // A disconnect resets the timeline; retain the final receiver position instead.
      if (!state.connectedDevice) return;
      if (
        state.currentTime === previous.currentTime &&
        state.duration === previous.duration &&
        state.status === previous.status
      )
        return;
      remoteCastPositionRef.current = state.currentTime;
      handleProgressWithTime({
        currentTime: state.currentTime,
        seekableDuration: state.duration,
      });
      if (state.status === 'paused' || state.status === 'stopped')
        flushProgress();
    });
    return () => {
      unsubscribe();
      flushProgress();
    };
  }, [
    activeEpisode,
    processedStreamUrl,
    isRemoteActive,
    handleProgressWithTime,
    flushProgress,
  ]);

  useEffect(() => {
    if (isTV) return;
    if (remoteMediaClient) {
      wasCastingRef.current = true;
      // A newly connected session is a fresh start after any earlier stop.
      remotePlaybackManager.clearEnding();
    }
    // A missing client can mean a suspended connection while the TV still
    // requests our stream. Only a real session-ended event tears delivery down.
  }, [remoteMediaClient]);

  useEffect(() => {
    if (isTV) return;
    const subscription = GoogleCast.getSessionManager().onSessionEnded(() => {
      if (!wasCastingRef.current || remotePlaybackManager.isEnding()) return;
      wasCastingRef.current = false;
      flushProgress();
      loadedCastMediaRef.current = '';
      loadingCastMediaRef.current = '';
      if (useRemoteStore.getState().connectedDevice?.type === 'cast') {
        remotePlaybackManager.stop().catch(() => {});
      }
      const resumePosition = remoteCastPositionRef.current;
      if (resumePosition > 0) playerRef.current?.seek(resumePosition);
      playerRef.current?.resume();
    });
    return () => subscription.remove();
  }, [flushProgress]);

  // Leaving the remote screen ends casting, whichever way the user leaves.
  useEffect(() => {
    if (isTV) return;
    remotePlaybackManager.clearEnding();
    return navigation.addListener('beforeRemove', () => {
      if (!isRemoteActiveRef.current) return;
      flushProgress();
      if (AppState.currentState !== 'active') return;
      loadingCastMediaRef.current = '';
      remotePlaybackManager.stop().catch(() => {});
    });
  }, [navigation, flushProgress]);

  // Synchronize stream data, audio tracks, and subtitles to Remote Store
  useEffect(() => {
    if (Platform.isTV || !isRemoteActive) return;

    // 1. Servers (from streamData provider sources)
    const servers: RemoteServer[] = (streamData || []).map(
      (s: any, idx: number) => {
        const rawTags: string[] = Array.isArray(s.tags)
          ? s.tags
          : typeof s.tag === 'string'
            ? [s.tag]
            : [];
        const tags = rawTags
          .map(t => (typeof t === 'string' ? t.trim() : ''))
          .filter(
            t =>
              Boolean(t) && t.toLowerCase() !== s.quality?.trim().toLowerCase(),
          );
        return {
          id: s.link || String(idx),
          name: s.server || `Server ${idx + 1}`,
          quality: s.quality,
          tags: tags.length > 0 ? tags : undefined,
          link: s.link,
        };
      },
    );
    useRemoteStore.getState().setServers(servers, selectedStream?.link);

    // 2. Quality is a video variant of the selected server, never a server.
    // Only real variants are listed; the receiver path fills them in.

    // 3. Audio tracks (strictly from media source, never fake default 'en')
    const remoteAudio: RemoteAudioTrack[] = (audioTracks || []).map(
      (t: any, idx: number) => {
        const lang = t.language && t.language !== 'und' ? t.language : '';
        const title =
          t.title || (lang ? lang.toUpperCase() : `Audio Track ${idx + 1}`);
        return {
          id: String(t.index ?? idx),
          index: typeof t.index === 'number' ? t.index : idx,
          language: lang || (t.title ? t.title : `Track ${idx + 1}`),
          title: title,
          codec: t.type || t.codec,
          isSelected: selectedAudioTrackIndex === idx,
        };
      },
    );

    const currentAudio = useRemoteStore.getState().audioTracks;
    if (
      remoteAudio.length > 0 &&
      (currentAudio.length === 0 || remoteAudio.length >= currentAudio.length)
    ) {
      useRemoteStore
        .getState()
        .setAudioTracks(
          remoteAudio,
          remoteAudio[selectedAudioTrackIndex]?.id || remoteAudio[0]?.id,
        );
    }

    // 4. Subtitles (embedded tracks + external + stream subs)
    const allSubs: RemoteSubtitleTrack[] = [];
    (externalSubs || []).forEach((sub: any, i: number) => {
      if (sub?.uri) {
        allSubs.push({
          id: `ext_${i}_${sub.uri}`,
          language: sub.language || 'und',
          title: sub.title || sub.language || `Subtitle ${i + 1}`,
          uri: sub.uri,
          isEmbedded: false,
        });
      }
    });

    if (Array.isArray(selectedStream?.subtitles)) {
      selectedStream.subtitles.forEach((sub: any, i: number) => {
        const uri = sub.url || sub.link;
        if (uri) {
          allSubs.push({
            id: `stream_${i}_${uri}`,
            language: sub.lang || sub.language || 'und',
            title:
              sub.label || sub.title || sub.language || `Subtitle ${i + 1}`,
            uri,
            isEmbedded: false,
          });
        }
      });
    }

    if (Array.isArray(textTracks)) {
      textTracks.forEach((t: any, i: number) => {
        const lang = t.language && t.language !== 'und' ? t.language : '';
        allSubs.push({
          id: `track_${t.index ?? i}`,
          language: lang || 'und',
          title: t.title || (lang ? lang.toUpperCase() : `Track ${i + 1}`),
          isEmbedded: true,
        });
      });
    }

    const currentSubs = useRemoteStore.getState().subtitleTracks;
    if (
      allSubs.length > 0 &&
      (currentSubs.length === 0 || allSubs.length >= currentSubs.length)
    ) {
      const activeSubTrack = allSubs.find(
        (s, idx) => idx === selectedTextTrackIndex,
      );
      useRemoteStore.getState().setSubtitleTracks(allSubs, activeSubTrack?.id);
    }
  }, [
    isRemoteActive,
    streamData,
    selectedStream,
    audioTracks,
    selectedAudioTrackIndex,
    externalSubs,
    textTracks,
    selectedTextTrackIndex,
  ]);

  // Inspect media tracks directly via native module / direct EBML parser when remote player is active
  useEffect(() => {
    if (Platform.isTV || !isRemoteActive || !processedStreamUrl) return;

    let cancelled = false;
    remoteDeliveryService
      .inspectTracks(
        processedStreamUrl,
        Boolean(isLocalOrDownloadedStream),
        selectedStream?.headers,
      )
      .then(inspected => {
        if (cancelled) return;
        if (inspected.audioTracks && inspected.audioTracks.length > 0) {
          useRemoteStore
            .getState()
            .setAudioTracks(
              inspected.audioTracks,
              inspected.audioTracks[0]?.id,
            );
        }
        if (inspected.subtitleTracks && inspected.subtitleTracks.length > 0) {
          useRemoteStore.getState().setSubtitleTracks(inspected.subtitleTracks);
        }
        if (inspected.videoQualities && inspected.videoQualities.length > 0) {
          useRemoteStore
            .getState()
            .setQualities(
              inspected.videoQualities,
              inspected.videoQualities[0]?.id,
            );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    isRemoteActive,
    processedStreamUrl,
    isLocalOrDownloadedStream,
    selectedStream?.headers,
  ]);

  useEffect(() => {
    // stop() resets the store, which re-runs this effect; that must not reload.
    if (
      isTV ||
      !canCastStream ||
      !processedStreamUrl ||
      remotePlaybackManager.isEnding()
    ) {
      return;
    }
    // Wait until the server list has loaded and the chosen stream is resolved;
    // otherwise a stale or placeholder URL gets sent to the receiver.
    if (streamLoading || isResolvingStream || !selectedStream?.link) {
      return;
    }

    // Ensure processedStreamUrl is synchronized with selectedStream.link for non-torrent streams
    if (
      !selectedStream.link.startsWith('magnet:') &&
      selectedStream.type !== 'torrent' &&
      processedStreamUrl !== selectedStream.link
    ) {
      return;
    }

    // DLNA comes from the store; Cast comes from the live session, so switching
    // Cast devices reloads and the placeholder-then-real-id double load cannot happen.
    const targetDevice: RemoteDevice | null =
      connectedRemoteDevice?.type === 'dlna'
        ? connectedRemoteDevice
        : remoteMediaClient && castDevice
          ? {
              id: castDevice.deviceId,
              name: castDevice.friendlyName || 'Cast device',
              type: 'cast',
              model: castDevice.modelName,
            }
          : null;

    if (!targetDevice) {
      return;
    }

    const canonicalStreamUrl = isTorrentStream(selectedStream)
      ? processedStreamUrl
      : selectedStream.link;
    const mediaKey = `${targetDevice.id}:${getEpisodeIdentity(activeEpisode)}:${canonicalStreamUrl}`;
    if (
      loadedCastMediaRef.current === mediaKey ||
      loadingCastMediaRef.current === mediaKey
    ) {
      return;
    }
    loadingCastMediaRef.current = mediaKey;

    let cancelled = false;
    const loadRemoteMedia = async () => {
      try {
        if (targetDevice.type === 'cast' && remoteMediaClient) {
          remotePlaybackManager.initCastClient(remoteMediaClient);
        }

        const remoteSubtitles: RemoteSubtitleTrack[] = [];
        externalSubs.forEach((sub: any, i: number) => {
          if (sub?.uri) {
            remoteSubtitles.push({
              id: `ext_${i}_${sub.uri}`,
              language: sub.language || 'und',
              title: sub.title || sub.language || `Subtitle ${i + 1}`,
              uri: sub.uri,
              isEmbedded: false,
            });
          }
        });
        if (Array.isArray(selectedStream?.subtitles)) {
          selectedStream.subtitles.forEach((sub: any, i: number) => {
            const uri = sub.url || sub.link;
            if (uri) {
              remoteSubtitles.push({
                id: `stream_${i}_${uri}`,
                language: sub.lang || sub.language || 'und',
                title:
                  sub.label || sub.title || sub.language || `Subtitle ${i + 1}`,
                uri,
                isEmbedded: false,
              });
            }
          });
        }
        if (Array.isArray(textTracks)) {
          textTracks.forEach((t: any, i: number) => {
            remoteSubtitles.push({
              id: `track_${t.index ?? i}`,
              language: t.language || 'und',
              title: t.title || t.language || `Track ${i + 1}`,
              isEmbedded: true,
            });
          });
        }

        const remoteAudio: RemoteAudioTrack[] = (audioTracks || []).map(
          (t: any, idx: number) => ({
            id: String(t.index ?? idx),
            index: typeof t.index === 'number' ? t.index : idx,
            language: t.language || 'und',
            title: t.title || t.language || `Audio Track ${idx + 1}`,
            codec: t.type,
            isSelected: selectedAudioTrackIndex === idx,
          }),
        );

        const candidateDuration =
          Number.isFinite(videoPositionRef.current?.duration) &&
          videoPositionRef.current.duration > 0
            ? videoPositionRef.current.duration
            : Number.isFinite(syncedDuration) && syncedDuration > 0
              ? syncedDuration
              : readCachedProgress(activeEpisode?.link).duration > 0
                ? readCachedProgress(activeEpisode?.link).duration
                : undefined;

        await remotePlaybackManager.startRemotePlayback(targetDevice, {
          sourceUrl: processedStreamUrl,
          sourceType: selectedStream?.type,
          isLocal: Boolean(isLocalOrDownloadedStream),
          title: route.params?.primaryTitle || 'Vega Media',
          subtitle: activeEpisode?.title || route.params?.secondaryTitle,
          artwork:
            route.params?.poster?.background || route.params?.poster?.poster,
          headers:
            selectedStream?.headers || selectedStreamRef.current?.headers,
          duration: candidateDuration,
          audioTracks:
            useRemoteStore.getState().audioTracks.length > remoteAudio.length
              ? useRemoteStore.getState().audioTracks
              : remoteAudio,
          subtitles:
            useRemoteStore.getState().subtitleTracks.length >
            remoteSubtitles.length
              ? useRemoteStore.getState().subtitleTracks
              : remoteSubtitles,
          initialPosition: Math.max(
            0,
            hasProgressRef.current
              ? videoPositionRef.current.position
              : Number.isFinite(watchedDuration)
                ? watchedDuration
                : 0,
          ),
        });

        if (loadingCastMediaRef.current === mediaKey) {
          loadedCastMediaRef.current = mediaKey;
          wasCastingRef.current = true;
          playerRef.current?.pause();
          if (!cancelled) setToast(`Playing on ${targetDevice.name}`, 2000);
        }
      } catch (error) {
        if (isRemotePlaybackCanceled(error)) return;
        console.warn('Failed to load media on remote device:', error);
        if (!cancelled && loadingCastMediaRef.current === mediaKey) {
          loadedCastMediaRef.current = '';
          setToast(
            'This stream could not be played on the remote device',
            3000,
          );
        }
      } finally {
        if (loadingCastMediaRef.current === mediaKey)
          loadingCastMediaRef.current = '';
      }
    };

    loadRemoteMedia().catch(e => {
      if (isRemotePlaybackCanceled(e)) return;
      console.warn('Unhandled loadRemoteMedia error:', e);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeEpisode,
    canCastStream,
    castDevice,
    isResolvingStream,
    selectedStream?.link,
    streamLoading,
    connectedRemoteDevice,
    externalSubs,
    isLocalOrDownloadedStream,
    playbackRate,
    processedStreamUrl,
    remoteMediaClient,
    route.params?.poster?.background,
    route.params?.poster?.poster,
    route.params?.primaryTitle,
    route.params?.secondaryTitle,
    selectedStream?.headers,
    selectedStream?.subtitles,
    audioTracks,
    selectedAudioTrackIndex,
    textTracks,
    videoPositionRef,
    watchedDuration,
    setToast,
  ]);

  // Enter landscape or portrait (when remote active) and fullscreen on mount & focus
  useFocusEffect(
    useCallback(() => {
      if (isRemoteActive) {
        Orientation.lockToPortrait();
        exitFullScreen();
        return () => {
          if (!Platform.isTV) {
            Orientation.lockToPortrait();
          } else {
            Orientation.unlockAllOrientations();
          }
        };
      }

      Orientation.lockToLandscape();
      goFullScreen();
      reapplyFullscreenMode(
        isFullScreenRef.current,
        () => !isRemoteActiveRef.current && isFullScreenRef.current,
      );

      return () => {
        if (!Platform.isTV) {
          Orientation.lockToPortrait();
        } else {
          Orientation.unlockAllOrientations();
        }
        exitFullScreen();
      };
    }, [isRemoteActive]),
  );

  useEffect(() => {
    if (isRemoteActive) {
      Orientation.lockToPortrait();
      exitFullScreen();
      return () => {
        if (!Platform.isTV) {
          Orientation.lockToPortrait();
        } else {
          Orientation.unlockAllOrientations();
        }
      };
    }

    Orientation.lockToLandscape();
    goFullScreen();
    return () => {
      if (!Platform.isTV) {
        Orientation.lockToPortrait();
      } else {
        Orientation.unlockAllOrientations();
      }
      exitFullScreen();
    };
  }, [isRemoteActive]);

  useEffect(() => {
    isFullScreenRef.current = isFullScreen;
  }, [isFullScreen]);

  // The portrait remote screen keeps the system bars; only local playback is immersive.
  const applyPlayerSystemBars = useCallback(() => {
    if (isRemoteActiveRef.current) {
      exitFullScreen();
      return;
    }
    reapplyFullscreenMode(
      isFullScreenRef.current,
      () => !isRemoteActiveRef.current && isFullScreenRef.current,
    );
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
          applyPlayerSystemBars();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [isFullScreen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isTV && scrubPosition !== null) {
          cancelScrub();
          return true;
        }
        if (showEpisodeSidebar) {
          setShowEpisodeSidebar(false);
          return true;
        }
        if (showSettings) {
          setShowSettings(false);
          return true;
        }
        if (isTV && showControls) {
          hideTVControls();
          return true;
        }
        exitFullScreen();
        navigation.goBack();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [
    cancelScrub,
    hideTVControls,
    navigation,
    scrubPosition,
    showControls,
    showEpisodeSidebar,
    showSettings,
  ]);

  // Reset track selections when stream changes
  useEffect(() => {
    hasSetInitialAudioRef.current = false;
    hasSetInitialTextRef.current = false;
    setSelectedAudioTrackIndex(0);
    setSelectedTextTrackIndex(1000);
    setSelectedQualityIndex(1000);
    resetVideoTracks();
  }, [
    selectedStream,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    resetVideoTracks,
  ]);

  // Initialize search query
  useEffect(() => {
    setSearchQuery(route.params?.primaryTitle || '');
  }, [route.params?.primaryTitle]);

  // Set last selected audio and subtitle tracks
  useEffect(() => {
    const lastAudioTrack = cacheStorage.getString('lastAudioTrack') || 'auto';
    const lastTextTrack = cacheStorage.getString('lastTextTrack') || 'auto';

    if (!hasSetInitialAudioRef.current && audioTracks.length > 0) {
      hasSetInitialAudioRef.current = true;
      const audioTrackIndex = audioTracks.findIndex(
        track => track.language === lastAudioTrack,
      );
      if (audioTrackIndex !== -1) {
        setSelectedAudioTrack({
          type: SelectedTrackType.INDEX,
          value: audioTrackIndex,
        });
        setSelectedAudioTrackIndex(audioTrackIndex);
      }
    }

    if (!hasSetInitialTextRef.current && textTracks.length > 0) {
      hasSetInitialTextRef.current = true;
      let textTrackIndex = textTracks.findIndex(
        track =>
          track.language === lastTextTrack ||
          track.title === lastTextTrack ||
          track.language?.toLowerCase() === lastTextTrack?.toLowerCase(),
      );

      if (textTrackIndex === -1 && textTracks.length > 0) {
        const downloadedIndex = textTracks.findIndex(
          track =>
            track.title?.includes('(Downloaded)') ||
            track.uri?.startsWith('file://') ||
            track.uri?.startsWith('content://'),
        );
        if (downloadedIndex !== -1) {
          textTrackIndex = downloadedIndex;
        }
      }

      if (textTrackIndex !== -1) {
        setSelectedTextTrack({
          type: SelectedTrackType.INDEX,
          value: textTrackIndex,
        });
        setSelectedTextTrackIndex(textTrackIndex);
      }
    }
  }, [
    textTracks,
    audioTracks,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
  ]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (unlockButtonTimerRef.current) {
        clearTimeout(unlockButtonTimerRef.current);
      }
    };
  }, [unlockButtonTimerRef]);

  // Animation effects
  useEffect(() => {
    // Loading animations
    if (streamLoading || isResolvingStream || !processedStreamUrl) {
      loadingOpacity.value = withTiming(1, {duration: 250});
      loadingScale.value = withTiming(1, {duration: 250});
    }
  }, [isResolvingStream, streamLoading, processedStreamUrl]);

  useEffect(() => {
    // Lock button animations
    const shouldShow =
      (isPlayerLocked && showUnlockButton) || (!isPlayerLocked && showControls);
    lockButtonTranslateY.value = withTiming(shouldShow ? 0 : -150, {
      duration: 250,
    });
    lockButtonOpacity.value = withTiming(shouldShow ? 1 : 0, {
      duration: 250,
    });
  }, [isPlayerLocked, showUnlockButton, showControls]);

  useEffect(() => {
    // 2x speed text visibility
    textVisibility.value = withTiming(isTextVisible ? 1 : 0, {duration: 250});

    // Speed icon blinking animation
    if (isTextVisible) {
      speedIconOpacity.value = withRepeat(
        withSequence(
          withTiming(1, {duration: 250}),
          withTiming(0, {duration: 150}),
          withTiming(1, {duration: 150}),
        ),
        -1,
      );
    } else {
      speedIconOpacity.value = withTiming(1, {duration: 150});
    }
  }, [isTextVisible]);

  useEffect(() => {
    // Toast visibility
    toastOpacity.value = withTiming(showToast ? 1 : 0, {duration: 250});
  }, [showToast]);

  // The settings sheet hides the HUD but only renders in normal playback.
  // Close it when it cannot render, so the HUD never stays hidden.
  useEffect(() => {
    if (showSettings && (isCasting || streamLoading || isPlayerLocked)) {
      setShowSettings(false);
    }
  }, [isCasting, isPlayerLocked, setShowSettings, showSettings, streamLoading]);

  useEffect(() => {
    // Episode sidebar visibility
    sidebarTranslateX.value = withTiming(showEpisodeSidebar ? 0 : 400, {
      duration: 250,
    });
    sidebarBackdropOpacity.value = withTiming(showEpisodeSidebar ? 1 : 0, {
      duration: 250,
    });
  }, [showEpisodeSidebar]);

  useEffect(() => {
    if (showEpisodeSidebar && route.params?.episodeList?.length) {
      const activeIdx = route.params.episodeList.findIndex(
        ep =>
          (activeEpisode?.id && ep?.id && activeEpisode.id === ep.id) ||
          (activeEpisode?.link && ep?.link && activeEpisode.link === ep.link) ||
          (activeEpisode?.sourceLink &&
            ep?.sourceLink &&
            activeEpisode.sourceLink === ep.sourceLink) ||
          activeEpisode === ep,
      );
      if (activeIdx >= 0) {
        const timer = setTimeout(() => {
          try {
            episodeListRef.current?.scrollToIndex({
              index: activeIdx,
              animated: true,
              viewPosition: 0.3,
            });
          } catch {
            episodeListRef.current?.scrollToOffset({
              offset: Math.max(0, activeIdx * 70 - 40),
              animated: true,
            });
          }
        }, 120);
        return () => clearTimeout(timer);
      }
    }
  }, [showEpisodeSidebar, activeEpisode, route.params?.episodeList]);

  useEffect(() => {
    // Handle fullscreen toggle
    applyPlayerSystemBars();
  }, [applyPlayerSystemBars, isFullScreen, isRemoteActive]);

  const handleShowControls = useCallback(() => {
    if (!isTV) setShowControls(true);
  }, [setShowControls]);
  const handleHideControls = useCallback(() => {
    if (!isTV) setShowControls(false);
  }, [setShowControls]);
  const handleAudioTracks = useCallback(
    (e: any) => {
      if (e?.audioTracks) processAudioTracks(e.audioTracks);
    },
    [processAudioTracks],
  );
  const selectedTextTrackIndexRef = useRef(selectedTextTrackIndex);
  selectedTextTrackIndexRef.current = selectedTextTrackIndex;

  const handleTextTracks = useCallback(
    (e: any) => {
      const tracks = e?.textTracks || [];
      setTextTracks(tracks);
      if (selectedTextTrackIndexRef.current === 1000 && tracks.length > 0) {
        const downloadedTrack = tracks.find(
          (t: any) =>
            t.title?.toLowerCase().includes('downloaded') ||
            t.title?.toLowerCase().includes('local'),
        );
        if (downloadedTrack) {
          setSelectedTextTrack({
            type: SelectedTrackType.INDEX,
            value: String(downloadedTrack.index),
          });
          setSelectedTextTrackIndex(downloadedTrack.index);
        }
      }
    },
    [setTextTracks, setSelectedTextTrackIndex],
  );
  const handleVideoTracks = useCallback(
    (e: any) => {
      if (e?.videoTracks) processVideoTracks(e.videoTracks);
    },
    [processVideoTracks],
  );
  const handleSeekSnap = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
  }, []);

  const handleVideoLoadCallback = useCallback(
    (e: any) => {
      handleVideoLoad(e?.naturalSize);
      // ExoPlayer drops a video track this device cannot decode (for example
      // 10-bit HEVC) and plays the audio over a black screen. It reports a
      // 0x0 size in that case; tell the user instead of showing black video.
      if (
        Platform.OS === 'android' &&
        e?.naturalSize &&
        !e.naturalSize.width &&
        !e.naturalSize.height
      ) {
        ToastAndroid.show(
          "This device can't play this video format. Try another server.",
          ToastAndroid.LONG,
        );
      }
      if (e?.videoTracks && e.videoTracks.length > 0) {
        processVideoTracks(e.videoTracks);
      }
      if (e?.audioTracks && e.audioTracks.length > 0) {
        processAudioTracks(e.audioTracks);
      }
      if (e?.textTracks && e.textTracks.length > 0) {
        setTextTracks(e.textTracks);
      }
      videoLoadedRef.current = true;
      const torrentHash = activeTorrentRef.current;
      if (torrentHash && Number(e?.duration) > 0) {
        torrentManager
          .setStreamDuration(torrentHash, Number(e.duration))
          .catch(() => {});
      }
      const wd = getStartPosition();
      markStreamLoaded();
      // A source opened at its start position is already there.
      const loadedAt = Number(e?.currentTime) || 0;
      if (wd > 5 && Math.abs(loadedAt - wd) > 2) {
        playerRef.current?.seek(wd);
        resumeAppliedRef.current = true;
      }
      playerRef?.current?.resume();
    },
    [
      handleVideoLoad,
      processVideoTracks,
      processAudioTracks,
      setTextTracks,
      getStartPosition,
      markStreamLoaded,
    ],
  );

  // Memoized video player props
  const videoPlayerProps = useMemo(
    () => ({
      disableGesture: isPlayerLocked || !enableSwipeGesture,
      doubleTapTime: 200,
      disableSeekButtons: isPlayerLocked || hideSeekButtons,
      showControls,
      showOnStart: showControls,
      // TV visibility and its idle timer are owned by usePlayerTVControls.
      alwaysShowControls: isTV,
      source: {
        textTracks: externalSubs,
        uri:
          (isTorrentStream(selectedStream)
            ? processedStreamUrl
            : selectedStream.link) || '',
        startPosition: torrentStartMs,
        bufferConfig: {
          // Sizes decide how much is buffered (patched native load control);
          // the long time limits only stop low-bitrate video buffering forever.
          minBufferMs: 8000,
          maxBufferMs: 10 * 60 * 1000,
          bufferForPlaybackMs: 1500,
          bufferForPlaybackAfterRebufferMs: 3000,
          backBufferDurationMs: backBufferMB > 0 ? 10 * 60 * 1000 : 0,
          forwardBufferMB,
          backBufferMB,
          maxHeapAllocationPercent: 0.18,
          minBufferMemoryReservePercent: 0.2,
          minBackBufferMemoryReservePercent: 0.25,
          cacheSizeMB: 0,
        },
        shouldCache: true,
        ...(selectedStream?.type === 'm3u8' && {type: 'm3u8'}),
        ...(selectedStream?.type === 'mpd' && {type: 'mpd'}),
        headers: selectedStream?.headers,
        metadata: {
          title: route.params?.primaryTitle,
          subtitle: activeEpisode?.title,
          artist: activeEpisode?.title,
          description: activeEpisode?.title,
          imageUri: route.params?.poster?.poster,
        },
      },
      onProgress: handleProgressWithTime,
      skips: combinedSkips,
      onLoad: handleVideoLoadCallback,
      videoRef: playerRef,
      rate: playbackRate,
      subtitleDelayMs,
      audioDelayMs,
      subtitleStyle: {
        fontSize: settingsStorage.getSubtitleFontSize() ?? 16,
        opacity: settingsStorage.getSubtitleOpacity() ?? 1,
        paddingBottom: settingsStorage.getSubtitleBottomPadding() ?? 10,
        textColor: withAlpha(
          settingsStorage.getSubtitleTextColor(),
          settingsStorage.getSubtitleTextOpacity(),
        ),
        fontFamily: settingsStorage.getSubtitleFontFamily(),
        edgeType: settingsStorage.getSubtitleEdgeType(),
        edgeColor: withAlpha(
          settingsStorage.getSubtitleEdgeColor(),
          settingsStorage.getSubtitleTextOpacity(),
        ),
        outlineWidth: settingsStorage.getSubtitleOutlineWidth() ?? 2,
        subtitlesFollowVideo: false,
      },
      title: {
        primary:
          route.params?.primaryTitle && route.params?.primaryTitle?.length > 70
            ? route.params?.primaryTitle.slice(0, 70) + '...'
            : route.params?.primaryTitle || '',
        secondary: activeEpisode?.title,
      },
      navigator: navigation,
      seekColor: primary,
      showDuration: true,
      toggleResizeModeOnFullscreen: false,
      fullscreenOrientation: 'landscape' as const,
      fullscreenAutorotate: true,
      onShowControls: handleShowControls,
      onHideControls: handleHideControls,
      rewindTime: settingsStorage.getSeekInterval(),
      isFullscreen: true,
      disableFullscreen: true,
      disableVolume: true,
      showHours: true,
      progressUpdateInterval: 1000,
      bufferingStrategy: BufferingStrategyType.DEPENDING_ON_MEMORY,
      showNotificationControls: showMediaControls,
      // debug: {enable: true, thread: false},
      onError: handleVideoError,
      resizeMode,
      selectedAudioTrack,
      onAudioTracks: handleAudioTracks,
      selectedTextTrack,
      onTextTracks: handleTextTracks,
      onVideoTracks: handleVideoTracks,
      selectedVideoTrack,
      style: {flex: 1, zIndex: 100},
      controlAnimationTiming: 350,
      useAnimations: useSharedControlAnimations,
      controlTimeoutDelay: 10000,
      hideAllControlls:
        isTV || isPlayerLocked || showSettings || showEpisodeSidebar,
      onSeekSnap: handleSeekSnap,
      onEnd: handleVideoEnd,
      onSeek: handleVideoSeek,
      ...(isTV
        ? {
            paused: isPaused,
          }
        : {}),
    }),
    [
      isPlayerLocked,
      showSettings,
      showEpisodeSidebar,
      externalSubs,
      selectedStream.link,
      selectedStream.type,
      selectedStream.headers,
      activeEpisode?.title,
      handleProgressWithTime,
      combinedSkips,
      handleVideoLoadCallback,
      playbackRate,
      subtitleDelayMs,
      audioDelayMs,
      primary,
      navigation,
      handleShowControls,
      handleHideControls,
      isPaused,
      showMediaControls,
      handleVideoError,
      resizeMode,
      selectedAudioTrack,
      handleAudioTracks,
      selectedTextTrack,
      handleTextTracks,
      handleVideoTracks,
      selectedVideoTrack,
      handleSeekSnap,
      handleVideoEnd,
      handleVideoSeek,
      processedStreamUrl,
      torrentStartMs,
      enableSwipeGesture,
      hideSeekButtons,
      showControls,
      useSharedControlAnimations,
      forwardBufferMB,
      backBufferMB,
    ],
  );

  // Ask for a local file before touching the network.
  if (localDecision === 'pending') {
    return (
      <SafeAreaView
        edges={{right: 'off', top: 'off', left: 'off', bottom: 'off'}}
        className="bg-black flex-1 justify-center items-center">
        <SystemBars hidden={true} />
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        {/* Same back arrow as the main player's top-left control */}
        <SafeAreaView
          style={{position: 'absolute', top: 0, left: 0, padding: 8}}>
          <Back
            showControls={true}
            onBack={() => {
              exitFullScreen();
              navigation.goBack();
            }}
          />
        </SafeAreaView>
        <View className="w-full max-w-md px-6 items-center">
          <MaterialIcons name="folder-open" size={44} color={primary} />
          <Text className="text-white text-xl font-bold mt-3 text-center">
            Play a file from this device?
          </Text>
          <Text
            className="text-white/70 text-sm mt-1 mb-6 text-center"
            numberOfLines={2}>
            {activeEpisode?.title || route.params?.primaryTitle}
          </Text>
          <Pressable
            onPress={handleSelectLocalVideo}
            android_ripple={{color: 'rgba(255,255,255,0.2)'}}
            style={{
              backgroundColor: primary,
              borderRadius: 24,
              paddingHorizontal: 24,
              paddingVertical: 12,
              width: '100%',
              alignItems: 'center',
            }}>
            <Text className="text-black font-bold text-base">
              Choose local file
            </Text>
          </Pressable>
          <Pressable
            onPress={markStreamsOnline}
            android_ripple={{color: 'rgba(255,255,255,0.2)'}}
            style={{
              borderColor: 'rgba(255,255,255,0.4)',
              borderWidth: 1,
              borderRadius: 24,
              paddingHorizontal: 24,
              paddingVertical: 12,
              width: '100%',
              alignItems: 'center',
              marginTop: 12,
            }}>
            <Text className="text-white font-semibold text-base">
              No, stream online
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Show loading state
  if (
    streamLoading &&
    !isRemoteActive &&
    !isCasting &&
    !isLocalOrDownloadedStream
  ) {
    return (
      <SafeAreaView
        edges={{right: 'off', top: 'off', left: 'off', bottom: 'off'}}
        className="bg-black flex-1 justify-center items-center">
        <SystemBars hidden={true} />
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        {/* create ripple effect */}
        <TouchableNativeFeedback
          background={TouchableNativeFeedback.Ripple(
            'rgba(255,255,255,0.15)',
            false, // ripple shows at tap location
          )}>
          <View className="w-full h-full justify-center items-center">
            <Animated.View
              style={[loadingContainerStyle]}
              className="justify-center items-center">
              <View className="mb-2">
                <AnimatedHourglass sandColor={hourglassSandColor} />
              </View>
              <Text className="text-white text-lg mt-4">Loading stream...</Text>
            </Animated.View>
          </View>
        </TouchableNativeFeedback>
      </SafeAreaView>
    );
  }

  // Show error state
  if (
    streamError &&
    !isRemoteActive &&
    !isCasting &&
    !isLocalOrDownloadedStream
  ) {
    return (
      <SafeAreaView className="bg-black flex-1 justify-center items-center">
        <SystemBars hidden={true} />
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        <Text className="text-red-500 text-lg text-center mb-4">
          Failed to load stream. Please try again.
        </Text>
        <TVFocusable
          hasTVPreferredFocus={true}
          focusBorderColor="#ffffff"
          focusScale={1.08}
          borderRadius={12}
          style={{
            backgroundColor: '#DC2626',
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
          onPress={() => {
            exitFullScreen();
            navigation.goBack();
          }}>
          <Text style={{color: '#ffffff', fontWeight: 'bold', fontSize: 16}}>
            Go Back
          </Text>
        </TVFocusable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={{
        right: 'off',
        top: 'off',
        left: 'off',
        bottom: 'off',
      }}
      className="bg-black flex-1 relative">
      <SystemBars hidden={!isRemoteActive && isFullScreen} />
      <StatusBar translucent={true} hidden={!isRemoteActive} />
      {isRemoteActive ? (
        <OrientationLocker orientation={PORTRAIT} />
      ) : (
        <OrientationLocker orientation={LANDSCAPE} />
      )}

      {/* Local or Remote player */}
      {isRemoteActive ? (
        <RemotePlayerScreen
          title={route.params?.primaryTitle}
          subtitle={activeEpisode?.title || route.params?.secondaryTitle}
          poster={route.params?.poster?.poster}
          backdrop={route.params?.poster?.background}
          onBack={() => {
            // Opened from the cast button with nothing connected: back returns to
            // the local player instead of leaving.
            if (
              castRequested &&
              !connectedRemoteDevice &&
              !remoteMediaClient &&
              !(route.params as any)?.alwaysCast &&
              !settingsStorage.isAlwaysCastMode()
            ) {
              setCastRequested(false);
              return;
            }
            navigation.goBack();
          }}
          preparingText={
            streamLoading
              ? 'Finding servers…'
              : isResolvingStream
                ? 'Preparing stream…'
                : null
          }
          detailText={torrentCastDetail}
          episodes={route.params?.episodeList}
          activeEpisodeIndex={
            currentEpisodeIndex >= 0 ? currentEpisodeIndex : undefined
          }
          onSelectEpisode={index => {
            const ep = route.params?.episodeList?.[index];
            if (ep && ep !== activeEpisode) {
              setActiveEpisode(ep);
              hasSetInitialAudioRef.current = false;
              hasSetInitialTextRef.current = false;
              setShowControls(true);
            }
          }}
          onSelectServer={server => {
            const matchedStream = streamData?.find(
              (s: any) => s.link === server.id || s.link === server.link,
            );
            if (matchedStream) {
              setSelectedStream(matchedStream);
              appliedPersistedLocalVideoRef.current = true;
              if (activeEpisodeKey) {
                clearLocalVideoAssociation(activeEpisodeKey);
              }
            }
          }}
          onSelectAudio={track => {
            remotePlaybackManager
              .switchAudioTrack(track)
              .then(() => {
                setSelectedAudioTrackIndex(track.index);
                setSelectedAudioTrack({
                  type: SelectedTrackType.INDEX,
                  value: String(track.index),
                });
              })
              .catch((error: Error) => {
                if (isRemotePlaybackCanceled(error)) return;
                setToast(error.message || 'Unable to switch audio track', 4000);
              });
          }}
          onSelectSubtitle={sub => {
            remotePlaybackManager
              .setActiveSubtitleTrack(sub?.id)
              .then(() => {
                if (!sub) {
                  setSelectedTextTrackIndex(1000);
                  setSelectedTextTrack({
                    type: SelectedTrackType.INDEX,
                    value: '1000',
                  });
                }
              })
              .catch((error: Error) => {
                if (isRemotePlaybackCanceled(error)) return;
                setToast(
                  error.message || 'Unable to switch subtitle track',
                  4000,
                );
              });
          }}
          onSelectQuality={q => {
            const sourceUrl = /^(https?:|content:|file:|\/)/i.test(q.id)
              ? q.id
              : undefined;
            remotePlaybackManager
              .switchQuality(q, sourceUrl)
              .catch((error: Error) => {
                if (isRemotePlaybackCanceled(error)) return;
                setToast(
                  error.message || 'Unable to change remote quality',
                  4000,
                );
              });
          }}
          skipInterval={activeSkip}
          onSkipPress={handleSkip}
        />
      ) : processedStreamUrl ? (
        <VideoPlayer {...videoPlayerProps} />
      ) : (
        <View className="flex-1 justify-center items-center">
          <Animated.View style={[loadingContainerStyle]}>
            <AnimatedHourglass sandColor={hourglassSandColor} />
          </Animated.View>
          <TouchableOpacity
            className="mt-6 flex-row items-center gap-2 px-4 py-2"
            onPress={() => {
              setActiveTab('server');
              setShowSettings(true);
            }}>
            <MaterialIcons
              name={selectedPlayerQuality.icon}
              size={24}
              color="white"
            />
            <Text className="text-white text-sm capitalize opacity-80">
              {selectedStream?.server || 'Change server'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isTV &&
        !isCasting &&
        !streamLoading &&
        !isPlayerLocked &&
        !showSettings &&
        !showEpisodeSidebar &&
        !autoNextVisible &&
        !showControls && (
          <Pressable
            ref={videoSurfaceTVRef}
            accessibilityRole="button"
            accessibilityLabel="Video. Select to show controls. Left and right skip ten seconds."
            hasTVPreferredFocus
            focusable
            isTVSelectable
            onPress={showTVControls}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 40,
            }}
          />
        )}

      {isTV &&
        !isCasting &&
        !streamLoading &&
        !isPlayerLocked &&
        !showSettings &&
        !showEpisodeSidebar &&
        showControls && (
          <>
            <Pressable
              ref={playPauseTVRef}
              onLayout={() =>
                setPlayPauseTVHandle(findNodeHandle(playPauseTVRef.current))
              }
              nextFocusLeft={playPauseTVHandle ?? undefined}
              nextFocusRight={playPauseTVHandle ?? undefined}
              accessibilityRole="button"
              accessibilityLabel={isPaused ? 'Play video' : 'Pause video'}
              hasTVPreferredFocus
              {...getTVFocusProps('play_pause')}
              onPress={() => setIsPaused(previous => !previous)}
              style={{
                position: 'absolute',
                alignSelf: 'center',
                top: '40%',
                width: 72,
                height: 72,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 40,
                borderWidth: 3,
                borderColor:
                  tvFocusedControl === 'play_pause' ? primary : 'transparent',
                backgroundColor: 'rgba(0,0,0,0.45)',
                zIndex: 65,
              }}>
              <MaterialIcons
                name={isPaused ? 'play-arrow' : 'pause'}
                size={44}
                color="white"
              />
            </Pressable>
            <Pressable
              ref={timelineRef}
              onLayout={() =>
                setTimelineFocusHandle(findNodeHandle(timelineRef.current))
              }
              nextFocusLeft={timelineFocusHandle ?? undefined}
              nextFocusRight={timelineFocusHandle ?? undefined}
              accessibilityRole="adjustable"
              accessibilityLabel="Video timeline. Left and right preview, select seeks, back cancels."
              accessibilityValue={{
                text: `${formatTVTimelineTime(scrubPosition ?? currentPlaybackTime)} of ${videoPositionRef.current.duration > 0 ? formatTVTimelineTime(videoPositionRef.current.duration) : 'unknown duration'}`,
              }}
              {...getTVFocusProps('timeline')}
              onPress={confirmScrub}
              style={{
                position: 'absolute',
                left: '10%',
                right: '10%',
                bottom: 62,
                padding: 12,
                borderRadius: 12,
                borderWidth: 2,
                borderColor:
                  tvFocusedControl === 'timeline' ? primary : 'transparent',
                backgroundColor: 'rgba(20,20,20,0.65)',
                zIndex: 65,
              }}>
              <View
                style={{
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: 'rgba(255,255,255,0.35)',
                }}>
                <View
                  style={{
                    width: `${
                      videoPositionRef.current.duration > 0
                        ? Math.min(
                            100,
                            Math.max(
                              0,
                              (100 * (scrubPosition ?? currentPlaybackTime)) /
                                videoPositionRef.current.duration,
                            ),
                          )
                        : 0
                    }%`,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: primary,
                  }}
                />
              </View>
              <Text style={{color: 'white', marginTop: 6, textAlign: 'center'}}>
                {formatTVTimelineTime(scrubPosition ?? currentPlaybackTime)} /{' '}
                {videoPositionRef.current.duration > 0
                  ? formatTVTimelineTime(videoPositionRef.current.duration)
                  : '--:--'}
                {scrubPosition !== null
                  ? '  •  Select to seek · Back to cancel'
                  : ''}
              </Text>
            </Pressable>
          </>
        )}

      {/* Non-intrusive Torrent Status Overlay */}
      {!isCasting &&
        selectedStream?.type === 'torrent' &&
        !streamLoading &&
        torrentState !== 'seeding' &&
        torrentState !== 'finished' && (
          <NativeAnimated.View
            className="absolute top-4 self-center px-3 py-1.5 rounded-full items-center"
            style={controlsOpacityStyle}
            pointerEvents="none">
            {torrentState !== 'Fetching Metadata...' ? (
              <Text className="text-white/70 text-[10px] mt-0.5">
                {torrentDownloaded > 0
                  ? `${torrentDownloaded.toFixed(1)} MB`
                  : ''}
                {torrentDownloadSpeed > 0
                  ? ` @ ${(torrentDownloadSpeed / 1024 / 1024).toFixed(1)} MB/s`
                  : ''}
              </Text>
            ) : (
              <Text className="text-white/90 text-xs font-medium">
                {torrentState === 'Fetching Metadata...'
                  ? 'Fetching Metadata'
                  : ''}
              </Text>
            )}
          </NativeAnimated.View>
        )}

      {/* Full-screen overlay to detect taps when locked */}
      {!isCasting && isPlayerLocked && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleLockedScreenTap}
          className="absolute top-0 left-0 right-0 bottom-0 z-40 bg-transparent"
        />
      )}

      {/* Lock/Unlock button */}
      {!isCasting && !streamLoading && !Platform.isTV && (
        <LockAnimatedView
          style={
            isPlayerLocked
              ? lockButtonStyle
              : [controlsTopStyle, controlsOpacityStyle]
          }
          className="absolute top-5 right-5 flex-row items-center gap-2 z-50"
          pointerEvents="box-none">
          <TouchableOpacity
            onPress={togglePlayerLock}
            className="p-2 rounded-full">
            <MaterialCommunityIcons
              name={isPlayerLocked ? 'lock-outline' : 'lock-open-outline'}
              color={BOTTOM_CONTROL_ICON_COLOR}
              size={24}
            />
          </TouchableOpacity>
          {SHOW_FULLSCREEN_BUTTON && (
            <TouchableOpacity
              onPress={toggleFullScreen}
              className="opacity-70 p-2 rounded-full">
              <MaterialIcons
                name={isFullScreen ? 'fullscreen-exit' : 'fullscreen'}
                color={'hsl(0, 0%, 70%)'}
                size={24}
              />
            </TouchableOpacity>
          )}
          {!isPlayerLocked && canCastStream && (
            <TouchableOpacity
              onPress={() => {
                flushProgress();
                setCastRequested(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Cast video"
              className="opacity-70 p-2 rounded-full">
              <MaterialCommunityIcons
                name="cast"
                accessibilityLabel="Cast video"
                color="hsl(0, 0%, 70%)"
                size={24}
              />
            </TouchableOpacity>
          )}
        </LockAnimatedView>
      )}

      {/* Bottom controls */}
      {!isCasting &&
        !isPlayerLocked &&
        !showSettings &&
        !showEpisodeSidebar && (
          <NativeAnimated.View
            pointerEvents={showControls ? 'auto' : 'none'}
            style={[controlsStyle, {left: '10%', right: '10%', bottom: 15}]}
            className="absolute flex-row items-center">
            {/* Audio controls */}
            <BottomControlButton
              onPress={() => {
                setActiveTab('audio');
                setShowSettings(!showSettings);
              }}
              {...getTVFocusProps('audio')}
              className="min-w-0 flex-1 flex-row items-center justify-center gap-x-1">
              <MaterialCommunityIcons
                name="waveform"
                size={24}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
              <Text
                className="capitalize text-xs text-white"
                style={BOTTOM_CONTROL_LABEL_STYLE}
                numberOfLines={1}>
                {audioTracks[selectedAudioTrackIndex]?.language || 'auto'}
              </Text>
            </BottomControlButton>

            {/* Subtitle controls */}
            <BottomControlButton
              onPress={() => {
                setActiveTab('subtitle');
                setShowSettings(!showSettings);
              }}
              {...getTVFocusProps('subtitle')}
              className="min-w-0 flex-1 flex-row items-center justify-center gap-x-1">
              <MaterialCommunityIcons
                name="subtitles-outline"
                size={24}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
              <Text
                className="text-xs capitalize text-white"
                style={BOTTOM_CONTROL_LABEL_STYLE}
                numberOfLines={1}>
                {selectedTextTrackIndex === 1000
                  ? 'none'
                  : textTracks[selectedTextTrackIndex]?.language}
              </Text>
            </BottomControlButton>

            {/* Speed controls */}
            <BottomControlButton
              className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
              {...getTVFocusProps('speed')}
              onPress={() => {
                setActiveTab('speed');
                setShowSettings(!showSettings);
              }}>
              <MaterialCommunityIcons
                name="speedometer"
                size={24}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
              <Text
                className="text-white text-sm"
                style={BOTTOM_CONTROL_LABEL_STYLE}>
                {playbackRate === 1 ? '1.0' : playbackRate}x
              </Text>
            </BottomControlButton>

            {/* Sleep timer */}
            {showSleepTimer && (
              <BottomControlButton
                className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
                {...getTVFocusProps('sleep')}
                onPress={() => {
                  setActiveTab('sleep');
                  setShowSettings(!showSettings);
                }}>
                <MaterialCommunityIcons
                  name="power-sleep"
                  size={24}
                  color={
                    sleepTimer.option === 'off'
                      ? BOTTOM_CONTROL_ICON_COLOR
                      : primary
                  }
                />
                <Text
                  className="text-white text-xs"
                  style={BOTTOM_CONTROL_LABEL_STYLE}
                  numberOfLines={1}>
                  {sleepMinutesLeft !== null
                    ? `${sleepMinutesLeft}m`
                    : sleepTimer.option === 'episode'
                      ? 'Ep end'
                      : 'Sleep'}
                </Text>
              </BottomControlButton>
            )}

            {/* PIP */}
            {!Platform.isTV && (
              <TouchableOpacity
                className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
                onPress={() => {
                  playerRef?.current?.enterPictureInPicture();
                }}>
                <MaterialCommunityIcons
                  name="picture-in-picture-bottom-right-outline"
                  size={24}
                  color={BOTTOM_CONTROL_ICON_COLOR}
                />
                <Text
                  className="text-white text-xs"
                  style={BOTTOM_CONTROL_LABEL_STYLE}>
                  PIP
                </Text>
              </TouchableOpacity>
            )}

            {/* Server & Quality */}
            <BottomControlButton
              className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
              {...getTVFocusProps('server')}
              onPress={() => {
                setActiveTab('server');
                setShowSettings(!showSettings);
              }}>
              <MaterialIcons
                name={selectedPlayerQuality.icon}
                size={24}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
              <Text
                className="text-xs text-white capitalize"
                style={BOTTOM_CONTROL_LABEL_STYLE}
                numberOfLines={1}>
                {selectedPlayerQuality.label}
              </Text>
            </BottomControlButton>

            {/* Resize button */}
            <BottomControlButton
              className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
              {...getTVFocusProps('resize')}
              onPress={handleResizeMode}>
              <MaterialCommunityIcons
                name="fit-to-screen-outline"
                size={25}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
              <Text
                className="text-white text-sm min-w-[38px]"
                style={BOTTOM_CONTROL_LABEL_STYLE}
                numberOfLines={1}>
                {resizeMode === ResizeMode.NONE
                  ? 'Fit'
                  : resizeMode === ResizeMode.COVER
                    ? 'Cover'
                    : resizeMode === ResizeMode.STRETCH
                      ? 'Stretch'
                      : 'Contain'}
              </Text>
            </BottomControlButton>

            {/* Episodes button */}
            {hasMultipleEpisodes && showEpisodeSidebarSetting && (
              <BottomControlButton
                className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
                {...getTVFocusProps('episodes')}
                onPress={() => {
                  setShowEpisodeSidebar(true);
                }}>
                <MaterialCommunityIcons
                  name="playlist-play"
                  size={25}
                  color={BOTTOM_CONTROL_ICON_COLOR}
                />
                <Text
                  className="text-white text-xs"
                  style={BOTTOM_CONTROL_LABEL_STYLE}
                  numberOfLines={1}>
                  Episodes
                </Text>
              </BottomControlButton>
            )}

            {/* Next episode button */}
            {hasNextEpisode &&
              (isTV ||
                (videoPositionRef.current.duration > 0 &&
                  currentPlaybackTime / videoPositionRef.current.duration >
                    0.8)) && (
                <BottomControlButton
                  className="min-w-0 flex-1 flex-row items-center justify-center"
                  {...getTVFocusProps('next')}
                  onPress={handleNextEpisode}>
                  <Text
                    className="text-white text-base"
                    style={BOTTOM_CONTROL_LABEL_STYLE}
                    numberOfLines={1}>
                    Next
                  </Text>
                  <MaterialCommunityIcons
                    name="skip-next-outline"
                    size={26}
                    color={BOTTOM_CONTROL_ICON_COLOR}
                  />
                </BottomControlButton>
              )}
          </NativeAnimated.View>
        )}

      {/* Floating Skip Button (Intro/Outro/Recap) */}
      {activeSkip && !isCasting && !streamLoading && !isPlayerLocked && (
        <NativeAnimated.View
          pointerEvents={showControls ? 'auto' : 'none'}
          style={[
            controlsOpacityStyle,
            {
              position: 'absolute',
              bottom: 95,
              right: 28,
              zIndex: 65,
            },
          ]}>
          <SkipButton
            label={
              activeSkip.title
                ? activeSkip.title.toLowerCase().startsWith('skip')
                  ? activeSkip.title
                  : `Skip ${activeSkip.title}`
                : 'Skip Intro'
            }
            focusColor={colors.primary}
            // The button fades out with the controls. On TV it must not
            // stay focusable while invisible.
            focusable={!isTV || showControls}
            onPress={handleSkip}
          />
        </NativeAnimated.View>
      )}

      {autoNextVisible && !isCasting && !streamLoading && (
        <View style={{position: 'absolute', bottom: 95, right: 28, zIndex: 70}}>
          <AutoNextOverlay
            seconds={AUTO_NEXT_COUNTDOWN_SECONDS}
            focusColor={primary}
            onPlayNow={() => {
              setAutoNextVisible(false);
              handleNextEpisode();
            }}
            onCancel={() => setAutoNextVisible(false)}
          />
        </View>
      )}

      {/* Toast message */}
      <Animated.View
        style={[toastStyle]}
        pointerEvents="none"
        className="absolute w-full top-12 justify-center items-center px-2">
        <Text className="text-white bg-black/50 p-2 rounded-full text-base">
          {toastMessage}
        </Text>
      </Animated.View>

      {/* Settings Modal */}
      {!isCasting && !streamLoading && !isPlayerLocked && showSettings && (
        <PlayerSettingsLayer onClose={() => setShowSettings(false)}>
          <TVFocusGuide
            trapFocusLeft
            trapFocusRight
            trapFocusUp
            trapFocusDown
            style={{flex: 1}}>
            <Pressable
              focusable={false}
              isTVSelectable={false}
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.55)',
                justifyContent: 'flex-end',
                alignItems: 'center',
              }}
              onPress={() => setShowSettings(false)}>
              {/* The sheet slides up while the layer behind it fades in. */}
              <AnimatedPressable
                entering={SlideInDown.duration(260)}
                focusable={false}
                isTVSelectable={false}
                style={{
                  padding: 12,
                  width: 640,
                  maxWidth: '92%',
                  height: 330,
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  flexDirection: 'row',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  backgroundColor: 'rgba(13,13,13,0.96)',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderWidth: 1,
                  borderBottomWidth: 0,
                  shadowColor: '#000',
                  shadowOpacity: 0.5,
                  shadowRadius: 24,
                  elevation: 24,
                }}
                onPress={e => e.stopPropagation()}>
                {isTV && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close player settings"
                    focusable
                    isTVSelectable
                    hasTVPreferredFocus={
                      activeTab === 'audio' && audioTracks.length === 0
                    }
                    onPress={() => setShowSettings(false)}
                    onFocus={() => setSettingsCloseFocused(true)}
                    onBlur={() => setSettingsCloseFocused(false)}
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      zIndex: 2,
                      padding: 5,
                      borderWidth: settingsCloseFocused ? 2 : 0,
                      borderColor: primary,
                      borderRadius: 20,
                      backgroundColor: 'transparent',
                    }}>
                    <MaterialIcons name="close" size={22} color="white" />
                  </Pressable>
                )}
                {/* Audio Tab */}
                {activeTab === 'audio' && (
                  <ScrollView className="w-full h-full p-1 px-4">
                    <Text className="mb-2 text-lg font-bold text-center text-white">
                      Audio
                    </Text>
                    <PlayerDelayControl
                      title="Audio delay"
                      icon="av-timer"
                      laterLabel="Sound plays later"
                      earlierLabel="Sound plays earlier"
                      delayMs={audioDelayMs}
                      accentColor={primary}
                      onChange={setAudioDelayMs}
                      onTVFocus={() => setSettingsCloseFocused(false)}
                    />
                    {audioTracks.length === 0 && (
                      <View className="flex justify-center items-center">
                        <Text className="text-white text-xs">
                          Loading audio tracks...
                        </Text>
                      </View>
                    )}
                    {audioTracks.map((track, i) => (
                      <PlayerMenuRow
                        onTVFocus={() => setSettingsCloseFocused(false)}
                        key={i}
                        ref={
                          i ===
                          (selectedAudioTrackIndex >= 0
                            ? selectedAudioTrackIndex
                            : 0)
                            ? preferredMenuRowRef
                            : undefined
                        }
                        title={track.language || `Audio track ${i + 1}`}
                        detail={[track.type, track.title]
                          .filter(Boolean)
                          .join(' · ')}
                        selected={selectedAudioTrackIndex === i}
                        hasTVPreferredFocus={
                          selectedAudioTrackIndex === i ||
                          (selectedAudioTrackIndex < 0 && i === 0)
                        }
                        accentColor={primary}
                        icon="multitrack-audio"
                        onPress={() => {
                          setSelectedAudioTrack({
                            type: SelectedTrackType.LANGUAGE,
                            value: track.language,
                          });
                          cacheStorage.setString(
                            'lastAudioTrack',
                            track.language || '',
                          );
                          setSelectedAudioTrackIndex(i);
                          setShowSettings(false);
                        }}
                      />
                    ))}
                  </ScrollView>
                )}

                {/* Subtitle Tab */}
                {activeTab === 'subtitle' && (
                  <FlashList
                    data={textTracks}
                    ListHeaderComponent={
                      <View>
                        <Text className="mb-2 text-lg font-bold text-center text-white">
                          Subtitle
                        </Text>
                        {selectedTextTrackIndex !== 1000 ? (
                          <PlayerDelayControl
                            title="Subtitle delay"
                            icon="closed-caption"
                            laterLabel="Text shows later"
                            earlierLabel="Text shows earlier"
                            delayMs={subtitleDelayMs}
                            accentColor={primary}
                            onChange={setSubtitleDelayMs}
                            onTVFocus={() => setSettingsCloseFocused(false)}
                          />
                        ) : null}
                        <PlayerMenuRow
                          onTVFocus={() => setSettingsCloseFocused(false)}
                          ref={
                            selectedTextTrackIndex === 1000
                              ? preferredMenuRowRef
                              : undefined
                          }
                          title="Disabled"
                          selected={selectedTextTrackIndex === 1000}
                          hasTVPreferredFocus={selectedTextTrackIndex === 1000}
                          accentColor={primary}
                          icon="subtitles-off"
                          onPress={() => {
                            setSelectedTextTrack({
                              type: SelectedTrackType.DISABLED,
                            });
                            setSelectedTextTrackIndex(1000);
                            cacheStorage.setString('lastTextTrack', '');
                            setShowSettings(false);
                          }}
                        />
                      </View>
                    }
                    ListFooterComponent={
                      <>
                        <PlayerMenuRow
                          onTVFocus={() => setSettingsCloseFocused(false)}
                          title="Add external file"
                          accentColor={primary}
                          icon="add"
                          onPress={async () => {
                            try {
                              const res = await DocumentPicker.getDocumentAsync(
                                {
                                  type: [
                                    'text/vtt',
                                    'application/x-subrip',
                                    'text/srt',
                                    'application/ttml+xml',
                                  ],
                                  multiple: false,
                                },
                              );

                              if (!res.canceled && res.assets?.[0]) {
                                const asset = res.assets[0];
                                let trackType = asset.mimeType as any;
                                const fileName = (
                                  asset.name || ''
                                ).toLowerCase();
                                if (
                                  !trackType ||
                                  trackType === 'application/octet-stream' ||
                                  trackType === 'text/plain'
                                ) {
                                  if (fileName.endsWith('.vtt')) {
                                    trackType = 'text/vtt';
                                  } else if (
                                    fileName.endsWith('.ttml') ||
                                    fileName.endsWith('.xml') ||
                                    fileName.endsWith('.dfxp')
                                  ) {
                                    trackType = 'application/ttml+xml';
                                  } else {
                                    trackType = 'application/x-subrip';
                                  }
                                }

                                const track = {
                                  type: trackType,
                                  title:
                                    asset.name && asset.name.length > 20
                                      ? asset.name.slice(0, 20) + '...'
                                      : asset.name || 'External Subtitle',
                                  language: 'und',
                                  uri: asset.uri,
                                };
                                setExternalSubs((prev: any) => [
                                  track,
                                  ...prev,
                                ]);
                              }
                            } catch (err) {
                              console.log(err);
                            }
                          }}
                        />
                        <SearchSubtitles
                          searchQuery={searchQuery}
                          setSearchQuery={setSearchQuery}
                          onAddSubtitle={track =>
                            setExternalSubs(prev => [track, ...prev])
                          }
                        />
                      </>
                    }
                    renderItem={({item: track}) => (
                      <PlayerMenuRow
                        onTVFocus={() => setSettingsCloseFocused(false)}
                        ref={
                          selectedTextTrackIndex === track.index
                            ? preferredMenuRowRef
                            : undefined
                        }
                        title={track.language || 'Unknown'}
                        detail={[track.type, track.title]
                          .filter(Boolean)
                          .join(' · ')}
                        selected={selectedTextTrackIndex === track.index}
                        hasTVPreferredFocus={
                          selectedTextTrackIndex === track.index
                        }
                        accentColor={primary}
                        icon="subtitles"
                        onPress={() => {
                          setSelectedTextTrack({
                            type: SelectedTrackType.INDEX,
                            value: String(track.index),
                          });
                          setSelectedTextTrackIndex(track.index);
                          cacheStorage.setString(
                            'lastTextTrack',
                            track.language || '',
                          );
                          setShowSettings(false);
                        }}
                      />
                    )}
                  />
                )}

                {/* Server Tab */}
                {activeTab === 'server' && (
                  <View className="flex flex-row w-full h-full p-1 px-4">
                    <ScrollView
                      className="border-r border-white/10"
                      contentContainerStyle={{paddingRight: 8}}>
                      <Text className="mb-2 w-full text-center text-white text-lg font-extrabold">
                        Server
                      </Text>
                      {streamLoading && (
                        <Text className="mb-2 text-center text-xs text-white/70">
                          Loading online servers...
                        </Text>
                      )}
                      {streamData?.length > 0 &&
                        streamData?.map((track, i) => {
                          const rawTags: string[] = Array.isArray(track.tags)
                            ? track.tags
                            : typeof track.tag === 'string'
                              ? [track.tag]
                              : [];
                          const tags = rawTags
                            .map(t => (typeof t === 'string' ? t.trim() : ''))
                            .filter(
                              t =>
                                Boolean(t) &&
                                t.toLowerCase() !==
                                  track.quality?.trim().toLowerCase(),
                            );

                          return (
                            <PlayerMenuRow
                              onTVFocus={() => setSettingsCloseFocused(false)}
                              key={i}
                              ref={
                                track.link === selectedStream.link
                                  ? preferredMenuRowRef
                                  : undefined
                              }
                              title={track.server || `Server ${i + 1}`}
                              quality={track.quality}
                              tags={tags.length > 0 ? tags : undefined}
                              selected={track.link === selectedStream.link}
                              hasTVPreferredFocus={
                                track.link === selectedStream.link
                              }
                              accentColor={primary}
                              icon="dns"
                              onPress={() => {
                                setSelectedStream(track);
                                appliedPersistedLocalVideoRef.current = true;
                                if (activeEpisodeKey) {
                                  clearLocalVideoAssociation(activeEpisodeKey);
                                }
                                setShowSettings(false);
                                playerRef?.current?.resume();
                              }}
                            />
                          );
                        })}

                      {/* Local video option, mirrors the subtitle screen's
                      "Add external file" entry above */}
                      <View className="mt-1 border-t border-white/10 pt-1">
                        <PlayerMenuRow
                          onTVFocus={() => setSettingsCloseFocused(false)}
                          title="Local video"
                          detail="Choose a file from this device"
                          selected={selectedStream?.type === 'local'}
                          accentColor={primary}
                          icon="folder-open"
                          onPress={handleSelectLocalVideo}
                        />
                      </View>
                    </ScrollView>

                    <ScrollView contentContainerStyle={{paddingLeft: 8}}>
                      <Text className="mb-2 w-full text-center text-white text-lg font-extrabold">
                        Quality
                      </Text>

                      {videoTracks.length === 0 && (
                        <View className="flex justify-center items-center">
                          <Text className="text-white text-xs">
                            {loadedVideoSize
                              ? 'No quality options reported for this stream'
                              : 'Loading video tracks...'}
                          </Text>
                        </View>
                      )}

                      {videoTracks.length === 1 && (
                        <View className="flex justify-center items-center">
                          <Text className="text-white text-xs">
                            This stream has a single quality
                          </Text>
                        </View>
                      )}

                      {videoTracks && videoTracks.length > 1 && (
                        <PlayerMenuRow
                          onTVFocus={() => setSettingsCloseFocused(false)}
                          title="Auto"
                          detail="Adaptive bitrate"
                          selected={selectedQualityIndex === 1000}
                          accentColor={primary}
                          icon="video-settings"
                          onPress={() => {
                            setSelectedVideoTrack({
                              type: SelectedVideoTrackType.AUTO,
                              value: '',
                            });
                            setSelectedQualityIndex(1000);
                          }}
                        />
                      )}

                      {videoTracks &&
                        videoTracks.map((track: any, i: any) => {
                          const resolutionTitle = track.height
                            ? `${track.height}p`
                            : track.width
                              ? `${track.width}p`
                              : 'Standard';
                          const bitrateText = track.bitrate
                            ? track.bitrate >= 1000000
                              ? `${(track.bitrate / 1000000).toFixed(1)} Mbps`
                              : `${Math.round(track.bitrate / 1000)} kbps`
                            : undefined;
                          const detailText = [
                            bitrateText,
                            track.width &&
                              track.height &&
                              `${track.width}x${track.height}`,
                            track.codecs && `${track.codecs}`,
                          ]
                            .filter(Boolean)
                            .join(' · ');

                          return (
                            <PlayerMenuRow
                              onTVFocus={() => setSettingsCloseFocused(false)}
                              key={i}
                              title={resolutionTitle}
                              detail={detailText}
                              selected={selectedQualityIndex === i}
                              accentColor={primary}
                              icon={getQualityIconName(track.height)}
                              onPress={() => {
                                if (
                                  typeof track.index === 'number' &&
                                  track.index >= 0
                                ) {
                                  setSelectedVideoTrack({
                                    type: SelectedVideoTrackType.INDEX,
                                    value: String(track.index),
                                  });
                                } else if (track.height) {
                                  setSelectedVideoTrack({
                                    type: SelectedVideoTrackType.RESOLUTION,
                                    value: String(track.height),
                                  });
                                }
                                setSelectedQualityIndex(i);
                              }}
                            />
                          );
                        })}
                    </ScrollView>
                  </View>
                )}

                {/* Speed Tab */}
                {activeTab === 'speed' && (
                  <ScrollView className="w-full h-full p-1 px-4">
                    <Text className="mb-2 text-lg font-bold text-center text-white">
                      Playback Speed
                    </Text>
                    {playbacks.map((rate, i) => (
                      <PlayerMenuRow
                        onTVFocus={() => setSettingsCloseFocused(false)}
                        key={i}
                        ref={
                          playbackRate === rate
                            ? preferredMenuRowRef
                            : undefined
                        }
                        title={`${rate}x`}
                        selected={playbackRate === rate}
                        hasTVPreferredFocus={playbackRate === rate}
                        accentColor={primary}
                        icon="speed"
                        onPress={() => {
                          selectPlaybackRate(rate);
                          setShowSettings(false);
                        }}
                      />
                    ))}
                  </ScrollView>
                )}

                {/* Sleep Tab */}
                {activeTab === 'sleep' && (
                  <ScrollView className="w-full h-full p-1 px-4">
                    <Text className="mb-2 text-lg font-bold text-center text-white">
                      Sleep Timer
                    </Text>
                    {SLEEP_TIMER_OPTIONS.map(option => (
                      <PlayerMenuRow
                        onTVFocus={() => setSettingsCloseFocused(false)}
                        key={String(option)}
                        ref={
                          sleepTimer.option === option
                            ? preferredMenuRowRef
                            : undefined
                        }
                        title={getSleepOptionLabel(option)}
                        detail={
                          sleepTimer.option === option
                            ? formatSleepRemaining(sleepMinutesLeft) ||
                              undefined
                            : undefined
                        }
                        selected={sleepTimer.option === option}
                        hasTVPreferredFocus={sleepTimer.option === option}
                        accentColor={primary}
                        icon="bedtime"
                        onPress={() => {
                          selectSleepOption(option);
                          setShowSettings(false);
                        }}
                      />
                    ))}
                  </ScrollView>
                )}
              </AnimatedPressable>
            </Pressable>
          </TVFocusGuide>
        </PlayerSettingsLayer>
      )}

      {/* Episode Sidebar Drawer */}
      {!isCasting &&
        !streamLoading &&
        !isPlayerLocked &&
        hasMultipleEpisodes && (
          <>
            {/* Backdrop */}
            <Animated.View
              style={[
                sidebarBackdropStyle,
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  zIndex: 90,
                },
              ]}
              pointerEvents={showEpisodeSidebar ? 'auto' : 'none'}
              onTouchEnd={() => setShowEpisodeSidebar(false)}
            />

            {/* Drawer Container */}
            <Animated.View
              style={[
                sidebarDrawerStyle,
                {
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 360,
                  maxWidth: '80%',
                  backgroundColor: 'rgba(14, 14, 14, 0.96)',
                  borderLeftWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  zIndex: 100,
                  elevation: 24,
                  shadowColor: '#000',
                  shadowOpacity: 0.5,
                  shadowRadius: 20,
                },
              ]}
              pointerEvents={showEpisodeSidebar ? 'auto' : 'none'}>
              <TVFocusGuide
                key={showEpisodeSidebar ? 'episode-open' : 'episode-closed'}
                autoFocus={showEpisodeSidebar}
                trapFocusLeft={showEpisodeSidebar}
                trapFocusRight={showEpisodeSidebar}
                trapFocusUp={showEpisodeSidebar}
                trapFocusDown={showEpisodeSidebar}
                style={{flex: 1}}>
                {/* Header */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
                  }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                    <MaterialCommunityIcons
                      name="playlist-play"
                      size={24}
                      color={primary}
                    />
                    <Text
                      style={{
                        color: '#FFFFFF',
                        fontSize: 16,
                        fontWeight: '700',
                      }}>
                      Episodes
                    </Text>
                    <View
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.12)',
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 12,
                      }}>
                      <Text
                        style={{
                          color: 'rgba(255, 255, 255, 0.7)',
                          fontSize: 12,
                          fontWeight: '600',
                        }}>
                        {route.params?.episodeList?.length || 0}
                      </Text>
                    </View>
                  </View>
                  {isTV ? (
                    <TVFocusable
                      accessibilityRole="button"
                      accessibilityLabel="Close episodes"
                      disabled={!showEpisodeSidebar}
                      onPress={() => setShowEpisodeSidebar(false)}
                      focusScale={1}
                      borderRadius={20}
                      style={{
                        padding: 8,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      }}>
                      <MaterialIcons name="close" size={20} color="#FFFFFF" />
                    </TVFocusable>
                  ) : (
                    <Pressable
                      onPress={() => setShowEpisodeSidebar(false)}
                      hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                      style={{
                        padding: 4,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      }}>
                      <MaterialIcons name="close" size={20} color="#FFFFFF" />
                    </Pressable>
                  )}
                </View>

                {/* Episode List */}
                <FlatList
                  ref={episodeListRef}
                  data={route.params?.episodeList || []}
                  keyExtractor={(item, index) =>
                    item?.id || item?.link || item?.sourceLink || String(index)
                  }
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  contentContainerStyle={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                  }}
                  getItemLayout={(_data, index) => ({
                    length: 70,
                    offset: 70 * index,
                    index,
                  })}
                  renderItem={({item: ep, index}) => {
                    const isActive =
                      (activeEpisode?.id &&
                        ep?.id &&
                        activeEpisode.id === ep.id) ||
                      (activeEpisode?.link &&
                        ep?.link &&
                        activeEpisode.link === ep.link) ||
                      (activeEpisode?.sourceLink &&
                        ep?.sourceLink &&
                        activeEpisode.sourceLink === ep.sourceLink) ||
                      activeEpisode === ep;
                    const epNum = index + 1;
                    const epTitle = ep?.title || `Episode ${epNum}`;
                    const epDesc = ep?.description?.trim();
                    const rawImage =
                      ep?.image || ep?.poster || (ep as any)?.still_path;
                    const imageUri = getValidImageUri(rawImage);

                    return (
                      <SidebarEpisodeRow
                        episode={ep}
                        index={index}
                        title={epTitle}
                        description={epDesc}
                        imageUri={imageUri}
                        isActive={isActive}
                        isFocusable={showEpisodeSidebar}
                        primaryColor={primary}
                        onSelect={() => {
                          if (!isActive) {
                            setActiveEpisode(ep);
                            hasSetInitialAudioRef.current = false;
                            hasSetInitialTextRef.current = false;
                            setShowControls(true);
                          }
                          setShowEpisodeSidebar(false);
                        }}
                      />
                    );
                  }}
                />
              </TVFocusGuide>
            </Animated.View>
          </>
        )}
    </SafeAreaView>
  );
};

// The pill is styled on an inner View driven by plain state, so its shape
// does not depend on a Pressable style function being applied.
const SkipButton = ({
  label,
  focusColor,
  focusable,
  onPress,
}: {
  label: string;
  focusColor: string;
  focusable: boolean;
  onPress: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      focusable={focusable}
      isTVSelectable={focusable}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          backgroundColor:
            !isTV && focused ? focusColor : 'rgba(20, 20, 20, 0.55)',
          borderColor: focused ? '#FFFFFF' : 'rgba(255, 255, 255, 0.28)',
          borderWidth: focused ? 2 : 1,
          borderRadius: 24,
          paddingVertical: 8,
          paddingHorizontal: 16,
          gap: 6,
          transform: [{scale: isTV ? 1 : focused ? 1.08 : pressed ? 0.95 : 1}],
        }}>
        <Text
          numberOfLines={1}
          style={{
            color: 'rgba(255, 255, 255, 0.95)',
            fontWeight: '700',
            fontSize: 13,
            letterSpacing: 0.2,
          }}>
          {label}
        </Text>
        <Feather
          name="chevrons-right"
          size={18}
          color="rgba(255, 255, 255, 0.95)"
        />
      </View>
    </Pressable>
  );
};

export default Player;
