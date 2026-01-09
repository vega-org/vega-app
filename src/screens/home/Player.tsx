import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {
  ScrollView,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  Platform,
  TouchableNativeFeedback,
  Pressable,
  useTVEventHandler,
} from 'react-native';
import {isTV} from '../../lib/tv/constants';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../../App';
import {cacheStorage, settingsStorage} from '../../lib/storage';
import {OrientationLocker, LANDSCAPE} from 'react-native-orientation-locker';
import VideoPlayer from '@8man/react-native-media-console';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  VideoRef,
  SelectedVideoTrack,
  SelectedVideoTrackType,
  ResizeMode,
  SelectedTrack,
  SelectedTrackType,
} from 'react-native-video';
import useContentStore from '../../lib/zustand/contentStore';
// import {CastButton, useRemoteMediaClient} from 'react-native-google-cast';
import {SafeAreaView} from 'react-native-safe-area-context';
// import GoogleCast from 'react-native-google-cast';
import * as DocumentPicker from 'expo-document-picker';
import useThemeStore from '../../lib/zustand/themeStore';
import {FlashList} from '@shopify/flash-list';
import SearchSubtitles from '../../components/SearchSubtitles';
import useWatchHistoryStore from '../../lib/zustand/watchHistrory';
import {useStream, useVideoSettings} from '../../lib/hooks/useStream';
import {
  usePlayerProgress,
  usePlayerSettings,
} from '../../lib/hooks/usePlayerSettings';
import * as NavigationBar from 'expo-navigation-bar';
import {StatusBar} from 'react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const goFullScreen = () => {
  if (Platform.OS === 'android') {
    // Hide the navigation bar
    NavigationBar.setVisibilityAsync('hidden');
    // Make it "sticky immersive" (appears on swipe, then hides again)
    NavigationBar.setBehaviorAsync('overlay-swipe');
    StatusBar.setHidden(true, 'slide');
  }
  // `expo-status-bar` handles the top bar
};

const exitFullScreen = () => {
  if (Platform.OS === 'android') {
    // Show the navigation bar
    NavigationBar.setVisibilityAsync('visible');
    // Reset behavior
    NavigationBar.setBehaviorAsync('overlay-swipe');
    StatusBar.setHidden(false, 'slide');
  }
};

const Player = ({route}: Props): React.JSX.Element => {
  const {primary} = useThemeStore(state => state);
  const {provider} = useContentStore();
  const navigation = useNavigation();
  const {addItem, updatePlaybackInfo, updateItemWithInfo} =
    useWatchHistoryStore();

  // Player ref
  const playerRef: React.RefObject<VideoRef | null> = useRef(null);
  const hasSetInitialTracksRef = useRef(false);

  // TV Remote control refs and constants
  const TV_SEEK_AMOUNT = 10; // seconds to seek on left/right
  const tvControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isTVControlsVisible, setIsTVControlsVisible] = useState(false);
  const [tvFocusedControl, setTVFocusedControl] = useState<
    'audio' | 'subtitle' | 'speed' | 'server' | 'resize' | 'next' | null
  >(null);
  const [tvFocusedModalItem, setTVFocusedModalItem] = useState<string | null>(
    null,
  );

  // Shared values for animations
  const loadingOpacity = useSharedValue(0);
  const loadingScale = useSharedValue(0.8);
  const loadingRotation = useSharedValue(0);
  const lockButtonTranslateY = useSharedValue(-150);
  const lockButtonOpacity = useSharedValue(0);
  const textVisibility = useSharedValue(0);
  const speedIconOpacity = useSharedValue(1);
  const controlsTranslateY = useSharedValue(150);
  const controlsOpacity = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const settingsTranslateY = useSharedValue(10000);
  const settingsOpacity = useSharedValue(0);

  // Animated styles
  const loadingContainerStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
    transform: [{scale: loadingScale.value}],
  }));

  const loadingIconStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${loadingRotation.value}deg`}],
  }));

  const lockButtonStyle = useAnimatedStyle(() => ({
    transform: [{translateY: lockButtonTranslateY.value}],
    opacity: lockButtonOpacity.value,
  }));

  const controlsStyle = useAnimatedStyle(() => ({
    transform: [{translateY: controlsTranslateY.value}],
    opacity: controlsOpacity.value,
  }));

  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const settingsStyle = useAnimatedStyle(() => ({
    transform: [{translateY: settingsTranslateY.value}],

    opacity: settingsOpacity.value,
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
    selectedAudioTrackIndex,
    selectedTextTrackIndex,
    selectedQualityIndex,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    setTextTracks,
    processAudioTracks,
    processVideoTracks,
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
    isTextVisible,
    isFullScreen,
    handleResizeMode,
    togglePlayerLock,
    toggleFullScreen,
    handleLockedScreenTap,
    unlockButtonTimerRef,
  } = usePlayerSettings();

  // Custom hook for progress handling
  const {videoPositionRef, handleProgress} = usePlayerProgress({
    activeEpisode,
    routeParams: route.params,
    playbackRate,
    updatePlaybackInfo,
  });

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
    const cached = cacheStorage.getString(activeEpisode?.link);
    return cached ? JSON.parse(cached).position : 0;
  }, [activeEpisode?.link]);

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

  // Remote media client for casting
  // const remoteMediaClient = Platform.isTV ? null : useRemoteMediaClient();

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

  // Memoized next episode handler
  const handleNextEpisode = useCallback(() => {
    const currentIndex = route.params?.episodeList?.indexOf(activeEpisode);
    if (
      currentIndex !== undefined &&
      currentIndex < route.params?.episodeList?.length - 1
    ) {
      setActiveEpisode(route.params?.episodeList[currentIndex + 1]);
      hasSetInitialTracksRef.current = false;
    } else {
      ToastAndroid.show('No more episodes', ToastAndroid.SHORT);
    }
  }, [activeEpisode, route.params?.episodeList]);

  // Memoized error handler
  const handleVideoError = useCallback(
    (e: any) => {
      console.log('PlayerError', e);
      if (!switchToNextStream()) {
        ToastAndroid.show(
          'Video could not be played, try again later',
          ToastAndroid.SHORT,
        );
        navigation.goBack();
      }
      setShowControls(true);
    },
    [switchToNextStream, navigation, setShowControls],
  );

  // Memoized cast effect
  // useEffect(() => {
  //   if (remoteMediaClient && !Platform.isTV && selectedStream?.link) {
  //     remoteMediaClient.loadMedia({
  //       startTime: watchedDuration,
  //       playbackRate: playbackRate,
  //       autoplay: true,
  //       mediaInfo: {
  //         contentUrl: selectedStream.link,
  //         contentType: 'video/x-matroska',
  //         metadata: {
  //           title: route.params?.primaryTitle,
  //           subtitle: route.params?.secondaryTitle,
  //           type: 'movie',
  //           images: [
  //             {
  //               url: route.params?.poster?.poster || '',
  //             },
  //           ],
  //         },
  //       },
  //     });
  //     playerRef?.current?.pause();
  //     GoogleCast.showExpandedControls();
  //   }
  //   return () => {
  //     if (remoteMediaClient) {
  //       remoteMediaClient?.stop();
  //     }
  //   };
  // }, [
  //   remoteMediaClient,
  //   selectedStream,
  //   watchedDuration,
  //   playbackRate,
  //   route.params,
  // ]);

  // Exit fullscreen on back
  useFocusEffect(
    useCallback(() => {
      // This code now runs every time the screen is focused
      if (isFullScreen) {
        goFullScreen();
      } else {
        exitFullScreen();
      }

      return () => {};
    }, [isFullScreen]),
  );

  // Reset track selections when stream changes
  useEffect(() => {
    setSelectedAudioTrackIndex(0);
    setSelectedTextTrackIndex(1000);
    setSelectedQualityIndex(1000);
  }, [
    selectedStream,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
  ]);

  // Initialize search query
  useEffect(() => {
    setSearchQuery(route.params?.primaryTitle || '');
  }, [route.params?.primaryTitle]);

  // Add to watch history
  useEffect(() => {
    if (route.params?.primaryTitle) {
      addItem({
        id: route.params.infoUrl || activeEpisode.link,
        title: route.params.primaryTitle,
        poster:
          route.params.poster?.poster || route.params.poster?.background || '',
        link: route.params.infoUrl || '',
        provider: route.params?.providerValue || provider.value,
        lastPlayed: Date.now(),
        duration: 0,
        currentTime: 0,
        playbackRate: 1,
        episodeTitle: route.params?.secondaryTitle,
      });

      updateItemWithInfo(
        route.params.episodeList[route.params.linkIndex].link,
        {
          ...route.params,
          cachedAt: Date.now(),
        },
      );
    }
  }, [
    route.params?.primaryTitle,
    activeEpisode.link,
    addItem,
    updateItemWithInfo,
    route.params,
    provider.value,
  ]);

  // Set last selected audio and subtitle tracks
  useEffect(() => {
    if (hasSetInitialTracksRef.current) {
      return;
    }

    const lastAudioTrack = cacheStorage.getString('lastAudioTrack') || 'auto';
    const lastTextTrack = cacheStorage.getString('lastTextTrack') || 'auto';

    const audioTrackIndex = audioTracks.findIndex(
      track => track.language === lastAudioTrack,
    );
    const textTrackIndex = textTracks.findIndex(
      track => track.language === lastTextTrack,
    );

    if (audioTrackIndex !== -1) {
      setSelectedAudioTrack({
        type: SelectedTrackType.INDEX,
        value: audioTrackIndex,
      });
      setSelectedAudioTrackIndex(audioTrackIndex);
    }

    if (textTrackIndex !== -1) {
      setSelectedTextTrack({
        type: SelectedTrackType.INDEX,
        value: textTrackIndex,
      });
      setSelectedTextTrackIndex(textTrackIndex);
    }

    if (audioTracks.length > 0 && textTracks.length > 0) {
      hasSetInitialTracksRef.current = true;
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
      if (tvControlsTimeoutRef.current) {
        clearTimeout(tvControlsTimeoutRef.current);
      }
    };
  }, [unlockButtonTimerRef]);

  // TV Remote event handler
  const showTVControls = useCallback(() => {
    setIsTVControlsVisible(true);
    setShowControls(true);
    if (tvControlsTimeoutRef.current) {
      clearTimeout(tvControlsTimeoutRef.current);
    }
    tvControlsTimeoutRef.current = setTimeout(() => {
      setIsTVControlsVisible(false);
      setShowControls(false);
      setTVFocusedControl(null);
    }, 8000);
  }, [setShowControls]);

  const handleTVSeekForward = useCallback(() => {
    if (playerRef.current && videoPositionRef.current) {
      const newPosition = videoPositionRef.current.position + TV_SEEK_AMOUNT;
      playerRef.current.seek(newPosition);
      showTVControls();
    }
  }, [showTVControls]);

  const handleTVSeekBackward = useCallback(() => {
    if (playerRef.current && videoPositionRef.current) {
      const newPosition = Math.max(
        0,
        videoPositionRef.current.position - TV_SEEK_AMOUNT,
      );
      playerRef.current.seek(newPosition);
      showTVControls();
    }
  }, [showTVControls]);

  // TV Event Handler - using useTVEventHandler hook from react-native-tvos
  useTVEventHandler((evt: any) => {
    if (!isTV) {
      return;
    }

    const eventType = evt?.eventType;
    console.log(
      'TV Event:',
      eventType,
      'Controls visible:',
      isTVControlsVisible,
      'Focused:',
      tvFocusedControl,
    ); // Debug logging

    switch (eventType) {
      case 'select':
      case 'playPause':
        // If controls are visible, the focused Pressable will handle the press
        // If no controls visible, show them
        if (!isTVControlsVisible && !showSettings) {
          showTVControls();
        }
        break;
      case 'right':
        // Let native focus handle navigation between controls
        // Only seek if no control is focused
        if (!isTVControlsVisible && !showSettings && !tvFocusedControl) {
          handleTVSeekForward();
        }
        break;
      case 'left':
        // Let native focus handle navigation between controls
        // Only seek if no control is focused
        if (!isTVControlsVisible && !showSettings && !tvFocusedControl) {
          handleTVSeekBackward();
        }
        break;
      case 'up':
        if (!showSettings && !isTVControlsVisible) {
          showTVControls();
        }
        break;
      case 'down':
        // Only hide controls when:
        // 1. Settings dialog is NOT open
        // 2. No control is currently focused (user is in main video area)
        // 3. Controls are visible
        if (!showSettings && !tvFocusedControl && isTVControlsVisible) {
          setIsTVControlsVisible(false);
          setShowControls(false);
        }
        // Otherwise, let native focus handle navigation within controls/dialogs
        break;
      case 'longSelect':
        // Long press for settings
        setShowSettings(!showSettings);
        break;
      case 'menu':
      case 'back':
        // Back button handling - priority order:
        // 1. Close settings dialog first
        // 2. Then hide controls
        // 3. Only exit player if nothing else to close
        if (showSettings) {
          setShowSettings(false);
        } else if (isTVControlsVisible || tvFocusedControl) {
          setIsTVControlsVisible(false);
          setShowControls(false);
          setTVFocusedControl(null);
        } else {
          navigation.goBack();
        }
        break;
    }
  });

  // Animation effects
  useEffect(() => {
    // Loading animations
    if (streamLoading) {
      loadingOpacity.value = withTiming(1, {duration: 800});
      loadingScale.value = withTiming(1, {duration: 800});
      loadingRotation.value = withRepeat(
        withSequence(
          withDelay(500, withTiming(180, {duration: 900})),
          withTiming(180, {duration: 600}),
          withTiming(360, {duration: 900}),
          withTiming(360, {duration: 600}),
        ),
        -1,
      );
    }
  }, [streamLoading]);

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
    toastOpacity.value = withTiming(showToast ? 1 : 0, {duration: 250});
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
    // Handle fullscreen toggle
    if (isFullScreen) {
      goFullScreen();
    } else {
      exitFullScreen();
    }
  }, [isFullScreen]);

  // Memoized video player props
  const videoPlayerProps = useMemo(
    () => ({
      disableGesture: isPlayerLocked || !enableSwipeGesture || isTV,
      doubleTapTime: isTV ? 0 : 200,
      disableSeekButtons: isPlayerLocked || hideSeekButtons,
      showOnStart: !isPlayerLocked,
      source: {
        textTracks: externalSubs,
        uri: selectedStream?.link || '',
        bufferConfig: {backBufferDurationMs: 30000},
        shouldCache: true,
        ...(selectedStream?.type === 'm3u8' && {type: 'm3u8'}),
        headers: selectedStream?.headers,
        metadata: {
          title: route.params?.primaryTitle,
          subtitle: activeEpisode?.title,
          artist: activeEpisode?.title,
          description: activeEpisode?.title,
          imageUri: route.params?.poster?.poster,
        },
      },
      onProgress: handleProgress,
      onLoad: () => {
        playerRef?.current?.seek(watchedDuration);
        playerRef?.current?.resume();
        setPlaybackRate(1.0);
      },
      videoRef: playerRef as React.RefObject<VideoRef>,
      rate: playbackRate,
      poster: route.params?.poster?.logo || '',
      subtitleStyle: {
        fontSize: isTV ? 24 : settingsStorage.getSubtitleFontSize() || 16,
        opacity: settingsStorage.getSubtitleOpacity() || 1,
        paddingBottom: isTV
          ? 40
          : settingsStorage.getSubtitleBottomPadding() || 10,
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
      onShowControls: () => {
        setShowControls(true);
        if (isTV) {
          showTVControls();
        }
      },
      onHideControls: () => {
        setShowControls(false);
        if (isTV) {
          setTVFocusedControl(null);
        }
      },
      rewindTime: 10,
      isFullscreen: true,
      disableFullscreen: true,
      disableVolume: true,
      showHours: true,
      progressUpdateInterval: 1000,
      showNotificationControls: showMediaControls,
      onError: handleVideoError,
      resizeMode,
      selectedAudioTrack,
      onAudioTracks: (e: any) => processAudioTracks(e.audioTracks),
      selectedTextTrack,
      onTextTracks: (e: any) => setTextTracks(e.textTracks),
      onVideoTracks: (e: any) => processVideoTracks(e.videoTracks),
      selectedVideoTrack,
      style: {flex: 1, zIndex: 100},
      controlAnimationTiming: 357,
      controlTimeoutDelay: isTV ? 8000 : 10000,
      hideAllControlls: isPlayerLocked || isTV,
    }),
    [
      isPlayerLocked,
      enableSwipeGesture,
      hideSeekButtons,
      externalSubs,
      selectedStream,
      route.params,
      activeEpisode,
      handleProgress,
      watchedDuration,
      playbackRate,
      setPlaybackRate,
      primary,
      navigation,
      setShowControls,
      showMediaControls,
      handleVideoError,
      resizeMode,
      selectedAudioTrack,
      selectedTextTrack,
      selectedVideoTrack,
      processAudioTracks,
      processVideoTracks,
      showTVControls,
    ],
  );

  // Show loading state
  if (streamLoading) {
    return (
      <SafeAreaView
        edges={{right: 'off', top: 'off', left: 'off', bottom: 'off'}}
        className="bg-black flex-1 justify-center items-center">
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
              <Animated.View style={[loadingIconStyle]} className="mb-2">
                <MaterialIcons name="hourglass-empty" size={60} color="white" />
              </Animated.View>
              <Text className="text-white text-lg mt-4">Loading stream...</Text>
            </Animated.View>
          </View>
        </TouchableNativeFeedback>
      </SafeAreaView>
    );
  }

  // Show error state
  if (streamError) {
    return (
      <SafeAreaView className="bg-black flex-1 justify-center items-center">
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
      <StatusBar translucent={true} hidden={true} />
      <OrientationLocker orientation={LANDSCAPE} />

      {/* Video Player */}
      <VideoPlayer {...videoPlayerProps} />

      {/* TV Focusable overlay - Only when controls are hidden */}
      {isTV && !isTVControlsVisible && !showSettings && (
        <Pressable
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 5,
          }}
          hasTVPreferredFocus={true}
          isTVSelectable={true}
          onPress={() => {
            showTVControls();
          }}
        />
      )}

      {/* Full-screen overlay to detect taps when locked */}
      {isPlayerLocked && !isTV && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleLockedScreenTap}
          className="absolute top-0 left-0 right-0 bottom-0 z-40 bg-transparent"
        />
      )}

      {/* Lock/Unlock button - Hidden on TV */}
      {!streamLoading && !Platform.isTV && (
        <Animated.View
          style={[lockButtonStyle]}
          className="absolute top-5 right-5 flex-row items-center gap-2 z-50">
          <TouchableOpacity
            onPress={togglePlayerLock}
            className="opacity-70 p-2 rounded-full">
            <MaterialIcons
              name={isPlayerLocked ? 'lock' : 'lock-open'}
              color={'hsl(0, 0%, 70%)'}
              size={24}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleFullScreen}
            className="opacity-70 p-2 rounded-full">
            <MaterialIcons
              name={isFullScreen ? 'fullscreen-exit' : 'fullscreen'}
              color={'hsl(0, 0%, 70%)'}
              size={24}
            />
          </TouchableOpacity>
          {/* {!isPlayerLocked && (
            <CastButton
              style={{width: 40, height: 40, opacity: 0.5, tintColor: 'white'}}
            />
          )} */}
        </Animated.View>
      )}

      {/* TV Remote Hint - Shows when controls are visible on TV */}
      {isTV && isTVControlsVisible && showControls && !showSettings && (
        <View className="absolute top-4 left-4 flex-row items-center gap-3 opacity-60">
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="chevron-left" size={20} color="white" />
            <MaterialIcons name="chevron-right" size={20} color="white" />
            <Text className="text-white text-sm ml-1">Navigate</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <MaterialIcons
              name="check-box-outline-blank"
              size={20}
              color="white"
            />
            <Text className="text-white text-sm ml-1">Select</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="keyboard-arrow-down" size={20} color="white" />
            <Text className="text-white text-sm">Hide</Text>
          </View>
        </View>
      )}

      {/* Bottom controls */}
      {!isPlayerLocked && (showControls || (isTV && isTVControlsVisible)) && (
        <Animated.View
          style={[controlsStyle]}
          className="absolute bottom-3 right-6 flex flex-row justify-center w-full gap-x-16">
          {/* Audio controls */}
          <Pressable
            onPress={() => {
              setActiveTab('audio');
              setShowSettings(!showSettings);
            }}
            onFocus={() => isTV && setTVFocusedControl('audio')}
            onBlur={() => isTV && setTVFocusedControl(null)}
            hasTVPreferredFocus={isTV}
            isTVSelectable={true}
            style={[
              {flexDirection: 'row', gap: 4, alignItems: 'center'},
              isTV &&
                tvFocusedControl === 'audio' && {
                  borderWidth: 2,
                  borderColor: primary,
                  borderRadius: 8,
                  padding: 4,
                },
            ]}>
            <MaterialIcons
              style={{opacity: tvFocusedControl === 'audio' ? 1 : 0.7}}
              name={'multitrack-audio'}
              size={isTV ? 32 : 26}
              color={tvFocusedControl === 'audio' ? primary : 'white'}
            />
            <Text
              className="capitalize text-white"
              style={{
                fontSize: isTV ? 14 : 12,
                opacity: tvFocusedControl === 'audio' ? 1 : 0.7,
                color: tvFocusedControl === 'audio' ? primary : 'white',
              }}>
              {audioTracks[selectedAudioTrackIndex]?.language || 'auto'}
            </Text>
          </Pressable>

          {/* Subtitle controls */}
          <Pressable
            onPress={() => {
              setActiveTab('subtitle');
              setShowSettings(!showSettings);
            }}
            onFocus={() => isTV && setTVFocusedControl('subtitle')}
            onBlur={() => isTV && setTVFocusedControl(null)}
            isTVSelectable={true}
            style={[
              {flexDirection: 'row', gap: 4, alignItems: 'center'},
              isTV &&
                tvFocusedControl === 'subtitle' && {
                  borderWidth: 2,
                  borderColor: primary,
                  borderRadius: 8,
                  padding: 4,
                },
            ]}>
            <MaterialIcons
              style={{opacity: tvFocusedControl === 'subtitle' ? 1 : 0.6}}
              name={'subtitles'}
              size={isTV ? 30 : 24}
              color={tvFocusedControl === 'subtitle' ? primary : 'white'}
            />
            <Text
              className="capitalize text-white"
              style={{
                fontSize: isTV ? 14 : 12,
                opacity: tvFocusedControl === 'subtitle' ? 1 : 0.7,
                color: tvFocusedControl === 'subtitle' ? primary : 'white',
              }}>
              {selectedTextTrackIndex === 1000
                ? 'none'
                : textTracks[selectedTextTrackIndex]?.language}
            </Text>
          </Pressable>

          {/* Speed controls */}
          <Pressable
            onPress={() => {
              setActiveTab('speed');
              setShowSettings(!showSettings);
            }}
            onFocus={() => isTV && setTVFocusedControl('speed')}
            onBlur={() => isTV && setTVFocusedControl(null)}
            isTVSelectable={true}
            style={[
              {flexDirection: 'row', gap: 4, alignItems: 'center'},
              isTV &&
                tvFocusedControl === 'speed' && {
                  borderWidth: 2,
                  borderColor: primary,
                  borderRadius: 8,
                  padding: 4,
                },
            ]}>
            <MaterialIcons
              name="speed"
              size={isTV ? 32 : 26}
              color={tvFocusedControl === 'speed' ? primary : 'white'}
              style={{opacity: tvFocusedControl === 'speed' ? 1 : 0.6}}
            />
            <Text
              style={{
                fontSize: isTV ? 16 : 14,
                color: tvFocusedControl === 'speed' ? primary : 'white',
                opacity: tvFocusedControl === 'speed' ? 1 : 0.6,
              }}>
              {playbackRate === 1 ? '1.0' : playbackRate}
            </Text>
          </Pressable>

          {/* PIP */}
          {!Platform.isTV && (
            <TouchableOpacity
              className="flex-row gap-1 items-center opacity-60"
              onPress={() => {
                playerRef?.current?.enterPictureInPicture();
              }}>
              <MaterialIcons
                name="picture-in-picture"
                size={24}
                color="white"
              />
              <Text className="text-white text-xs">PIP</Text>
            </TouchableOpacity>
          )}

          {/* Server & Quality */}
          <Pressable
            onPress={() => {
              setActiveTab('server');
              setShowSettings(!showSettings);
            }}
            onFocus={() => isTV && setTVFocusedControl('server')}
            onBlur={() => isTV && setTVFocusedControl(null)}
            isTVSelectable={true}
            style={[
              {flexDirection: 'row', gap: 4, alignItems: 'center'},
              isTV &&
                tvFocusedControl === 'server' && {
                  borderWidth: 2,
                  borderColor: primary,
                  borderRadius: 8,
                  padding: 4,
                },
            ]}>
            <MaterialIcons
              name="video-settings"
              size={isTV ? 30 : 25}
              color={tvFocusedControl === 'server' ? primary : 'white'}
              style={{opacity: tvFocusedControl === 'server' ? 1 : 0.6}}
            />
            <Text
              className="capitalize"
              style={{
                fontSize: isTV ? 14 : 12,
                color: tvFocusedControl === 'server' ? primary : 'white',
                opacity: tvFocusedControl === 'server' ? 1 : 0.6,
              }}>
              {videoTracks?.length === 1
                ? formatQuality(videoTracks[0]?.height?.toString() || 'auto')
                : formatQuality(
                    videoTracks?.[selectedQualityIndex]?.height?.toString() ||
                      'auto',
                  )}
            </Text>
          </Pressable>

          {/* Resize button */}
          <Pressable
            onPress={handleResizeMode}
            onFocus={() => isTV && setTVFocusedControl('resize')}
            onBlur={() => isTV && setTVFocusedControl(null)}
            isTVSelectable={true}
            style={[
              {flexDirection: 'row', gap: 4, alignItems: 'center'},
              isTV &&
                tvFocusedControl === 'resize' && {
                  borderWidth: 2,
                  borderColor: primary,
                  borderRadius: 8,
                  padding: 4,
                },
            ]}>
            <MaterialIcons
              name="fit-screen"
              size={isTV ? 34 : 28}
              color={tvFocusedControl === 'resize' ? primary : 'white'}
              style={{opacity: tvFocusedControl === 'resize' ? 1 : 0.6}}
            />
            <Text
              style={{
                minWidth: 38,
                fontSize: isTV ? 16 : 14,
                color: tvFocusedControl === 'resize' ? primary : 'white',
                opacity: tvFocusedControl === 'resize' ? 1 : 0.6,
              }}>
              {resizeMode === ResizeMode.NONE
                ? 'Fit'
                : resizeMode === ResizeMode.COVER
                  ? 'Cover'
                  : resizeMode === ResizeMode.STRETCH
                    ? 'Stretch'
                    : 'Contain'}
            </Text>
          </Pressable>

          {/* Next episode button */}
          {route.params?.episodeList?.indexOf(activeEpisode) <
            route.params?.episodeList?.length - 1 &&
            (isTV ||
              videoPositionRef.current.position /
                videoPositionRef.current.duration >
                0.8) && (
              <Pressable
                onPress={handleNextEpisode}
                onFocus={() => isTV && setTVFocusedControl('next')}
                onBlur={() => isTV && setTVFocusedControl(null)}
                isTVSelectable={true}
                style={[
                  {flexDirection: 'row', alignItems: 'center'},
                  isTV &&
                    tvFocusedControl === 'next' && {
                      borderWidth: 2,
                      borderColor: primary,
                      borderRadius: 8,
                      padding: 4,
                    },
                ]}>
                <Text
                  style={{
                    fontSize: isTV ? 18 : 16,
                    color: tvFocusedControl === 'next' ? primary : 'white',
                    opacity: tvFocusedControl === 'next' ? 1 : 0.6,
                  }}>
                  Next
                </Text>
                <MaterialIcons
                  name="skip-next"
                  size={isTV ? 34 : 28}
                  color={tvFocusedControl === 'next' ? primary : 'white'}
                  style={{opacity: tvFocusedControl === 'next' ? 1 : 0.6}}
                />
              </Pressable>
            )}
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
      {!streamLoading && !isPlayerLocked && showSettings && (
        <Animated.View
          style={[settingsStyle]}
          className="absolute opacity-0 top-0 left-0 w-full h-full bg-black/20 justify-end items-center"
          onTouchEnd={() => !isTV && setShowSettings(false)}>
          <View
            className="bg-black p-3 rounded-t-lg flex-row justify-start items-center"
            style={{
              width: isTV ? 800 : 600,
              height: isTV ? 350 : 288,
            }}
            onTouchEnd={e => e.stopPropagation()}>
            {/* Audio Tab */}
            {activeTab === 'audio' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
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
                  <Pressable
                    className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={i}
                    isTVSelectable={true}
                    hasTVPreferredFocus={i === 0}
                    onFocus={() => isTV && setTVFocusedModalItem(`audio-${i}`)}
                    onBlur={() => isTV && setTVFocusedModalItem(null)}
                    style={[
                      isTV &&
                        tvFocusedModalItem === `audio-${i}` && {
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderWidth: 2,
                          borderColor: primary,
                          padding: 8,
                        },
                    ]}
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
                    }}>
                    <Text
                      className={'text-lg font-semibold'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.language}
                    </Text>
                    <Text
                      className={'text-base italic'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.type}
                    </Text>
                    <Text
                      className={'text-sm italic'}
                      style={{
                        color:
                          selectedAudioTrackIndex === i ? primary : 'white',
                      }}>
                      {track.title}
                    </Text>
                    {selectedAudioTrackIndex === i && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* Subtitle Tab */}
            {activeTab === 'subtitle' && (
              <FlashList
                estimatedItemSize={70}
                data={textTracks}
                extraData={tvFocusedModalItem}
                ListHeaderComponent={
                  <View>
                    <Text className="text-lg font-bold text-center text-white">
                      Subtitle
                    </Text>
                    <Pressable
                      className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-3"
                      isTVSelectable={true}
                      hasTVPreferredFocus={true}
                      onFocus={() =>
                        isTV && setTVFocusedModalItem('sub-disabled')
                      }
                      onBlur={() => isTV && setTVFocusedModalItem(null)}
                      style={[
                        isTV &&
                          tvFocusedModalItem === 'sub-disabled' && {
                            backgroundColor: 'rgba(255,255,255,0.2)',
                            borderWidth: 2,
                            borderColor: primary,
                            padding: 8,
                          },
                      ]}
                      onPress={() => {
                        setSelectedTextTrack({
                          type: SelectedTrackType.DISABLED,
                        });
                        setSelectedTextTrackIndex(1000);
                        cacheStorage.setString('lastTextTrack', '');
                        setShowSettings(false);
                      }}>
                      <Text
                        className="text-base font-semibold"
                        style={{
                          color:
                            selectedTextTrackIndex === 1000 ? primary : 'white',
                        }}>
                        Disabled
                      </Text>
                    </Pressable>
                  </View>
                }
                ListFooterComponent={
                  <>
                    <Pressable
                      className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                      isTVSelectable={true}
                      onFocus={() => isTV && setTVFocusedModalItem('sub-add')}
                      onBlur={() => isTV && setTVFocusedModalItem(null)}
                      style={[
                        isTV &&
                          tvFocusedModalItem === 'sub-add' && {
                            backgroundColor: 'rgba(255,255,255,0.2)',
                            borderWidth: 2,
                            borderColor: primary,
                            padding: 8,
                          },
                      ]}
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
                            const track = {
                              type: asset.mimeType as any,
                              title:
                                asset.name && asset.name.length > 20
                                  ? asset.name.slice(0, 20) + '...'
                                  : asset.name || 'undefined',
                              language: 'und',
                              uri: asset.uri,
                            };
                            setExternalSubs((prev: any) => [track, ...prev]);
                          }
                        } catch (err) {
                          console.log(err);
                        }
                      }}>
                      <MaterialIcons name="add" size={20} color="white" />
                      <Text className="text-base font-semibold text-white">
                        Add external file
                      </Text>
                    </Pressable>
                    <SearchSubtitles
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      setExternalSubs={setExternalSubs}
                    />
                  </>
                }
                renderItem={({item: track}) => (
                  <Pressable
                    className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                    isTVSelectable={true}
                    onFocus={() =>
                      isTV && setTVFocusedModalItem(`sub-${track.index}`)
                    }
                    onBlur={() => isTV && setTVFocusedModalItem(null)}
                    style={[
                      isTV &&
                        tvFocusedModalItem === `sub-${track.index}` && {
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderWidth: 2,
                          borderColor: primary,
                          padding: 8,
                        },
                    ]}
                    onPress={() => {
                      setSelectedTextTrack({
                        type: SelectedTrackType.INDEX,
                        value: track.index,
                      });
                      setSelectedTextTrackIndex(track.index);
                      cacheStorage.setString(
                        'lastTextTrack',
                        track.language || '',
                      );
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-base font-semibold'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.language}
                    </Text>
                    <Text
                      className={'text-sm italic'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.type}
                    </Text>
                    <Text
                      className={'text-sm italic text-white'}
                      style={{
                        color:
                          selectedTextTrackIndex === track.index
                            ? primary
                            : 'white',
                      }}>
                      {track.title}
                    </Text>
                    {selectedTextTrackIndex === track.index && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </Pressable>
                )}
              />
            )}

            {/* Server Tab */}
            {activeTab === 'server' && (
              <View className="flex flex-row w-full h-full p-1 px-4">
                <ScrollView className="border-r border-white/50">
                  <Text className="w-full text-center text-white text-lg font-extrabold">
                    Server
                  </Text>
                  {streamData?.length > 0 &&
                    streamData?.map((track, i) => (
                      <Pressable
                        className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                        key={i}
                        isTVSelectable={true}
                        hasTVPreferredFocus={i === 0}
                        onFocus={() =>
                          isTV && setTVFocusedModalItem(`server-${i}`)
                        }
                        onBlur={() => isTV && setTVFocusedModalItem(null)}
                        style={[
                          isTV &&
                            tvFocusedModalItem === `server-${i}` && {
                              backgroundColor: 'rgba(255,255,255,0.2)',
                              borderWidth: 2,

                              borderColor: primary,
                              padding: 8,
                            },
                        ]}
                        onPress={() => {
                          setSelectedStream(track);
                          setShowSettings(false);
                          playerRef?.current?.resume();
                        }}>
                        <Text
                          className={'text-base capitalize font-semibold'}
                          style={{
                            color: 'white',
                          }}>
                          {track.server}
                        </Text>
                        {track.link === selectedStream.link && (
                          <MaterialIcons name="check" size={20} color="white" />
                        )}
                      </Pressable>
                    ))}
                </ScrollView>

                <ScrollView>
                  <Text className="w-full text-center text-white text-lg font-extrabold">
                    Quality
                  </Text>
                  {videoTracks &&
                    videoTracks.map((track: any, i: any) => (
                      <Pressable
                        className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                        key={i}
                        isTVSelectable={true}
                        onFocus={() =>
                          isTV && setTVFocusedModalItem(`quality-${i}`)
                        }
                        onBlur={() => isTV && setTVFocusedModalItem(null)}
                        style={[
                          isTV &&
                            tvFocusedModalItem === `quality-${i}` && {
                              backgroundColor: 'rgba(255,255,255,0.2)',
                              borderWidth: 2,
                              borderColor: primary,
                              padding: 8,
                            },
                        ]}
                        onPress={() => {
                          setSelectedVideoTrack({
                            type: SelectedVideoTrackType.INDEX,
                            value: track.index,
                          });
                          setSelectedQualityIndex(i);
                        }}>
                        <Text
                          className={'text-base font-semibold'}
                          style={{
                            color:
                              selectedQualityIndex === i ? primary : 'white',
                          }}>
                          {track.height + 'p'}
                        </Text>
                        <Text
                          className={'text-sm italic'}
                          style={{
                            color:
                              selectedQualityIndex === i ? primary : 'white',
                          }}>
                          {'Bitrate-' +
                            track.bitrate +
                            ' | Codec-' +
                            (track?.codecs || 'unknown')}
                        </Text>
                        {selectedQualityIndex === i && (
                          <MaterialIcons name="check" size={20} color="white" />
                        )}
                      </Pressable>
                    ))}
                </ScrollView>
              </View>
            )}

            {/* Speed Tab */}
            {activeTab === 'speed' && (
              <ScrollView className="w-full h-full p-1 px-4">
                <Text className="text-lg font-bold text-center text-white">
                  Playback Speed
                </Text>
                {playbacks.map((rate, i) => (
                  <Pressable
                    className="flex-row gap-3 items-center rounded-md my-1 overflow-hidden ml-2"
                    key={i}
                    isTVSelectable={true}
                    hasTVPreferredFocus={i === 2}
                    onFocus={() => isTV && setTVFocusedModalItem(`speed-${i}`)}
                    onBlur={() => isTV && setTVFocusedModalItem(null)}
                    style={[
                      isTV &&
                        tvFocusedModalItem === `speed-${i}` && {
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderWidth: 2,
                          borderColor: primary,
                          padding: 8,
                        },
                    ]}
                    onPress={() => {
                      setPlaybackRate(rate);
                      setShowSettings(false);
                    }}>
                    <Text
                      className={'text-lg font-semibold'}
                      style={{
                        color: playbackRate === rate ? primary : 'white',
                      }}>
                      {rate}x
                    </Text>
                    {playbackRate === rate && (
                      <MaterialIcons name="check" size={20} color="white" />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

export default Player;
