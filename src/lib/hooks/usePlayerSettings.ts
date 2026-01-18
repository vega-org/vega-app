import {useCallback, useRef, useState} from 'react';
import {cacheStorage, mainStorage} from '../storage';

interface UsePlayerProgressOptions {
  activeEpisode: any;
  routeParams: any;
  playbackRate: number;
  updatePlaybackInfo: (link: string, data: any) => void;
}

export const usePlayerProgress = ({
  activeEpisode,
  routeParams,
  playbackRate,
  updatePlaybackInfo,
}: UsePlayerProgressOptions) => {
  const videoPositionRef = useRef({position: 0, duration: 0});
  const lastSavedPositionRef = useRef(0);

  // Memoized progress handler
  const handleProgress = useCallback(
    (e: {currentTime: number; seekableDuration: number}) => {
      const {currentTime, seekableDuration} = e;

      videoPositionRef.current = {
        position: currentTime,
        duration: seekableDuration,
      };

      // Update playback info for watch history
      if (
        routeParams?.episodeList &&
        routeParams?.linkIndex !== undefined &&
        !routeParams?.doNotTrack
      ) {
        updatePlaybackInfo(
          routeParams.episodeList[routeParams.linkIndex].link,
          {
            currentTime,
            duration: seekableDuration,
            playbackRate,
          },
        );
      }

      // Store progress data for watch history display
      if (!routeParams?.doNotTrack) {
        storeWatchProgressForHistory(
          routeParams.episodeList[routeParams.linkIndex].link,
          currentTime,
          seekableDuration,
        );
      }

      // Save progress periodically (every 5 seconds)
      if (
        Math.abs(currentTime - lastSavedPositionRef.current) > 5 ||
        currentTime - lastSavedPositionRef.current > 5
      ) {
        cacheStorage.setString(
          activeEpisode.link,
          JSON.stringify({
            position: currentTime,
            duration: seekableDuration,
          }),
        );
        lastSavedPositionRef.current = currentTime;
      }
    },
    [
      activeEpisode.link,
      routeParams.episodeList,
      routeParams.linkIndex,
      routeParams.infoUrl,
      routeParams.primaryTitle,
      routeParams.secondaryTitle,
      updatePlaybackInfo,
      playbackRate,
    ],
  );

  // Dedicated function to store watch progress for history display
  const storeWatchProgressForHistory = useCallback(
    (link: string, currentTime: number, duration: number) => {
      try {
        if (currentTime > 0 && duration > 0) {
          const historyKey = routeParams.infoUrl || link;
          const historyProgressKey = `watch_history_progress_${historyKey}`;
          const percentage = (currentTime / duration) * 100;

          const progressData = {
            currentTime,
            duration,
            percentage: percentage,
            infoUrl: routeParams.infoUrl || '',
            title: routeParams?.primaryTitle || '',
            episodeTitle: routeParams?.secondaryTitle || '',
            updatedAt: Date.now(),
          };

          mainStorage.setString(
            historyProgressKey,
            JSON.stringify(progressData),
          );

          // Also store with episodeTitle-specific key for series episodes
          if (routeParams?.secondaryTitle) {
            const episodeKey = `watch_history_progress_${historyKey}_${routeParams.secondaryTitle.replace(
              /\s+/g,
              '_',
            )}`;
            mainStorage.setString(episodeKey, JSON.stringify(progressData));
          }
        }
      } catch (error) {
        console.error('Error storing watch progress for history:', error);
      }
    },
    [routeParams],
  );

  return {
    videoPositionRef,
    handleProgress,
  };
};

// Hook for player settings and UI state
export const usePlayerSettings = () => {
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'audio' | 'subtitle' | 'server' | 'quality' | 'speed'
  >('audio');
  const [resizeMode, setResizeMode] = useState<any>('none');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [showUnlockButton, setShowUnlockButton] = useState(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [showToast, setShowToast] = useState(false);
  const [isTextVisible, setIsTextVisible] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(true);

  const unlockButtonTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Memoized resize mode handler
  const handleResizeMode = useCallback(() => {
    const modes = [
      {mode: 'none', name: 'Fit'},
      {mode: 'cover', name: 'Cover'},
      {mode: 'stretch', name: 'Stretch'},
      {mode: 'contain', name: 'Contain'},
    ];
    const index = modes.findIndex(mode => mode.mode === resizeMode);
    const nextMode = modes[(index + 1) % modes.length];
    setResizeMode(nextMode.mode);
    setToast('Resize Mode: ' + nextMode.name, 2000);
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
