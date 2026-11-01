import AmbientBackground from './components/AmbientBackground';
import {getAmbientBars} from '../../lib/player/ambient';
import {useControlVisibility} from './hooks/useControlVisibility';
import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useState,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {DeviceEventEmitter, NativeModules, Platform, ToastAndroid, View} from 'react-native';
import {settingsStorage} from '../../lib/storage';
import {useFocusEffect} from '@react-navigation/native';
import * as Brightness from 'expo-brightness';
import Video, {
  OnLoadData,
  OnLoadStartData,
  OnProgressData,
  OnSeekData,
  ResizeMode,
  VideoRef,
  ViewType,
} from 'react-native-video';
import {useControlTimeout, useJSAnimations, usePanResponders} from './hooks';
import {
  Error,
  Loader,
  TopControls,
  BottomControls,
  PlayPause,
  Overlay,
} from './components';
import {SeekControls} from './components/PlayPause/SeekButton';
import {PlatformSupport} from './OSSupport';
import {_onBack} from './utils';
import {_styles} from './styles';
import type {VideoPlayerProps, WithRequiredProperty} from './types';
import Gestures from './components/Gestures';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const volumeWidth = 150;
const iconOffset = 0;
const AnimatedVideo = Animated.createAnimatedComponent(Video);

const AnimatedVideoPlayer = (
  props: WithRequiredProperty<VideoPlayerProps, 'animations'>,
) => {
  const {
    animations,
    toggleResizeModeOnFullscreen,
    doubleTapTime = 130,
    resizeMode = ResizeMode.CONTAIN,
    isFullscreen = false,
    showOnStart = false,
    showOnEnd = false,
    alwaysShowControls = false,
    paused = false,
    muted = false,
    volume = 1,
    title = {primary: '', secondary: ''},
    headerStatus,
    ambientVideoSize,
    ambientDisabled = false,
    headerRightInset = 0,
    controlScale = 1,
    seekbarScale = 1,
    playbackSuspended = false,
    rate = 1,
    showDuration = false,
    showTimeRemaining = false,
    showHours = false,
    onSeek,
    onError,
    onBack,
    onEnd,
    onEnterFullscreen = () => {},
    onExitFullscreen = () => {},
    onHideControls = () => {},
    onShowControls = () => {},
    onPause,
    onPlay,
    onLoad,
    onLoadStart,
    onProgress,
    controlTimeoutDelay = 15000,
    tapAnywhereToPause = false,
    videoStyle = {},
    containerStyle = {},
    seekColor = '',
    source,
    disableBack = false,
    disableVolume = false,
    disableFullscreen = false,
    disableTimer = false,
    disableSeekbar = false,
    disablePlayPause = false,
    disableSeekButtons = false,
    disableOverlay,
    navigator,
    rewindTime = 15,
    pan: {horizontal: horizontalPan, inverted: invertedPan} = {},
    testID,
    disableGesture = false,
    hideAllControlls = false,
    onSeekSnap,
    skips,
  } = props;

  const localVideoView = useRef<View>(null);
  const ambientView = props.nativeVideoViewRef || localVideoView;
  const [ambientConfig, setAmbientConfig] = useState(() => ({enabled: settingsStorage.isAmbientVideoEnabled(), intensity: settingsStorage.getAmbientIntensity(), spread: settingsStorage.getAmbientSpread(), responseMs: settingsStorage.getAmbientResponseMs()}));
  const [ambientViewport, setAmbientViewport] = useState({width: 0, height: 0});
  const [ambientPip, setAmbientPip] = useState(false);
  useFocusEffect(useCallback(() => {
    setAmbientConfig(previous => {
      const enabled = settingsStorage.isAmbientVideoEnabled();
      const intensity = settingsStorage.getAmbientIntensity();
      const spread = settingsStorage.getAmbientSpread();
      const responseMs = settingsStorage.getAmbientResponseMs();
      return enabled === previous.enabled && intensity === previous.intensity && spread === previous.spread && responseMs === previous.responseMs ? previous : {enabled, intensity, spread, responseMs};
    });
  }, [playbackSuspended]));
  const ambientBars = useMemo(() => getAmbientBars(ambientViewport.width, ambientViewport.height, ambientVideoSize?.width || 0, ambientVideoSize?.height || 0, resizeMode), [ambientViewport, ambientVideoSize, resizeMode]);
  const handleAmbientLayout = useCallback((event: import('react-native').LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setAmbientViewport(previous => previous.width === width && previous.height === height ? previous : {width, height});
  }, []);
  const handlePipStatus = useCallback((event: {isActive: boolean}) => {
    setAmbientPip(event.isActive);
    props.onPictureInPictureStatusChanged?.(event);
  }, [props.onPictureInPictureStatusChanged]);
  const mounted = useRef(false);
  const originalBrightness = useRef<number | null>(null);
  const _videoRef = useRef<VideoRef>(null);
  const tapActionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [_resizeMode, setResizeMode] = useState<ResizeMode>(ResizeMode.CONTAIN);
  const [_paused, setPaused] = useState<boolean>(paused);
  const endedRef = useRef(false);
  const [_muted, setMuted] = useState<boolean>(muted);
  const [_volume, setVolume] = useState<number>(volume);
  const [volumeBoost, setVolumeBoost] = useState(1);
  const [volumeBoostEnabled, setVolumeBoostEnabled] = useState(() =>
    Platform.OS === 'android' && settingsStorage.isVolumeBoostEnabled(),
  );
  const volumeBoostAvailable = volumeBoostEnabled;
  const subtitleUrisRef = useRef(new Set<string>());
  subtitleUrisRef.current = new Set(source?.textTracks?.map(track => track.uri) || []);
  const failedSubtitleUrisRef = useRef(new Set<string>());
  useEffect(() => { failedSubtitleUrisRef.current.clear(); }, [source?.uri]);
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('VegaExternalSubtitleLoadFailed', (uri: string) => {
      if (!subtitleUrisRef.current.has(uri) || failedSubtitleUrisRef.current.has(uri)) return;
      failedSubtitleUrisRef.current.add(uri);
      if (Platform.OS === 'android') {
        ToastAndroid.show('Could not load an external subtitle. Try adding it again.', ToastAndroid.LONG);
      }
    });
    return () => subscription.remove();
  }, []);
  useFocusEffect(useCallback(() => {
    setVolumeBoostEnabled(Platform.OS === 'android' && settingsStorage.isVolumeBoostEnabled());
  }, []));
  const [_isFullscreen, setIsFullscreen] = useState<boolean>(
    isFullscreen || resizeMode === 'cover' || false,
  );
  const [_playbackRate, setPlaybackRate] = useState<number>(rate);
  const [_showTimeRemaining, setShowTimeRemaining] = useState<boolean>(() =>
    props.showTimeRemaining !== undefined
      ? showTimeRemaining
      : settingsStorage.isShowTimeRemaining(),
  );
  const [volumeTrackWidth, setVolumeTrackWidth] = useState<number>(0);
  const [volumeFillWidth, setVolumeFillWidth] = useState<number>(0);
  const [seekerFillWidth, setSeekerFillWidth] = useState<number>(0);
  const [showControls, setShowControls] = useControlVisibility(props.showControls, showOnStart);
  const [volumePosition, setVolumePositionState] = useState(0);
  const [seekerPosition, setSeekerPositionState] = useState(0);
  const [volumeOffset, setVolumeOffset] = useState(0);
  const [seekerWidth, setSeekerWidth] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const seekingRef = useRef(false);
  const seekWasActive = useRef(false);
  const wasPausedBeforeSeek = useRef(false);
  const [seekSnapPosition, setSeekSnapPosition] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [cachedDuration, setCachedDuration] = useState(0);
  const [cachedPosition, setCachedPosition] = useState(0);
  const [seekThumbnailUri, setSeekThumbnailUri] = useState<string | null>(null);
  const [seekThumbnailLoading, setSeekThumbnailLoading] = useState(false);
  const seekThumbnailRequestId = useRef(0);
  const seekThumbnailMemoryCache = useRef(new Map<string, string>());
  const [skipFeedbackLeft, setSkipFeedbackLeft] = useState(0);
  const [skipFeedbackRight, setSkipFeedbackRight] = useState(0);
  const skipFeedbackResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomScale = useSharedValue(1);
  const zoomStartScale = useSharedValue(1);

  const zoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: Platform.OS === 'android' ? 1 : zoomScale.value}],
  }));
  const videoZoomProps = useAnimatedProps(() => ({
    videoZoom: zoomScale.value,
  }));
  // Ambient bars use the original fitted bounds. Transform them with the
  // video so their opaque fill cannot cover the expanded picture.
  const ambientZoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: zoomScale.value}],
  }));

  const videoRef = props.videoRef || _videoRef;

  const setSeekingState = useCallback<
    Dispatch<SetStateAction<boolean>>
  >((value) => {
    const nextValue =
      typeof value === 'function' ? value(seekingRef.current) : value;
    // Update synchronously so a progress event arriving between pointer-down
    // and React's next render cannot move the seek thumb back to playback.
    seekingRef.current = nextValue;
    setSeeking(nextValue);
  }, []);

  // The resize control is also the explicit way to return to the normal view.
  useEffect(() => {
    zoomStartScale.value = 1;
    zoomScale.value = withTiming(1, {duration: 180});
  }, [resizeMode, zoomScale, zoomStartScale]);

  useEffect(() => {
    let active = true;

    Brightness.getBrightnessAsync()
      .then((brightness) => {
        if (active) {
          originalBrightness.current = brightness;
        }
      })
      .catch((brightnessError) => {
        console.error('Error reading initial brightness:', brightnessError);
      });

    return () => {
      active = false;

      const restoreBrightness = async () => {
        try {
          if (Platform.OS === 'android') {
            await Brightness.restoreSystemBrightnessAsync();
          } else if (originalBrightness.current !== null) {
            await Brightness.setBrightnessAsync(originalBrightness.current);
          }
        } catch (brightnessError) {
          console.error('Error resetting brightness:', brightnessError);
        }
      };

      void restoreBrightness();
    };
  }, []);

  const {clearControlTimeout, resetControlTimeout, setControlTimeout} =
    useControlTimeout({
      controlTimeoutDelay,
      mounted: mounted.current,
      showControls,
      setShowControls,
      alwaysShowControls,
    });

  const toggleFullscreen = useCallback(
    () => setIsFullscreen((prevState) => !prevState),
    [],
  );
  const toggleControls = useCallback(
    () => setShowControls((prevState) => alwaysShowControls || !prevState),
    [alwaysShowControls],
  );
  const toggleTimer = useCallback(() => {
    setShowTimeRemaining((prevState) => {
      const next = !prevState;
      settingsStorage.setShowTimeRemaining(next);
      if (settingsStorage.isHapticFeedbackEnabled()) {
        ReactNativeHapticFeedback.trigger('selection', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
      return next;
    });
  }, []);
  const togglePlayPause = useCallback(() => {
    setPaused((prevState) => !prevState);
  }, []);

  const styles = useMemo(
    () => ({
      videoStyle,
      containerStyle: containerStyle,
    }),
    [videoStyle, containerStyle],
  );

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const _onSeek = useCallback(
    (obj: OnSeekData) => {
      try {
        if (!seekingRef.current) {
          setControlTimeout();
        }

        const validCurrentTime = Math.max(
          0,
          Math.min(obj.currentTime || 0, durationRef.current),
        );
        setCurrentTime(validCurrentTime);

        if (typeof onSeek === 'function') {
          onSeek(obj);
        }
      } catch (error) {
        console.error('Error in _onSeek:', error);
      }
    },
    [setControlTimeout, onSeek],
  );

  const _onEnd = useCallback(() => {
    endedRef.current = true;
    if (currentTimeRef.current < durationRef.current) {
      setCurrentTime(durationRef.current);
      setPaused(!props.repeat);

      if (showOnEnd) {
        setShowControls(!props.repeat);
      }
    }

    if (typeof onEnd === 'function') {
      onEnd();
    }
  }, [props.repeat, showOnEnd, onEnd]);

  const _onError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const _onLoadStart = useCallback(
    (e: OnLoadStartData) => {
      setLoading(true);

      if (typeof onLoadStart === 'function') {
        onLoadStart(e);
      }
    },
    [onLoadStart],
  );

  const showControlsRef = useRef(showControls);
  showControlsRef.current = showControls;

  const _onLoad = useCallback(
    (data: OnLoadData) => {
      setDuration(data.duration);
      setLoading(false);

      if (showControlsRef.current) {
        setControlTimeout();
      }

      if (typeof onLoad === 'function') {
        onLoad(data);
      }
    },
    [setControlTimeout, onLoad],
  );

  const _onProgress = useCallback(
    (data: OnProgressData) => {
      setLoading(false);
      if (!seekingRef.current && !buffering) {
        const newCurrentTime = data.currentTime;
        const newCachedDuration = data.playableDuration;

        // Update current time
        setCurrentTime(newCurrentTime);
        setCachedDuration(newCachedDuration);

        // Update seekbar position based on current time and duration
        if (duration > 0 && seekerWidth > 0) {
          const progress = newCurrentTime / duration;
          const position = progress * seekerWidth;
          setSeekerPosition(position);
        }

        // Update cached position for buffer indicator
        if (duration > 0 && seekerWidth > 0) {
          const bufferProgress = newCachedDuration / duration;
          const cachedPos = bufferProgress * seekerWidth;
          setCachedPosition(cachedPos);
        }

        if (typeof onProgress === 'function') {
          onProgress(data);
        }
      }
    },
    [buffering, onProgress, duration, seekerWidth],
  );

  const _onScreenTouch = useCallback(() => {
    if (tapActionTimeout.current) {
      clearTimeout(tapActionTimeout.current);
      tapActionTimeout.current = null;
      toggleFullscreen();
      if (showControlsRef.current) {
        resetControlTimeout();
      }
    } else {
      tapActionTimeout.current = setTimeout(() => {
        if (tapAnywhereToPause && showControlsRef.current) {
          togglePlayPause();
          resetControlTimeout();
        } else {
          toggleControls();
        }
        tapActionTimeout.current = null;
      }, doubleTapTime);
    }
  }, [
    toggleFullscreen,
    resetControlTimeout,
    tapAnywhereToPause,
    togglePlayPause,
    toggleControls,
    doubleTapTime,
  ]);

  const _onPlaybackRateChange = useCallback(
    (playBack: {playbackRate: number}) => {
      // Android briefly reports rate 0 while a TV seek buffers. The TV player
      // is controlled by its explicit paused prop; treating that transition
      // as a user pause leaves playback stopped after confirming a seek.
      if (Platform.isTV) return;
      if (playBack.playbackRate === 0 && !buffering) {
        setPaused(prev => (prev ? prev : true));
      } else if (playBack.playbackRate > 0) {
        setPaused(prev => (!prev ? prev : false));
      }
    },
    [buffering],
  );

  const events = useMemo(
    () => ({
      onError: onError || _onError,
      onBack: (onBack || _onBack(navigator)) as () => void,
      onEnd: _onEnd,
      onScreenTouch: _onScreenTouch,
      onEnterFullscreen,
      onExitFullscreen,
      onShowControls,
      onHideControls,
      onLoadStart: _onLoadStart,
      onProgress: _onProgress,
      onSeek: _onSeek,
      onLoad: _onLoad,
      onPause,
      onPlay,
      onPlaybackRateChange: _onPlaybackRateChange,
    }),
    [
      onError,
      _onError,
      onBack,
      navigator,
      _onEnd,
      _onScreenTouch,
      onEnterFullscreen,
      onExitFullscreen,
      onShowControls,
      onHideControls,
      _onLoadStart,
      _onProgress,
      _onSeek,
      _onLoad,
      onPause,
      onPlay,
      _onPlaybackRateChange,
    ],
  );

  const constrainToSeekerMinMax = useCallback(
    (val = 0) => {
      if (val <= 0) {
        return 0;
      } else if (val >= seekerWidth) {
        return seekerWidth;
      }
      return val;
    },
    [seekerWidth],
  );

  const constrainToVolumeMinMax = useCallback((val = 0) => {
    if (val <= 0) {
      return 0;
    } else if (val >= volumeWidth + 9) {
      return volumeWidth + 9;
    }
    return val;
  }, []);

  const setSeekerPosition = useCallback(
    (position = 0) => {
      const positionValue = constrainToSeekerMinMax(position);

      // Batch state updates to prevent excessive re-renders
      setSeekerPositionState(positionValue);
      setSeekerFillWidth(positionValue);
    },
    [constrainToSeekerMinMax],
  );

  const setVolumePosition = useCallback(
    (position = 0) => {
      const positionValue = constrainToVolumeMinMax(position);

      // Batch state updates
      setVolumePositionState(positionValue + iconOffset);

      if (positionValue < 0) {
        setVolumeFillWidth(0);
      } else {
        setVolumeFillWidth(positionValue);
      }
    },
    [constrainToVolumeMinMax],
  );

  const seekVideo = useCallback((time: number) => {
    try {
      console.log('seekVideo called with time:', time);
      console.log('videoRef.current:', !!videoRef?.current);
      console.log('videoRef.current.seek:', !!videoRef?.current?.seek);

      if (
        videoRef?.current?.seek &&
        typeof videoRef.current.seek === 'function'
      ) {
        console.log('Calling videoRef.current.seek with time:', time);
        // Try seeking with tolerance parameter for better compatibility
        videoRef.current.seek(time, 100);
      } else if (videoRef?.current) {
        // Fallback: try calling seek directly on the ref if available
        console.log('Trying fallback seek method');
        (videoRef.current as any).seek?.(time);
      } else {
        console.warn('Video seek function not available', {
          ref: !!videoRef?.current,
          seekFunction: !!videoRef?.current?.seek,
        });
      }
    } catch (error) {
      console.error('Error seeking video:', error);
    }
  }, []);

  const {volumePanResponder, seekPanResponder} = usePanResponders({
    duration,
    volumeOffset,
    loading,
    seekerWidth,
    seekerPosition,
    seek: seekVideo,
    clearControlTimeout,
    setVolumePosition,
    setSeekerPosition,
    setSeeking: setSeekingState,
    setSeekSnapPosition,
    setControlTimeout,
    onEnd: events.onEnd,
    onSeekSnap,
    horizontal: horizontalPan,
    inverted: invertedPan,
  });

  useEffect(() => {
    if (toggleResizeModeOnFullscreen) {
      setResizeMode(_isFullscreen ? ResizeMode.CONTAIN : ResizeMode.COVER);
    }

    if (mounted.current) {
      if (_isFullscreen) {
        typeof events.onEnterFullscreen === 'function' &&
          events.onEnterFullscreen();
      } else {
        typeof events.onExitFullscreen === 'function' &&
          events.onExitFullscreen();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_isFullscreen, toggleResizeModeOnFullscreen]);

  useEffect(() => {
    setIsFullscreen(isFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    setPaused(paused);
  }, [paused]);

  useEffect(() => {
    if (seeking) {
      if (!seekWasActive.current) {
        seekWasActive.current = true;
        wasPausedBeforeSeek.current = _paused;
      }

      // Hold the current frame while the user chooses a position. Keep
      // enforcing this in case an external paused prop or buffering callback
      // attempts to resume playback during the gesture.
      if (!_paused) {
        setPaused(true);
      }
      return;
    }

    if (seekWasActive.current) {
      seekWasActive.current = false;
      if (!wasPausedBeforeSeek.current) {
        setPaused(false);
      }
    }
  }, [_paused, seeking]);

  useEffect(() => {
    if (_paused) {
      typeof events.onPause === 'function' && events.onPause();
    } else {
      typeof events.onPlay === 'function' && events.onPlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_paused]);

  // Optimize seekbar position updates with throttling
  const updateSeekerPositionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!seeking && currentTime && duration && seekerWidth) {
      if (updateSeekerPositionRef.current) {
        cancelAnimationFrame(updateSeekerPositionRef.current);
      }

      updateSeekerPositionRef.current = requestAnimationFrame(() => {
        const percent = currentTime / duration;
        const position = seekerWidth * percent;
        const cachedPercent = cachedDuration / duration;
        const _cachedPosition = seekerWidth * cachedPercent;
        const newCachedPosition = constrainToSeekerMinMax(_cachedPosition);

        setCachedPosition(newCachedPosition);
        setSeekerPosition(position);

        updateSeekerPositionRef.current = null;
      });
    }

    return () => {
      if (updateSeekerPositionRef.current) {
        cancelAnimationFrame(updateSeekerPositionRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentTime,
    duration,
    seekerWidth,
    setSeekerPosition,
    constrainToSeekerMinMax,
  ]);

  // set current time when seeking
  useEffect(() => {
    if (seeking && seekerPosition && seekerWidth && duration) {
      const percent = seekerPosition / seekerWidth;
      const newTime = duration * percent;
      setCurrentTime(newTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeking, seekerPosition]);

  const animationsRef = useRef(animations);
  animationsRef.current = animations;
  const eventsRef = useRef(events);
  eventsRef.current = events;


  useEffect(() => {
    if (showControls) {
      animationsRef.current.showControlAnimation();
      setControlTimeout();
      typeof eventsRef.current.onShowControls === 'function' &&
        eventsRef.current.onShowControls();
    } else {
      animationsRef.current.hideControlAnimation();
      clearControlTimeout();
      typeof eventsRef.current.onHideControls === 'function' &&
        eventsRef.current.onHideControls();
    }
  }, [showControls, setControlTimeout, clearControlTimeout]);

  useEffect(() => {
    setMuted(muted);
  }, [muted]);

  // Optimize volume updates with throttling
  const updateVolumeRef = useRef<number | null>(null);

  useEffect(() => {
    if (disableVolume) return;
    if (updateVolumeRef.current) {
      cancelAnimationFrame(updateVolumeRef.current);
    }

    updateVolumeRef.current = requestAnimationFrame(() => {
      const newVolume = volumePosition / volumeWidth;

      setMuted(newVolume <= 0);

      setVolume(prev => (Math.abs(prev - newVolume) > 0.02 ? newVolume : prev));
      setVolumeOffset(volumePosition);

      const newVolumeTrackWidth = volumeWidth - volumeFillWidth;
      setVolumeTrackWidth(
        newVolumeTrackWidth > 150 ? 150 : newVolumeTrackWidth,
      );

      updateVolumeRef.current = null;
    });

    return () => {
      if (updateVolumeRef.current) {
        cancelAnimationFrame(updateVolumeRef.current);
      }
    };
  }, [disableVolume, volumeFillWidth, volumePosition]);

  useEffect(() => {
    const position = volumeWidth * _volume;
    setVolumePosition(position);
    setVolumeOffset(position);
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearControlTimeout();
      // Clean up any pending animation frames
      if (updateSeekerPositionRef.current) {
        cancelAnimationFrame(updateSeekerPositionRef.current);
      }
      if (updateVolumeRef.current) {
        cancelAnimationFrame(updateVolumeRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPlaybackRate(rate);
  }, [rate]);

  const handleSkipFeedback = useCallback(
    (side: 'left' | 'right', totalTime: number) => {
      if (side === 'left') {
        setSkipFeedbackLeft(totalTime);
        setSkipFeedbackRight(0);
      } else {
        setSkipFeedbackRight(totalTime);
        setSkipFeedbackLeft(0);
      }
      if (skipFeedbackResetRef.current) {
        clearTimeout(skipFeedbackResetRef.current);
      }
      if (totalTime > 0) {
        // Safety net only. The gesture clears the feedback itself once the
        // accumulated seek is applied, so this must not outlive that.
        skipFeedbackResetRef.current = setTimeout(() => {
          setSkipFeedbackLeft(0);
          setSkipFeedbackRight(0);
        }, 600);
      }
    },
    [],
  );

  const rewind = useCallback(
    (time?: number) => {
      const newTime =
        typeof time === 'number'
          ? currentTime - time
          : currentTime - rewindTime;
      setCurrentTime(newTime);
      videoRef?.current?.seek(newTime);
    },
    [currentTime, rewindTime, videoRef],
  );

  const forward = useCallback(
    (time?: number) => {
      const newTime =
        typeof time === 'number'
          ? currentTime + time
          : currentTime + rewindTime;
      setCurrentTime(newTime);
      videoRef?.current?.seek(newTime);
    },
    [currentTime, rewindTime, videoRef],
  );

  // Memoize onBuffer callback
  const onBuffer = useCallback((e: {isBuffering: boolean}) => {
    setBuffering(e.isBuffering);
    if (!e.isBuffering && !seekingRef.current && (!Platform.isTV || !paused)) {
      setPaused(false);
    }
  }, [paused]);

  // Memoize source URI for dependency comparison - use deep comparison for stability
  const sourceUri = useMemo(() => {
    if (!source) return null;
    if (typeof source === 'object' && 'uri' in source) {
      return source.uri;
    }
    if (typeof source === 'object') {
      // For other source objects, create a stable string representation
      return JSON.stringify(source);
    }
    return String(source);
  }, [source]);

  // The end of a video pauses the player. When a new source replaces it
  // (next episode), follow the paused prop again so the new video plays.
  useEffect(() => {
    if (!endedRef.current) return;
    endedRef.current = false;
    setPaused(paused);
  }, [sourceUri]);

  const thumbnailSource = useMemo(() => {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (typeof source === 'object' && 'uri' in source) {
      return typeof source.uri === 'string' ? source.uri : null;
    }
    return null;
  }, [source]);

  const thumbnailHeaders = useMemo(() => {
    if (
      source &&
      typeof source === 'object' &&
      'headers' in source &&
      source.headers
    ) {
      return source.headers;
    }
    return {};
  }, [source]);

  const thumbnailHeadersKey = useMemo(
    () =>
      Object.entries(thumbnailHeaders)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}:${value}`)
        .join('|'),
    [thumbnailHeaders],
  );

  const seekPreviewTime = useMemo(() => {
    if (!seeking || seekerWidth <= 0 || duration <= 0) return currentTime;
    return duration * Math.max(0, Math.min(1, seekerPosition / seekerWidth));
  }, [currentTime, duration, seekerPosition, seekerWidth, seeking]);

  // Reuse one representative frame for a timeline region instead of asking
  // the native decoder for another frame after every tiny thumb movement.
  // Short videos retain finer previews while feature-length content uses
  // wider regions to keep scrubbing responsive.
  const seekThumbnailTimestampMs = useMemo(() => {
    if (duration <= 0) return 0;
    const bucketSeconds = duration >= 3600 ? 15 : duration >= 1200 ? 10 : 5;
    const bucketStart =
      Math.floor(Math.max(0, seekPreviewTime) / bucketSeconds) * bucketSeconds;
    const representativeTime = Math.min(
      duration,
      bucketStart + bucketSeconds / 2,
    );
    return Math.round(representativeTime * 1000);
  }, [duration, seekPreviewTime]);

  // The responder clears the active timer on touch-down. Keep enforcing that
  // invariant while scrubbing in case another control schedules a timeout.
  useEffect(() => {
    if (seeking) {
      clearControlTimeout();
    }
  }, [clearControlTimeout, seeking]);

  useEffect(() => {
    const requestId = ++seekThumbnailRequestId.current;
    const thumbnailModule = NativeModules.VideoThumbnailModule as
      | {
          getThumbnail: (
            uri: string,
            timestampMs: number,
            headers: Record<string, string>,
            options: Record<string, number | boolean>,
          ) => Promise<{uri: string}>;
        }
      | undefined;

    if (!seeking) {
      setSeekThumbnailUri(null);
      setSeekThumbnailLoading(false);
      return;
    }

    if (!thumbnailSource || !thumbnailModule) {
      setSeekThumbnailUri(null);
      setSeekThumbnailLoading(false);
      return;
    }

    const memoryCacheKey = `${thumbnailSource}|${thumbnailHeadersKey}|${seekThumbnailTimestampMs}`;
    const memoryCachedUri = seekThumbnailMemoryCache.current.get(memoryCacheKey);
    if (memoryCachedUri) {
      // Refresh insertion order so the bounded map behaves as an LRU cache.
      seekThumbnailMemoryCache.current.delete(memoryCacheKey);
      seekThumbnailMemoryCache.current.set(memoryCacheKey, memoryCachedUri);
      setSeekThumbnailUri(memoryCachedUri);
      setSeekThumbnailLoading(false);
      return;
    }

    // Never leave the previous timestamp's frame visible while the debounced
    // request for the new position is pending.
    setSeekThumbnailUri(null);
    setSeekThumbnailLoading(true);
    const debounce = setTimeout(() => {
      thumbnailModule
        .getThumbnail(
          thumbnailSource,
          seekThumbnailTimestampMs,
          thumbnailHeaders,
          {
          maxWidth: 320,
          maxHeight: 180,
          quality: 78,
          cache: true,
          },
        )
        .then(result => {
          seekThumbnailMemoryCache.current.set(memoryCacheKey, result.uri);
          if (seekThumbnailMemoryCache.current.size > 48) {
            const oldestKey = seekThumbnailMemoryCache.current.keys().next().value;
            if (oldestKey) {
              seekThumbnailMemoryCache.current.delete(oldestKey);
            }
          }
          if (seekThumbnailRequestId.current === requestId) {
            setSeekThumbnailUri(result.uri);
            setSeekThumbnailLoading(false);
          }
        })
        .catch(() => {
          if (seekThumbnailRequestId.current === requestId) {
            setSeekThumbnailUri(null);
            setSeekThumbnailLoading(false);
          }
        });
    }, 180);

    return () => clearTimeout(debounce);
  }, [
    seeking,
    seekThumbnailTimestampMs,
    thumbnailHeaders,
    thumbnailHeadersKey,
    thumbnailSource,
  ]);

  // Keep track of previous source to prevent unnecessary resets
  const prevSourceUri = useRef(sourceUri);
  const hasInitialized = useRef(false);

  // reset on url change - only reset if source actually changed and component has initialized
  useEffect(() => {
    if (
      hasInitialized.current &&
      sourceUri !== prevSourceUri.current &&
      sourceUri !== null
    ) {
      prevSourceUri.current = sourceUri;
      setLoading(true);
      setSeekerFillWidth(0);
      setSeekerPosition(0);
      setCachedPosition(0);
      setCurrentTime(0);
    } else if (!hasInitialized.current) {
      prevSourceUri.current = sourceUri;
      hasInitialized.current = true;
    }
  }, [sourceUri, setSeekerPosition]);

  return (
    <PlatformSupport
      showControls={showControls}
      containerStyles={styles.containerStyle}
      onScreenTouch={events.onScreenTouch}
      testID={testID}>
      <View style={[_styles.player.container, styles.containerStyle]} onLayout={handleAmbientLayout}>
        <Animated.View
          ref={ambientView} collapsable={false}
          pointerEvents="none"
          style={[_styles.player.video, zoomAnimatedStyle]}>
          <AnimatedVideo
            controls={false}
            {...props}
            {...events}
            animatedProps={Platform.OS === 'android' ? videoZoomProps : undefined}
            ref={videoRef || _videoRef}
            resizeMode={resizeMode}
            volume={_volume * (volumeBoostAvailable ? volumeBoost : 1)}
            paused={_paused || playbackSuspended}
            muted={_muted}
            rate={_playbackRate}
            style={[_styles.player.video, styles.videoStyle]}
            source={source}
            onBuffer={onBuffer}
            onPictureInPictureStatusChanged={handlePipStatus}
            // Preserve the native HDR/Dolby Vision output path.
            useTextureView={Platform.OS === 'android' ? false : props.useTextureView}
            viewType={Platform.OS === 'android' ? ViewType.SURFACE : props.viewType}
          />
          {Platform.OS === 'android' && ambientConfig.enabled && !ambientDisabled && !ambientPip && sourceUri && (
            <Animated.View pointerEvents="none" style={[_styles.player.video, ambientZoomAnimatedStyle]}>
              <AmbientBackground key={String(sourceUri)} videoView={ambientView} bars={ambientBars}
                paused={_paused || playbackSuspended || loading || buffering} intensity={ambientConfig.intensity} spread={ambientConfig.spread} responseMs={ambientConfig.responseMs} />
            </Animated.View>
          )}
        </Animated.View>
        {!hideAllControlls && !disableOverlay && <Overlay animations={animations} />}
        {
          <>
            <Error error={error} />
            {!hideAllControlls && (
              <>
                <TopControls
                  title={title}
                  headerStatus={headerStatus}
                  headerRightInset={headerRightInset}
                  controlAppearance={props.controlAppearance}
                  controlScale={controlScale}
                  panHandlers={volumePanResponder.panHandlers}
                  animations={animations}
                  disableBack={disableBack}
                  disableVolume={disableVolume}
                  volumeFillWidth={volumeFillWidth}
                  volumeTrackWidth={volumeTrackWidth}
                  volumePosition={volumePosition}
                  onBack={events.onBack}
                  resetControlTimeout={resetControlTimeout}
                  showControls={showControls}
                />
                {loading ? (
                  <Loader color={seekColor} />
                ) : (
                  <PlayPause
                    controlScale={controlScale}
                    animations={animations}
                    disablePlayPause={disablePlayPause}
                    paused={_paused}
                    togglePlayPause={togglePlayPause}
                    resetControlTimeout={resetControlTimeout}
                    showControls={showControls}
                    buffering={buffering}
                    primaryColor={seekColor}
                  />
                )}
                <Gestures
                  maxVolume={volumeBoostAvailable ? 2 : 1}
                  onVolumeBoostChange={setVolumeBoost}
                  forward={forward}
                  rewind={rewind}
                  togglePlayPause={togglePlayPause}
                  doubleTapTime={doubleTapTime}
                  seekerWidth={seekerWidth}
                  rewindTime={rewindTime}
                  toggleControls={toggleControls}
                  tapActionTimeout={tapActionTimeout}
                  tapAnywhereToPause={tapAnywhereToPause}
                  showControls={showControls}
                  seekButtonsEnabled={
                    !hideAllControlls && !disablePlayPause && !disableSeekButtons
                  }
                  disableGesture={disableGesture}
                  baseRate={rate}
                  setPlayback={setPlaybackRate}
                  clearControlTimeout={clearControlTimeout}
                  setControlTimeout={setControlTimeout}
                  zoomScale={zoomScale}
                  zoomStartScale={zoomStartScale}
                  onSkipFeedback={handleSkipFeedback}
                />
                <BottomControls
                  controlScale={controlScale}
                  seekbarScale={seekbarScale}
                  animations={animations}
                  panHandlers={seekPanResponder.panHandlers}
                  disableTimer={disableTimer}
                  disableSeekbar={disableSeekbar}
                  showHours={showHours}
                  showDuration={showDuration}
                  paused={_paused}
                  showTimeRemaining={_showTimeRemaining}
                  currentTime={currentTime}
                  duration={duration}
                  seekColor={seekColor}
                  toggleTimer={toggleTimer}
                  resetControlTimeout={resetControlTimeout}
                  seekerFillWidth={seekerFillWidth}
                  seekerPosition={seekerPosition}
                  setSeekerWidth={setSeekerWidth}
                  cachedPosition={cachedPosition}
                  seeking={seeking}
                  seekPreviewTime={seekPreviewTime}
                  seekThumbnailUri={seekThumbnailUri}
                  seekThumbnailLoading={seekThumbnailLoading}
                  seekSnapPosition={seekSnapPosition}
                  isFullscreen={isFullscreen}
                  disableFullscreen={disableFullscreen}
                  toggleFullscreen={toggleFullscreen}
                  showControls={showControls}
                  skips={skips}
                />
              </>
            )}
          </>
        }
        {!hideAllControlls && !disablePlayPause && !disableSeekButtons ? (
          <SeekControls
            size={54 * controlScale}
            seekSeconds={rewindTime}
            onPressRewind={rewind}
            onPressForward={forward}
            resetControlTimeout={resetControlTimeout}
            showControls={showControls && !loading}
            skipFeedbackLeft={skipFeedbackLeft}
            skipFeedbackRight={skipFeedbackRight}
          />
        ) : null}
      </View>
    </PlatformSupport>
  );
};

const CustomAnimations = ({
  useAnimations,
  controlAnimationTiming = 450,
  ...props
}: WithRequiredProperty<VideoPlayerProps, 'useAnimations'>) => {
  const animations = useAnimations(controlAnimationTiming);
  return <AnimatedVideoPlayer animations={animations} {...props} />;
};

const JSAnimations = (props: VideoPlayerProps) => {
  const animations = useJSAnimations(
    props.controlAnimationTiming,
    props.showControls ?? props.showOnStart ?? true,
  );

  return <AnimatedVideoPlayer animations={animations} {...props} />;
};

export const VideoPlayer = (props: Omit<VideoPlayerProps, 'animations'>) => {
  if (props?.useAnimations) {
    return <CustomAnimations useAnimations={props?.useAnimations} {...props} />;
  }

  return <JSAnimations {...props} />;
};
