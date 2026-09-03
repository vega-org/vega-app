import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  AppState,
  AppStateStatus,
  BackHandler,
  FlatList,
  Image,
  ScrollView,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  Platform,
  TouchableNativeFeedback,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { cacheStorage, settingsStorage } from '../../lib/storage';
import Orientation, {
  OrientationLocker,
  LANDSCAPE,
} from 'react-native-orientation-locker';
import { SystemBars } from 'react-native-edge-to-edge';
import VideoPlayer from '../../components/media-console';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  VideoRef,
  SelectedVideoTrack,
  SelectedVideoTrackType,
  ResizeMode,
  SelectedTrack,
  SelectedTrackType,
  BufferingStrategyType,
} from 'react-native-video';
import useContentStore from '../../lib/zustand/contentStore';
import { CastButton, useRemoteMediaClient } from 'react-native-google-cast';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { FlashList } from '@shopify/flash-list';
import SearchSubtitles from '../../components/SearchSubtitles';
import { useStream, useVideoSettings } from '../../lib/hooks/useStream';
import {
  usePlayerProgress,
  usePlayerSettings,
} from '../../lib/hooks/usePlayerSettings';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'react-native';
import { torrentManager } from '../../lib/torrentManager';
import { syncFromSharedFolder } from '../../lib/sync/syncService';
import { useM3Colors } from '../../theme/M3PaletteContext';
import useContinueWatchingStore from '../../lib/zustand/continueWatchingStore';
import useLocalVideoStore from '../../lib/zustand/localVideoStore';
import useDownloadsStore from '../../lib/zustand/downloadsStore';
import CastRemotePlayer from '../../components/CastRemotePlayer';
import {
  getEpisodeIdentity,
  getLocalVideoAssociationKey,
} from '../../lib/utils/episodeIdentity';
import { takePersistableUriPermission } from '../../lib/uriPermission';
import AnimatedHourglass from '../../components/AnimatedHourglass';
import PlayerMenuRow from '../../components/PlayerMenuRow';
import { extractImageAccent } from '../../lib/imageAccent';
import { mixHex } from '../../theme/seeds';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { EpisodeLink, SkipInterval } from '../../lib/providers/types';
import { getValidImageUri } from '../../components/EpisodeRowContent';
import { Feather } from '@expo/vector-icons';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const readCachedProgress = (link?: string) => {
  if (!link) {
    return { position: 0, duration: 0 };
  }
  try {
    const cached = cacheStorage.getString(link);
    if (!cached) {
      return { position: 0, duration: 0 };
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
    return { position: 0, duration: 0 };
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

const SHOW_FULLSCREEN_BUTTON = false;
const BOTTOM_CONTROL_ICON_COLOR = 'rgba(255,255,255,0.68)';
const BOTTOM_CONTROL_LABEL_STYLE = {
  color: BOTTOM_CONTROL_ICON_COLOR,
  fontWeight: '300' as const,
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

const isCastableStreamUrl = (streamUrl: string, streamType?: string) => {
  if (!/^https?:\/\//i.test(streamUrl) || streamType === 'torrent') {
    return false;
  }

  try {
    const hostname = new URL(streamUrl).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
  } catch {
    return false;
  }
};

const getCastContentType = (streamUrl: string, streamType?: string) => {
  const normalizedType = streamType?.toLowerCase() || '';
  const normalizedUrl = streamUrl.toLowerCase().split('?')[0];

  if (normalizedType === 'm3u8' || normalizedUrl.endsWith('.m3u8')) {
    return 'application/vnd.apple.mpegurl';
  }
  if (normalizedType === 'dash' || normalizedUrl.endsWith('.mpd')) {
    return 'application/dash+xml';
  }
  if (normalizedType === 'webm' || normalizedUrl.endsWith('.webm')) {
    return 'video/webm';
  }
  if (normalizedType === 'mkv' || normalizedUrl.endsWith('.mkv')) {
    return 'video/x-matroska';
  }
  return 'video/mp4';
};

const goFullScreen = () => {
  SystemBars.setHidden(true);
  if (Platform.OS === 'android') {
    // Sticky-immersive behavior is handled by the system under edge-to-edge;
    NavigationBar.setVisibilityAsync('hidden');
    StatusBar.setHidden(true, 'slide');
  }
};

const exitFullScreen = () => {
  SystemBars.setHidden(false);
  if (Platform.OS === 'android') {
    // Show the navigation bar
    NavigationBar.setVisibilityAsync('visible');
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

const reapplyFullscreenMode = (isFullScreenEnabled: boolean) => {
  applyFullscreenMode(isFullScreenEnabled);

  if (Platform.OS === 'android' && isFullScreenEnabled) {
    setTimeout(() => {
      applyFullscreenMode(true);
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
  primaryColor: string;
  onSelect: () => void;
};

const SidebarEpisodeRow = React.memo<SidebarEpisodeRowProps>(
  ({ index, title, description, imageUri, isActive, primaryColor, onSelect }) => {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
      setImageFailed(false);
    }, [imageUri]);

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
              source={{ uri: imageUri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
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

        {/* Info */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
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
      </TouchableOpacity>
    );
  },
);

const Player = ({ route }: Props): React.JSX.Element => {
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
  const { provider } = useContentStore();
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
  const remoteMediaClient = useRemoteMediaClient();
  const hasSetInitialAudioRef = useRef(false);
  const hasSetInitialTextRef = useRef(false);
  const videoLoadedRef = useRef(false);
  const resumeAppliedRef = useRef(false);
  const loadedCastMediaRef = useRef('');
  const remoteCastPositionRef = useRef(0);
  const wasCastingRef = useRef(false);
  const appliedPersistedLocalVideoRef = useRef(false);

  // Shared values for animations
  const loadingOpacity = useSharedValue(0);
  const loadingScale = useSharedValue(0.8);
  const lockButtonTranslateY = useSharedValue(-150);
  const lockButtonOpacity = useSharedValue(0);
  const textVisibility = useSharedValue(0);
  const speedIconOpacity = useSharedValue(1);
  const controlsTranslateY = useSharedValue(150);
  const controlsOpacity = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const settingsTranslateY = useSharedValue(10000);
  const settingsOpacity = useSharedValue(0);
  const sidebarTranslateX = useSharedValue(400);
  const sidebarBackdropOpacity = useSharedValue(0);

  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState(false);
  const episodeListRef = useRef<FlatList>(null);
  const showEpisodeSidebarSetting = useMemo(
    () => settingsStorage.showPlayerEpisodeSidebar(),
    [],
  );
  const hasMultipleEpisodes = useMemo(
    () =>
      Array.isArray(route.params?.episodeList) &&
      route.params.episodeList.length > 1 &&
      route.params?.type !== 'movie',
    [route.params?.episodeList, route.params?.type],
  );

  const loadingContainerStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
    transform: [{ scale: loadingScale.value }],
  }));

  const lockButtonStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lockButtonTranslateY.value }],
    opacity: lockButtonOpacity.value,
  }));

  const controlsStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: controlsTranslateY.value }],
    opacity: controlsOpacity.value,
  }));

  const controlsOpacityStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const settingsStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settingsTranslateY.value }],

    opacity: settingsOpacity.value,
  }));

  const sidebarDrawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sidebarTranslateX.value }],
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
    setPlaybackRate,
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
  const isFullScreenRef = useRef(isFullScreen);
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
        updateContinueWatchingProgress(continueWatchingId, position, duration);
      }
    },
    [continueWatchingId, updateContinueWatchingProgress],
  );

  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);

  const { videoPositionRef, handleProgress } = usePlayerProgress({
    activeEpisode,
    onProgressSaved: saveContinueWatchingProgress,
  });

  const handleProgressWithTime = useCallback(
    (e: { currentTime: number; seekableDuration: number }) => {
      handleProgress(e);
      setCurrentPlaybackTime(e.currentTime);
    },
    [handleProgress],
  );

  const downloads = useDownloadsStore(state => state.downloads);

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
              Math.abs(s.from - item.from) < 1 &&
              Math.abs(s.to - item.to) < 1,
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
    const allDownloadsList = Object.values(downloads);
    const matchedDownload = allDownloadsList.find(
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
          (d.filePath === selectedStream.link ||
            d.url === selectedStream.link)),
    );
    if (matchedDownload?.skip) {
      addSkips(matchedDownload.skip);
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
    downloads,
    selectedStream,
    (route.params as any)?.linkList,
  ]);

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
    setCurrentPlaybackTime(activeSkip.to);
  }, [activeSkip]);

  // Memoized values
  const playbacks = useMemo(
    () => [0.25, 0.5, 1.0, 1.25, 1.35, 1.5, 1.75, 2],
    [],
  );
  const hideSeekButtons = useMemo(
    () => settingsStorage.hideSeekButtons() || false,
    [],
  );

  const enableSwipeGesture = useMemo(
    () => settingsStorage.isSwipeGestureEnabled(),
    [],
  );
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

  // Memoized selected tracks
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<SelectedTrack>({
    type: SelectedTrackType.INDEX,
    value: 0,
  });

  const [selectedTextTrack, setSelectedTextTrack] = useState<SelectedTrack>({
    type: SelectedTrackType.DISABLED,
  });

  const [selectedVideoTrack, setSelectedVideoTrack] =
    useState<SelectedVideoTrack>({
      type: SelectedVideoTrackType.AUTO,
    });

  const [processedStreamUrl, setProcessedStreamUrl] = useState<string>('');
  const canCastStream = useMemo(
    () =>
      !Platform.isTV &&
      isCastableStreamUrl(processedStreamUrl, selectedStream?.type),
    [processedStreamUrl, selectedStream?.type],
  );
  const isCasting = Boolean(remoteMediaClient);
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

  // Handle torrent proxy resolution
  useEffect(() => {
    let isMounted = true;

    const cleanupPreviousTorrent = async () => {
      const prevHash = activeTorrentRef.current;
      if (prevHash) {
        activeTorrentRef.current = null;
        try {
          await torrentManager.deleteTorrent(prevHash, true);
        } catch { }
      }
    };

    const resolveStream = async () => {
      if (!selectedStream?.link) {
        setProcessedStreamUrl('');
        setIsResolvingStream(false);
        return;
      }

      setProcessedStreamUrl('');
      setIsResolvingStream(true);

      const isTorrent =
        selectedStream.type === 'torrent' ||
        selectedStream.link.startsWith('magnet:');
      if (isTorrent) {
        try {
          if (
            !selectedStream.link ||
            selectedStream.link.includes(
              'd41d0cfbf8baa3ce04a7074b0c486243dd5fbd00',
            ) ||
            selectedStream.link.includes('d41d8cd98f00b204e9800998ecf8427e')
          ) {
            console.warn(
              'Ignoring empty or dummy torrent hash:',
              selectedStream.link,
            );
            switchToNextStream();
            return;
          }
          console.log('Adding torrent link:', selectedStream.link);
          setTorrentState('Fetching Metadata...');
          setTorrentDownloaded(0);
          setTorrentDownloadSpeed(0);
          const addData = await torrentManager.addTorrent(selectedStream.link);
          const infoHash = addData.infoHash;
          if (!isMounted) {
            torrentManager.deleteTorrent(infoHash, true).catch(() => { });
            return;
          }
          activeTorrentRef.current = infoHash;

          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
          }
          if (isMounted) {
            progressIntervalRef.current = setInterval(async () => {
              try {
                const stats = await torrentManager.getStats(infoHash);
                if (isMounted) {
                  setTorrentState(stats.state || '');
                  setTorrentDownloaded((stats.totalDone || 0) / 1024 / 1024);
                  setTorrentDownloadSpeed(stats.downloadRate || 0);
                }
              } catch { }
            }, 1000);
          }

          if (isMounted) {
            const videoFileIndex = await findVideoFileIndex(infoHash);
            const preparation = torrentManager.prepareVideoFile(
              infoHash,
              videoFileIndex,
            );
            const streamUrl = await torrentManager.getStreamUrl(
              infoHash,
              videoFileIndex,
            );
            console.log('Torrent stream URL:', streamUrl);
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

    cleanupPreviousTorrent().then(() => resolveStream());

    return () => {
      isMounted = false;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      const hash = activeTorrentRef.current;
      if (hash) {
        activeTorrentRef.current = null;
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
      return { icon: 'video-settings' as const, label: 'Local' };
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
      setActiveEpisode(route.params.episodeList[currentIndex + 1]);
      hasSetInitialAudioRef.current = false;
      hasSetInitialTextRef.current = false;
    } else {
      ToastAndroid.show('No more episodes', ToastAndroid.SHORT);
    }
  }, [activeEpisode, route.params?.episodeList]);

  const hasNextEpisode = useMemo(() => {
    if (!route.params?.episodeList?.length || !activeEpisode) return false;
    const currentIndex = route.params.episodeList.findIndex(
      ep =>
        (activeEpisode?.id && ep?.id && activeEpisode.id === ep.id) ||
        (activeEpisode?.link && ep?.link && activeEpisode.link === ep.link) ||
        (activeEpisode?.sourceLink &&
          ep?.sourceLink &&
          activeEpisode.sourceLink === ep.sourceLink) ||
        activeEpisode === ep,
    );
    return currentIndex >= 0 && currentIndex < route.params.episodeList.length - 1;
  }, [activeEpisode, route.params?.episodeList]);

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
        const sd = streamDataRef.current;
        setSelectedStream(
          sd && sd.length > 0
            ? sd[0]
            : { server: '', link: '', type: '' },
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
      navigation,
      setSelectedStream,
      setShowControls,
      switchToNextStream,
    ],
  );


  const handleSelectLocalVideo = useCallback(async () => {
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
      }
    } catch (err) {
      console.log(err);
      ToastAndroid.show('Could not open the selected file', ToastAndroid.SHORT);
    }
  }, [
    activeEpisodeKey,
    continueWatchingId,
    setLocalVideoAssociation,
    setSelectedStream,
    setShowSettings,
  ]);

  useEffect(() => {
    if (!remoteMediaClient) {
      return;
    }

    const subscription = remoteMediaClient.onMediaProgressUpdated(
      (progress, duration) => {
        remoteCastPositionRef.current = progress;
        if (duration > 0) {
          handleProgress({ currentTime: progress, seekableDuration: duration });
        }
      },
      1,
    );

    return () => subscription.remove();
  }, [handleProgress, remoteMediaClient]);

  useEffect(() => {
    if (remoteMediaClient) {
      wasCastingRef.current = true;
      return;
    }

    if (!wasCastingRef.current) {
      return;
    }

    wasCastingRef.current = false;
    loadedCastMediaRef.current = '';
    const resumePosition = remoteCastPositionRef.current;
    if (resumePosition > 0) {
      playerRef.current?.seek(resumePosition);
    }
    playerRef.current?.resume();
  }, [remoteMediaClient]);

  useEffect(() => {
    if (!remoteMediaClient || !canCastStream || !processedStreamUrl) {
      return;
    }

    const mediaKey = `${getEpisodeIdentity(activeEpisode)}:${processedStreamUrl}`;
    if (loadedCastMediaRef.current === mediaKey) {
      return;
    }

    let cancelled = false;
    const loadCastMedia = async () => {
      const castSubtitleTracks = externalSubs.flatMap((track, index) => {
        const uri = track?.uri as string | undefined;
        const type = String(track?.type || '').toLowerCase();
        if (!uri || !/^https?:\/\//i.test(uri)) {
          return [];
        }

        const contentType = type.includes('ttml')
          ? 'application/ttml+xml'
          : type.includes('vtt') || uri.toLowerCase().includes('.vtt')
            ? 'text/vtt'
            : null;
        if (!contentType) {
          return [];
        }

        return [
          {
            id: index + 1,
            type: 'text' as const,
            subtype: 'subtitles' as const,
            contentId: uri,
            contentType,
            language: track?.language || 'und',
            name: track?.title || track?.language || `Subtitle ${index + 1}`,
          },
        ];
      });

      try {
        await remoteMediaClient.loadMedia({
          autoplay: true,
          playbackRate,
          startTime: Math.max(
            remoteCastPositionRef.current,
            videoPositionRef.current.position,
            watchedDuration,
          ),
          mediaInfo: {
            contentUrl: processedStreamUrl,
            contentType: getCastContentType(
              processedStreamUrl,
              selectedStream?.type,
            ),
            mediaTracks: castSubtitleTracks,
            metadata: {
              type: 'generic',
              title: route.params?.primaryTitle,
              subtitle: activeEpisode?.title || route.params?.secondaryTitle,
              images: route.params?.poster?.poster
                ? [{ url: route.params.poster.poster }]
                : undefined,
            },
            customData: selectedStream?.headers
              ? { headers: selectedStream.headers }
              : undefined,
          },
        });

        if (!cancelled) {
          loadedCastMediaRef.current = mediaKey;
          wasCastingRef.current = true;
          playerRef.current?.pause();
          setToast('Playing on Cast device', 2000);
        }
      } catch (error) {
        console.warn('Failed to load media on Cast device:', error);
        if (!cancelled) {
          loadedCastMediaRef.current = '';
          setToast('This stream could not be played on the Cast device', 3000);
        }
      }
    };

    loadCastMedia();
    return () => {
      cancelled = true;
    };
  }, [
    activeEpisode,
    canCastStream,
    externalSubs,
    playbackRate,
    processedStreamUrl,
    remoteMediaClient,
    route.params?.poster?.poster,
    route.params?.primaryTitle,
    route.params?.secondaryTitle,
    selectedStream?.headers,
    selectedStream?.type,
    setToast,
    videoPositionRef,
    watchedDuration,
  ]);

  // Enter landscape and fullscreen on mount & focus, and restore on unmount
  useFocusEffect(
    useCallback(() => {
      Orientation.lockToLandscape();
      goFullScreen();
      reapplyFullscreenMode(isFullScreenRef.current);

      return () => {
        Orientation.unlockAllOrientations();
        exitFullScreen();
      };
    }, []),
  );

  useEffect(() => {
    Orientation.lockToLandscape();
    goFullScreen();
    return () => {
      Orientation.unlockAllOrientations();
      exitFullScreen();
    };
  }, []);

  useEffect(() => {
    isFullScreenRef.current = isFullScreen;
  }, [isFullScreen]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
          reapplyFullscreenMode(isFullScreenRef.current);
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
        if (showEpisodeSidebar) {
          setShowEpisodeSidebar(false);
          return true;
        }
        if (showSettings) {
          setShowSettings(false);
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
  }, [navigation, showEpisodeSidebar, showSettings]);

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
    if (streamLoading || isResolvingStream) {
      loadingOpacity.value = withTiming(1, { duration: 800 });
      loadingScale.value = withTiming(1, { duration: 800 });
    }
  }, [isResolvingStream, streamLoading]);

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
    textVisibility.value = withTiming(isTextVisible ? 1 : 0, { duration: 250 });

    // Speed icon blinking animation
    if (isTextVisible) {
      speedIconOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 250 }),
          withTiming(0, { duration: 150 }),
          withTiming(1, { duration: 150 }),
        ),
        -1,
      );
    } else {
      speedIconOpacity.value = withTiming(1, { duration: 150 });
    }
  }, [isTextVisible]);

  useEffect(() => {
    // Controls visibility
    controlsTranslateY.value = withTiming(showControls ? 0 : 150, {
      duration: 250,
    });
    controlsOpacity.value = withTiming(showControls ? 1 : 0, {
      duration: 250,
    });
  }, [showControls]);

  useEffect(() => {
    // Toast visibility
    toastOpacity.value = withTiming(showToast ? 1 : 0, { duration: 250 });
  }, [showToast]);

  useEffect(() => {
    // Settings modal visibility
    settingsTranslateY.value = withTiming(showSettings ? 0 : 5000, {
      duration: 250,
    });
    settingsOpacity.value = withTiming(showSettings ? 1 : 0, {
      duration: 250,
    });
  }, [showSettings]);

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
    reapplyFullscreenMode(isFullScreen);
  }, [isFullScreen]);

  const handleShowControls = useCallback(
    () => setShowControls(true),
    [setShowControls],
  );
  const handleHideControls = useCallback(
    () => setShowControls(false),
    [setShowControls],
  );
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
  const watchedDurationRef = useRef(watchedDuration);
  watchedDurationRef.current = watchedDuration;

  const handleVideoLoadCallback = useCallback(
    (e: any) => {
      handleVideoLoad(e?.naturalSize);
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
      const wd = watchedDurationRef.current;
      if (wd > 5) {
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
    ],
  );

  // Memoized video player props
  const videoPlayerProps = useMemo(
    () => ({
      disableGesture: isPlayerLocked || !enableSwipeGesture,
      doubleTapTime: 200,
      disableSeekButtons: isPlayerLocked || hideSeekButtons,
      showOnStart: !isPlayerLocked,
      source: {
        textTracks: externalSubs,
        uri:
          (selectedStream.link.startsWith('magnet:')
            ? processedStreamUrl
            : selectedStream.link) || '',
        bufferConfig: {
          minBufferMs: 8000,
          maxBufferMs: 20000,
          bufferForPlaybackMs: 1500,
          bufferForPlaybackAfterRebufferMs: 3000,
          backBufferDurationMs: 0,
          maxHeapAllocationPercent: 0.18,
          minBufferMemoryReservePercent: 0.2,
          minBackBufferMemoryReservePercent: 0.25,
          cacheSizeMB: 0,
        },
        shouldCache: true,
        ...(selectedStream?.type === 'm3u8' && { type: 'm3u8' }),
        ...(selectedStream?.type === 'mpd' && { type: 'mpd' }),
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
      subtitleStyle: {
        fontSize: settingsStorage.getSubtitleFontSize() ?? 16,
        opacity: settingsStorage.getSubtitleOpacity() ?? 1,
        paddingBottom: settingsStorage.getSubtitleBottomPadding() ?? 10,
        textColor: settingsStorage.getSubtitleTextColor(),
        fontFamily: settingsStorage.getSubtitleFontFamily(),
        edgeType: settingsStorage.getSubtitleEdgeType(),
        edgeColor: settingsStorage.getSubtitleEdgeColor(),
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
      rewindTime: 10,
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
      style: { flex: 1, zIndex: 100 },
      controlAnimationTiming: 357,
      controlTimeoutDelay: 10000,
      hideAllControlls: isPlayerLocked,
      onSeekSnap: handleSeekSnap,
    }),
    [
      isPlayerLocked,
      externalSubs,
      selectedStream.link,
      selectedStream.type,
      selectedStream.headers,
      activeEpisode?.title,
      handleProgressWithTime,
      combinedSkips,
      handleVideoLoadCallback,
      playbackRate,
      primary,
      navigation,
      handleShowControls,
      handleHideControls,
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
      processedStreamUrl,
      enableSwipeGesture,
      hideSeekButtons,
    ],
  );

  // Show loading state
  if (streamLoading && !isCasting && selectedStream?.type !== 'local') {
    return (
      <SafeAreaView
        edges={{ right: 'off', top: 'off', left: 'off', bottom: 'off' }}
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
  if (streamError && !isCasting && selectedStream?.type !== 'local') {
    return (
      <SafeAreaView className="bg-black flex-1 justify-center items-center">
        <SystemBars hidden={true} />
        <StatusBar translucent={true} hidden={true} />
        <OrientationLocker orientation={LANDSCAPE} />
        <Text className="text-red-500 text-lg text-center mb-4">
          Failed to load stream. Please try again.
        </Text>
        <TouchableOpacity
          className="bg-red-600 px-4 py-2 rounded-md"
          onPress={() => navigation.goBack()}>
          <Text className="text-white">Go Back</Text>
        </TouchableOpacity>
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
      <SystemBars hidden={isFullScreen} />
      <StatusBar translucent={true} hidden={true} />
      <OrientationLocker orientation={LANDSCAPE} />

      {/* Local or Cast player */}
      {remoteMediaClient ? (
        <CastRemotePlayer
          client={remoteMediaClient}
          title={route.params?.primaryTitle}
          subtitle={activeEpisode?.title || route.params?.secondaryTitle}
          artwork={
            route.params?.poster?.background || route.params?.poster?.poster
          }
          accentColor={primary}
          onBack={() => navigation.goBack()}
          onError={message => setToast(message, 3000)}
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

      {/* Non-intrusive Torrent Status Overlay */}
      {!isCasting &&
        selectedStream?.type === 'torrent' &&
        !streamLoading &&
        torrentState !== 'seeding' &&
        torrentState !== 'finished' && (
          <Animated.View
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
          </Animated.View>
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
        <Animated.View
          style={[lockButtonStyle]}
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
            <View className="opacity-70 p-2 rounded-full">
              <CastButton
                accessibilityLabel="Cast video"
                tintColor="hsl(0, 0%, 70%)"
                style={{ width: 24, height: 24 }}
              />
            </View>
          )}
        </Animated.View>
      )}

      {/* Episode Sidebar Toggle Button (Center Right) */}
      {!isCasting &&
        !streamLoading &&
        !isPlayerLocked &&
        showEpisodeSidebarSetting &&
        hasMultipleEpisodes && (
          <Animated.View
            style={[
              controlsOpacityStyle,
              {
                position: 'absolute',
                right: 2,
                top: '50%',
                transform: [{ translateY: -20 }],
                zIndex: 60,
              },
            ]}
            pointerEvents={
              showControls && !showEpisodeSidebar && !showSettings
                ? 'auto'
                : 'none'
            }>
            <TouchableOpacity
              onPress={() => {
                setShowEpisodeSidebar(true);
              }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              className="p-2 rounded-full justify-center items-center">
              <MaterialIcons
                activeOpacity={0.6}
                name="chevron-left"
                size={28}
                color={BOTTOM_CONTROL_ICON_COLOR}
              />
            </TouchableOpacity>
          </Animated.View>
        )}

      {/* Bottom controls */}
      {!isCasting && !isPlayerLocked && (
        <Animated.View
          style={[controlsStyle, { left: '10%', right: '10%', bottom: 15 }]}
          className="absolute flex-row items-center">
          {/* Audio controls */}
          <TouchableOpacity
            onPress={() => {
              setActiveTab('audio');
              setShowSettings(!showSettings);
            }}
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
          </TouchableOpacity>

          {/* Subtitle controls */}
          <TouchableOpacity
            onPress={() => {
              setActiveTab('subtitle');
              setShowSettings(!showSettings);
            }}
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
          </TouchableOpacity>

          {/* Speed controls */}
          <TouchableOpacity
            className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
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
          </TouchableOpacity>

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
          <TouchableOpacity
            className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
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
          </TouchableOpacity>

          {/* Resize button */}
          <TouchableOpacity
            className="min-w-0 flex-1 flex-row items-center justify-center gap-1"
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
          </TouchableOpacity>

          {/* Next episode button */}
          {hasNextEpisode &&
            videoPositionRef.current.duration > 0 &&
            currentPlaybackTime / videoPositionRef.current.duration > 0.8 && (
              <TouchableOpacity
                className="min-w-0 flex-1 flex-row items-center justify-center"
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
              </TouchableOpacity>
            )}
        </Animated.View>
      )}

      {/* Floating Skip Button (Intro/Outro/Recap) */}
      {activeSkip &&
        !isCasting &&
        !streamLoading &&
        !isPlayerLocked &&
        showControls && (
          <Animated.View
            style={{
              position: 'absolute',
              bottom: 95,
              right: 28,
              zIndex: 65,
            }}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleSkip}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.11)',
                // borderColor: 'rgba(255, 255, 255, 0.18)',
                // borderWidth: 1,
                borderRadius: 24,
                paddingVertical: 7,
                paddingHorizontal: 16,
                gap: 6,
              }}>
              <Text
                style={{
                  color: 'rgba(255, 255, 255, 0.88)',
                  fontWeight: '600',
                  fontSize: 13,
                  letterSpacing: 0.2,
                }}>
                {activeSkip.title
                  ? activeSkip.title.toLowerCase().startsWith('skip')
                    ? activeSkip.title
                    : `Skip ${activeSkip.title}`
                  : 'Skip Intro'}
              </Text>
              <Feather
                name="chevrons-right"
                size={18}
                color="rgba(255, 255, 255, 0.85)"
              />
            </TouchableOpacity>
          </Animated.View>
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
        <Animated.View
          style={[settingsStyle, { backgroundColor: 'rgba(0,0,0,0.48)' }]}
          className="absolute opacity-0 top-0 left-0 w-full h-full justify-end items-center"
          onTouchEnd={() => setShowSettings(false)}>
          <View
            className="p-3 w-[620px] h-80 rounded-t-3xl flex-row justify-start items-center"
            style={{
              backgroundColor: 'rgba(13,13,13,0.94)',
              borderColor: 'rgba(255,255,255,0.12)',
              borderWidth: 1,
              shadowColor: '#000',
              shadowOpacity: 0.45,
              shadowRadius: 24,
              elevation: 18,
            }}
            onTouchEnd={e => e.stopPropagation()}>
            {/* Audio Tab */}
            {activeTab === 'audio' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="mb-2 text-lg font-bold text-center text-white">
                  Audio
                </Text>
                {audioTracks.length === 0 && (
                  <View className="flex justify-center items-center">
                    <Text className="text-white text-xs">
                      Loading audio tracks...
                    </Text>
                  </View>
                )}
                {audioTracks.map((track, i) => (
                  <PlayerMenuRow
                    key={i}
                    title={track.language || `Audio track ${i + 1}`}
                    detail={[track.type, track.title]
                      .filter(Boolean)
                      .join(' · ')}
                    selected={selectedAudioTrackIndex === i}
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
                    <PlayerMenuRow
                      title="Disabled"
                      selected={selectedTextTrackIndex === 1000}
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
                      title="Add external file"
                      accentColor={primary}
                      icon="add"
                      onPress={async () => {
                        try {
                          const res = await DocumentPicker.getDocumentAsync({
                            type: [
                              'text/vtt',
                              'application/x-subrip',
                              'text/srt',
                              'application/ttml+xml',
                            ],
                            multiple: false,
                          });

                          if (!res.canceled && res.assets?.[0]) {
                            const asset = res.assets[0];
                            let trackType = asset.mimeType as any;
                            const fileName = (asset.name || '').toLowerCase();
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
                            setExternalSubs((prev: any) => [track, ...prev]);
                          }
                        } catch (err) {
                          console.log(err);
                        }
                      }}
                    />
                    <SearchSubtitles
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      setExternalSubs={setExternalSubs}
                    />
                  </>
                }
                renderItem={({ item: track }) => (
                  <PlayerMenuRow
                    title={track.language || 'Unknown'}
                    detail={[track.type, track.title]
                      .filter(Boolean)
                      .join(' · ')}
                    selected={selectedTextTrackIndex === track.index}
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
                  contentContainerStyle={{ paddingRight: 8 }}>
                  <Text className="mb-2 w-full text-center text-white text-lg font-extrabold">
                    Server
                  </Text>
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
                          key={i}
                          title={track.server || `Server ${i + 1}`}
                          quality={track.quality}
                          tags={tags.length > 0 ? tags : undefined}
                          selected={track.link === selectedStream.link}
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
                      title="Local video"
                      detail="Choose a file from this device"
                      selected={selectedStream?.type === 'local'}
                      accentColor={primary}
                      icon="folder-open"
                      onPress={handleSelectLocalVideo}
                    />
                  </View>
                </ScrollView>

                <ScrollView contentContainerStyle={{ paddingLeft: 8 }}>
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
                    key={i}
                    title={`${rate}x`}
                    selected={playbackRate === rate}
                    accentColor={primary}
                    icon="speed"
                    onPress={() => {
                      setPlaybackRate(rate);
                      setShowSettings(false);
                    }}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        </Animated.View>
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
                <TouchableOpacity
                  onPress={() => setShowEpisodeSidebar(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{
                    padding: 4,
                    borderRadius: 20,
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  }}>
                  <MaterialIcons name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
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
                renderItem={({ item: ep, index }) => {
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
                      primaryColor={primary}
                      onSelect={() => {
                        if (!isActive) {
                          setActiveEpisode(ep);
                          hasSetInitialAudioRef.current = false;
                          hasSetInitialTextRef.current = false;
                        }
                        setShowEpisodeSidebar(false);
                      }}
                    />
                  );
                }}
              />
            </Animated.View>
          </>
        )}
    </SafeAreaView>
  );
};

export default Player;
