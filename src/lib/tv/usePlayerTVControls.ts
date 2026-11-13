import {clampTimelineSeek, playbackTimeline, type PlaybackTimeline} from '../player/liveTimeline';
import {useState, useRef, useCallback, useEffect} from 'react';
import {isTV} from './constants';
import {useTVRemote} from './useTVRemote';
import {settingsStorage} from '../storage';

// Focused and idle controls share border width and padding, so focus only
// changes the color and the control row does not reflow.
const TV_CONTROL_IDLE_STYLE = {
  borderWidth: 2.5,
  borderColor: 'transparent',
  borderRadius: 12,
  padding: 4,
};

interface UsePlayerTVControlsOptions {
  playerRef: React.RefObject<any>;
  timelineRef?: React.RefObject<PlaybackTimeline>;
  videoPositionRef: React.RefObject<{position: number; duration: number}>;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showControls: boolean;
  setShowControls: (show: boolean) => void;
  showEpisodeSidebar?: boolean;
  setShowEpisodeSidebar?: (show: boolean) => void;
  primaryColor: string;
  onTogglePlayPause?: () => void;
  onSeekNotification?: (text: string) => void;
  /** Leave remote keys to native focus while an overlay owns the screen. */
  remoteSuspended?: boolean;
}

export const usePlayerTVControls = ({
  playerRef,
  timelineRef,
  videoPositionRef,
  showSettings,
  setShowSettings,
  showControls,
  setShowControls,
  showEpisodeSidebar = false,
  setShowEpisodeSidebar,
  onTogglePlayPause,
  onSeekNotification,
  remoteSuspended = false,
}: UsePlayerTVControlsOptions) => {
  const [isTVControlsVisible, setIsTVControlsVisible] = useState(false);
  const [tvFocusedControl, setTVFocusedControl] = useState<string | null>(null);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const tvControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSeekPositionRef = useRef<number | null>(null);
  const seekDeltaAccumulatorRef = useRef<number>(0);
  const seekDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [TV_SEEK_AMOUNT] = useState(() => settingsStorage.getSeekInterval());
  const TV_SCRUB_AMOUNT = 30;
  const focusedControlRef = useRef<string | null>(null);
  focusedControlRef.current = tvFocusedControl;

  const showTVControls = useCallback(() => {
    setIsTVControlsVisible(true);
    setShowControls(true);
    if (tvControlsTimeoutRef.current) {
      clearTimeout(tvControlsTimeoutRef.current);
    }
    tvControlsTimeoutRef.current = setTimeout(() => {
      if (showSettings || showEpisodeSidebar) {
        return;
      }
      // The video surface becomes the preferred focus target when controls
      // unmount, so an idle focused button must not keep them on screen forever.
      focusedControlRef.current = null;
      setTVFocusedControl(null);
      setScrubPosition(null);
      setIsTVControlsVisible(false);
      setShowControls(false);
    }, 8000);
  }, [setShowControls, showSettings, showEpisodeSidebar]);

  const seekTarget = useCallback((position: number) => {
    const timeline = timelineRef?.current ?? playbackTimeline({}, videoPositionRef.current.duration);
    return clampTimelineSeek(position, timeline);
  }, [timelineRef, videoPositionRef]);

  const performTVSeek = useCallback(
    (delta: number) => {
      if (!playerRef.current || !videoPositionRef.current) {
        return;
      }

      const currentBase =
        pendingSeekPositionRef.current !== null
          ? pendingSeekPositionRef.current
          : videoPositionRef.current.position || 0;

      const targetPos = seekTarget(currentBase + delta);
      if (targetPos === undefined) { showTVControls(); return; }
      pendingSeekPositionRef.current = targetPos;
      seekDeltaAccumulatorRef.current += delta;
      showTVControls();

      const sign = seekDeltaAccumulatorRef.current >= 0 ? '+' : '';
      const mins = Math.floor(targetPos / 60);
      const secs = Math.floor(targetPos % 60);
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      onSeekNotification?.(`${sign}${seekDeltaAccumulatorRef.current}s (${timeStr})`);

      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
      }
      seekDebounceTimerRef.current = setTimeout(() => {
        if (playerRef.current && pendingSeekPositionRef.current !== null) {
          const target = seekTarget(pendingSeekPositionRef.current);
          if (target !== undefined) playerRef.current.seek?.(target);
          pendingSeekPositionRef.current = null;
          seekDeltaAccumulatorRef.current = 0;
        }
      }, 350);
    },
    [playerRef, videoPositionRef, onSeekNotification, showTVControls, seekTarget],
  );

  const handleTVSeekForward = useCallback(() => {
    performTVSeek(TV_SEEK_AMOUNT);
  }, [performTVSeek]);

  const handleTVSeekBackward = useCallback(() => {
    performTVSeek(-TV_SEEK_AMOUNT);
  }, [performTVSeek]);

  const moveScrubber = useCallback((delta: number) => {
    const duration = videoPositionRef.current?.duration || 0;
    if (duration <= 0) return;
    setScrubPosition(previous =>
      seekTarget((previous ?? videoPositionRef.current.position) + delta) ?? null,
    );
    showTVControls();
  }, [showTVControls, videoPositionRef, seekTarget]);

  const confirmScrub = useCallback(() => {
    if (scrubPosition !== null) {
      const target = seekTarget(scrubPosition);
      if (target !== undefined) playerRef.current?.seek?.(target);
    }
    setScrubPosition(null);
    showTVControls();
  }, [playerRef, scrubPosition, showTVControls, seekTarget]);
  const cancelScrub = useCallback(() => setScrubPosition(null), []);
  const hideTVControls = useCallback(() => {
    if (tvControlsTimeoutRef.current) clearTimeout(tvControlsTimeoutRef.current);
    setIsTVControlsVisible(false);
    setShowControls(false);
    setTVFocusedControl(null);
  }, [setShowControls]);

  useEffect(() => {
    if (!isTV) return;
    if (showSettings || showEpisodeSidebar) {
      if (tvControlsTimeoutRef.current) clearTimeout(tvControlsTimeoutRef.current);
    } else if (showControls) {
      showTVControls();
    }
    // Opening a menu suspends idle hiding; closing it starts a fresh timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, showEpisodeSidebar]);

  useTVRemote(
    useCallback(
      evt => {
        if (!isTV || remoteSuspended) {
          return;
        }
        const eventType = evt?.eventType;
        switch (eventType) {
          case 'select':
            if (!showControls && !isTVControlsVisible && !showSettings && !showEpisodeSidebar) {
              showTVControls();
            }
            break;
          case 'playPause':
          case 'play':
          case 'pause':
            if (showSettings || showEpisodeSidebar) break;
            if (onTogglePlayPause) {
              onTogglePlayPause();
            }
            showTVControls();
            break;
          case 'fastForward':
            if (showSettings || showEpisodeSidebar) break;
            performTVSeek(TV_SEEK_AMOUNT);
            break;
          case 'rewind':
            if (showSettings || showEpisodeSidebar) break;
            performTVSeek(-TV_SEEK_AMOUNT);
            break;
          case 'longRight':
          case 'longFastForward':
            if (evt.eventKeyAction === 1 || showSettings || showEpisodeSidebar) break;
            if (tvFocusedControl === 'timeline') moveScrubber(TV_SCRUB_AMOUNT * 3);
            else if (tvFocusedControl === null || tvFocusedControl === 'play_pause' || eventType === 'longFastForward') performTVSeek(TV_SEEK_AMOUNT * 3);
            break;
          case 'longLeft':
          case 'longRewind':
            if (evt.eventKeyAction === 1 || showSettings || showEpisodeSidebar) break;
            if (tvFocusedControl === 'timeline') moveScrubber(-TV_SCRUB_AMOUNT * 3);
            else if (tvFocusedControl === null || tvFocusedControl === 'play_pause' || eventType === 'longRewind') performTVSeek(-TV_SEEK_AMOUNT * 3);
            break;
          case 'left':
            if (showSettings || showEpisodeSidebar) {
              break;
            }
            if (tvFocusedControl === 'timeline') {
              moveScrubber(-TV_SCRUB_AMOUNT);
              break;
            }
            if (tvFocusedControl === 'play_pause') {
              handleTVSeekBackward();
              break;
            }
            if (tvFocusedControl !== null && (showControls || isTVControlsVisible)) {
              break;
            }
            handleTVSeekBackward();
            break;
          case 'right':
            if (showSettings || showEpisodeSidebar) {
              break;
            }
            if (tvFocusedControl === 'timeline') {
              moveScrubber(TV_SCRUB_AMOUNT);
              break;
            }
            if (tvFocusedControl === 'play_pause') {
              handleTVSeekForward();
              break;
            }
            if (tvFocusedControl !== null && (showControls || isTVControlsVisible)) {
              break;
            }
            handleTVSeekForward();
            break;
          case 'up':
          case 'down':
            if (!showSettings && !showEpisodeSidebar) {
              showTVControls();
            }
            break;
          case 'back':
            if (scrubPosition !== null) {
              cancelScrub();
            } else if (showSettings) {
              setShowSettings(false);
            } else if (showEpisodeSidebar) {
              setShowEpisodeSidebar?.(false);
            } else if (showControls || isTVControlsVisible) {
              hideTVControls();
            }
            break;
        }
      },
      [
        showControls,
        isTVControlsVisible,
        showSettings,
        showEpisodeSidebar,
        tvFocusedControl,
        onTogglePlayPause,
        performTVSeek,
        handleTVSeekBackward,
        handleTVSeekForward,
        showTVControls,
        scrubPosition,
        cancelScrub,
        hideTVControls,
        moveScrubber,
        setShowSettings,
        setShowEpisodeSidebar,
        setShowControls,
        remoteSuspended,
      ],
    ),
    isTV,
  );

  useEffect(() => {
    return () => {
      if (tvControlsTimeoutRef.current) {
        clearTimeout(tvControlsTimeoutRef.current);
      }
      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
      }
    };
  }, []);

  const getTVFocusProps = useCallback(
    (controlId: string) => {
      if (!isTV) {
        return {};
      }
      if (showSettings || showEpisodeSidebar || !showControls) {
        return {
          focusable: false,
          isTVSelectable: false,
          style: TV_CONTROL_IDLE_STYLE,
        };
      }
      return {
        focusable: true,
        isTVSelectable: true,
        onFocus: () => {
          setTVFocusedControl(controlId);
          showTVControls();
        },
        onBlur: () => {
          setTVFocusedControl(prev => (prev === controlId ? null : prev));
          if (controlId === 'timeline') setScrubPosition(null);
        },
        // The outline is drawn by TVFocusPressable from native focus state;
        // this style only reserves the same space so rows don't reflow.
        style: TV_CONTROL_IDLE_STYLE,
      };
    },
    [showTVControls, showSettings, showEpisodeSidebar, showControls],
  );

  return {
    isTV,
    isTVControlsVisible,
    tvFocusedControl,
    setTVFocusedControl,
    showTVControls,
    handleTVSeekForward,
    handleTVSeekBackward,
    performTVSeek,
    scrubPosition,
    confirmScrub,
    cancelScrub,
    hideTVControls,
    getTVFocusProps,
  };
};
