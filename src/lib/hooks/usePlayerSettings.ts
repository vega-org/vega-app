import {useCallback, useEffect, useRef, useState} from 'react';
import {
  settingsStorage,
  watchProgressStorage,
  PLAYER_RESIZE_MODES,
  PlayerResizeMode,
} from '../storage';

interface UsePlayerProgressOptions {
  activeEpisode: any;
  onProgressSaved?: (position: number, duration: number) => void;
}

export const usePlayerProgress = ({
  activeEpisode,
  onProgressSaved,
}: UsePlayerProgressOptions) => {
  const videoPositionRef = useRef({position: 0, duration: 0});
  const lastSavedPositionRef = useRef(0);
  const hasProgressRef = useRef(false);
  const pendingProgressRef = useRef<{
    link: string;
    position: number;
    duration: number;
    onSaved?: (position: number, duration: number) => void;
  } | null>(null);

  const flushProgress = useCallback(() => {
    const progress = pendingProgressRef.current;
    if (!progress) return;
    watchProgressStorage.setProgress(progress.link, progress.position, progress.duration);
    progress.onSaved?.(progress.position, progress.duration);
    lastSavedPositionRef.current = progress.position;
    pendingProgressRef.current = null;
  }, []);

  useEffect(() => {
    videoPositionRef.current = {position: 0, duration: 0};
    lastSavedPositionRef.current = 0;
    hasProgressRef.current = false;
    return flushProgress;
  }, [activeEpisode.link, flushProgress]);

  // Memoized progress handler
  const handleProgress = useCallback(
    (e: {currentTime: number; seekableDuration: number}) => {
      const {currentTime, seekableDuration} = e;
      if (!Number.isFinite(currentTime) || currentTime < 0 || !Number.isFinite(seekableDuration) || seekableDuration <= 0) return;
      hasProgressRef.current = true;

      videoPositionRef.current = {
        position: currentTime,
        duration: seekableDuration,
      };
      pendingProgressRef.current = {
        link: activeEpisode.link,
        position: currentTime,
        duration: seekableDuration,
        onSaved: onProgressSaved,
      };

      // Save progress periodically (every 5 seconds)
      if (
        Math.abs(currentTime - lastSavedPositionRef.current) > 5 ||
        currentTime - lastSavedPositionRef.current > 5
      ) {
        flushProgress();
      }
    },
    [activeEpisode.link, onProgressSaved, flushProgress],
  );

  return {
    videoPositionRef,
    handleProgress,
    flushProgress,
    hasProgressRef,
  };
};

// Hook for player settings and UI state
export const usePlayerSettings = () => {
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'audio' | 'subtitle' | 'server' | 'quality' | 'speed' | 'sleep'
  >('audio');
  const [resizeMode, setResizeMode] = useState<PlayerResizeMode>(() =>
    settingsStorage.getDefaultResizeMode(),
  );
  const [playbackRate, setPlaybackRate] = useState(() =>
    settingsStorage.getPlaybackSpeed(),
  );
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [showUnlockButton, setShowUnlockButton] = useState(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [showToast, setShowToast] = useState(false);
  const [isTextVisible, setIsTextVisible] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(true);

  const unlockButtonTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cycles the fit for this session only; the default lives in Preferences.
  const handleResizeMode = useCallback(() => {
    const index = PLAYER_RESIZE_MODES.findIndex(
      option => option.mode === resizeMode,
    );
    const nextMode = PLAYER_RESIZE_MODES[(index + 1) % PLAYER_RESIZE_MODES.length];
    setResizeMode(nextMode.mode);
    setToast('Resize Mode: ' + nextMode.label, 2000);
  }, [resizeMode]);

  // Memoized toast setter
  const setToast = useCallback((message: string, duration: number) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, duration);
  }, []);

  // Memoized player lock toggle
  const togglePlayerLock = useCallback(() => {
    const newLockState = !isPlayerLocked;
    setIsPlayerLocked(newLockState);

    if (!newLockState) {
      setShowControls(true);
    } else {
      setShowUnlockButton(false);
    }

    if (unlockButtonTimerRef.current) {
      clearTimeout(unlockButtonTimerRef.current);
      unlockButtonTimerRef.current = null;
    }

    setToast(newLockState ? 'Player Locked' : 'Player Unlocked', 2000);
  }, [isPlayerLocked, setToast]);

  // Memoized locked screen tap handler
  const handleLockedScreenTap = useCallback(() => {
    if (showUnlockButton) {
      setShowUnlockButton(false);
      return;
    }

    setShowUnlockButton(true);

    if (unlockButtonTimerRef.current) {
      clearTimeout(unlockButtonTimerRef.current);
    }

    unlockButtonTimerRef.current = setTimeout(() => {
      setShowUnlockButton(false);
    }, 10000);
  }, [showUnlockButton]);

  // Speed picked by the user; temporary changes like the 2x hold skip this.
  const selectPlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    settingsStorage.setPlaybackSpeed(rate);
  }, []);

  // Memoized fullscreen toggle
  const toggleFullScreen = useCallback(() => {
    setIsFullScreen(prev => !prev);
  }, []);

  return {
    showControls,
    setShowControls,
    showSettings,
    setShowSettings,
    activeTab,
    setActiveTab,
    resizeMode,
    setResizeMode,
    playbackRate,
    setPlaybackRate,
    selectPlaybackRate,
    isPlayerLocked,
    showUnlockButton,
    toastMessage,
    showToast,
    isTextVisible,
    setIsTextVisible,
    isFullScreen,
    setIsFullScreen,
    handleResizeMode,
    setToast,
    togglePlayerLock,
    toggleFullScreen,
    handleLockedScreenTap,
    unlockButtonTimerRef,
  };
};
