import type {PlaybackTimeline} from '../../../lib/player/liveTimeline';
import React, {Dispatch, SetStateAction} from 'react';
import {
  // ImageBackground,
  SafeAreaView,
  StyleSheet,
  GestureResponderHandlers,
} from 'react-native';
import {NullControl} from './NullControl';
import {Seekbar} from './Seekbar';
import type {VideoAnimations} from '../types';
import type {SkipInterval} from '../../../lib/providers/types';
import {styles} from './styles';

interface BottomControlsProps {
  showControls: boolean;
  controlScale?: number;
  seekbarScale?: number;
  animations: VideoAnimations;
  panHandlers: GestureResponderHandlers;
  disableTimer: boolean;
  disableSeekbar: boolean;
  showDuration: boolean;
  showHours: boolean;
  paused: boolean;
  showTimeRemaining: boolean;
  currentTime: number;
  duration: number;
  timeline?: PlaybackTimeline;
  seekColor: string;
  toggleTimer: () => void;
  resetControlTimeout: () => void;
  seekerFillWidth: number;
  seekerPosition: number;
  setSeekerWidth: Dispatch<SetStateAction<number>>;
  isFullscreen: boolean;
  disableFullscreen: boolean;
  toggleFullscreen: () => void;
  cachedPosition: number;
  seeking: boolean;
  seekPreviewTime: number;
  seekThumbnailUri: string | null;
  seekThumbnailLoading: boolean;
  seekSnapPosition: number | null;
  skips?: SkipInterval[];
}

export const BottomControls = ({
  showControls,
  controlScale = 1,
  seekbarScale = 1,
  animations: {AnimatedView, ...animations},
  panHandlers,
  disableSeekbar,
  duration,
  timeline,
  seekColor,
  showDuration,
  showHours,
  showTimeRemaining,
  currentTime,
  toggleTimer,
  resetControlTimeout,
  seekerFillWidth,
  seekerPosition,
  setSeekerWidth,
  cachedPosition,
  seeking,
  seekPreviewTime,
  seekThumbnailUri,
  seekThumbnailLoading,
  seekSnapPosition,
  skips,
}: BottomControlsProps) => {
  const seekbarControl = disableSeekbar ? (
    <NullControl />
  ) : (
    <Seekbar
      controlScale={controlScale}
      seekbarScale={seekbarScale}
      seekerFillWidth={seekerFillWidth}
      seekerPosition={seekerPosition}
      seekColor={seekColor}
      seekerPanHandlers={panHandlers}
      setSeekerWidth={setSeekerWidth}
      cachedPosition={cachedPosition}
      showDuration={showDuration}
      showHours={showHours}
      showTimeRemaining={showTimeRemaining}
      duration={duration}
      timeline={timeline}
      time={currentTime}
      toggleTimer={toggleTimer}
      resetControlTimeout={resetControlTimeout}
      seeking={seeking}
      previewTime={seekPreviewTime}
      thumbnailUri={seekThumbnailUri}
      thumbnailLoading={seekThumbnailLoading}
      snapPosition={seekSnapPosition}
      skips={skips}
    />
  );

  return (
    <AnimatedView
      pointerEvents={showControls ? 'box-none' : 'none'}
      style={[
        _styles.bottom,
        animations.controlsOpacity,
        animations.bottomControl,
      ]}>
      <SafeAreaView style={styles.seekBarContainer}>
        {seekbarControl}
      </SafeAreaView>
    </AnimatedView>
  );
};

const _styles = StyleSheet.create({
  bottom: {
    alignItems: 'stretch',
    flex: 2,
    justifyContent: 'flex-end',
  },
  bottomControlGroup: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 12,
    marginRight: 12,
    marginBottom: 0,
  },
});
