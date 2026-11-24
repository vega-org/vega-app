import {Dispatch, SetStateAction, useEffect, useRef} from 'react';
import {PanResponder} from 'react-native';

interface PanRespondersProps {
  duration: number;
  isLive?: boolean;
  volumeOffset: number;
  loading: boolean;
  seekerPosition: number;
  seek?: (time: number, tolerance?: number) => void;
  seekerWidth: number;
  clearControlTimeout: () => void;
  setVolumePosition: (position: number) => void;
  setSeekerPosition: (position: number) => void;
  setSeeking: Dispatch<SetStateAction<boolean>>;
  setSeekSnapPosition: Dispatch<SetStateAction<number | null>>;
  setControlTimeout: () => void;
  onEnd: () => void;
  onSeekSnap?: () => void;
  horizontal?: boolean;
  inverted?: boolean;
}

export const usePanResponders = ({
  duration,
  isLive = false,
  volumeOffset,
  loading,
  seekerPosition,
  seek,
  seekerWidth,
  clearControlTimeout,
  setVolumePosition,
  setSeekerPosition,
  setSeeking,
  setSeekSnapPosition,
  setControlTimeout,
  onEnd,
  onSeekSnap,
  horizontal = true,
  inverted = false,
}: PanRespondersProps) => {
  const propsRef = useRef({
    duration,
    isLive,
    volumeOffset,
    loading,
    seekerWidth,
    seek,
    clearControlTimeout,
    setVolumePosition,
    setSeekerPosition,
    setSeeking,
    setSeekSnapPosition,
    setControlTimeout,
    onEnd,
    onSeekSnap,
    horizontal,
    inverted,
  });

  propsRef.current = {
    duration,
    isLive,
    volumeOffset,
    loading,
    seekerWidth,
    seek,
    clearControlTimeout,
    setVolumePosition,
    setSeekerPosition,
    setSeeking,
    setSeekSnapPosition,
    setControlTimeout,
    onEnd,
    onSeekSnap,
    horizontal,
    inverted,
  };

  const latestSeekerPosition = useRef(seekerPosition);
  const seekStartPosition = useRef(0);
  const dragStartPosition = useRef(0);
  const seekTrackPageOffset = useRef(0);
  const hasLeftStartPoint = useRef(false);
  const isSnappedToStart = useRef(false);

  const SNAP_ENTER_DISTANCE = 12;
  const SNAP_EXIT_DISTANCE = 24;

  useEffect(() => {
    latestSeekerPosition.current = seekerPosition;
  }, [seekerPosition]);

  const respondersRef = useRef<{
    volumePanResponder: any;
    seekPanResponder: any;
  } | null>(null);

  if (!respondersRef.current) {
    const volumePanResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        propsRef.current.clearControlTimeout();
      },
      onPanResponderMove: (_evt, gestureState) => {
        const { horizontal: h, inverted: inv, volumeOffset: vOff, setVolumePosition: setVPos } = propsRef.current;
        const diff = h ? gestureState.dx : gestureState.dy;
        const position = vOff + diff * (inv ? -1 : 1);
        setVPos(position);
      },
      onPanResponderRelease: () => {
        propsRef.current.setControlTimeout();
      },
    });

    const seekPanResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => propsRef.current.duration > 0,
      onMoveShouldSetPanResponder: () => propsRef.current.duration > 0,
      onPanResponderGrant: (evt) => {
        const {
          setSeeking: setSeek,
          clearControlTimeout: clearTimeout,
          horizontal: h,
          inverted: inv,
          seekerWidth: sWidth,
          setSeekSnapPosition: setSnapPos,
          setSeekerPosition: setSPos,
        } = propsRef.current;

        setSeek(true);
        clearTimeout();
        const localPointer = h
          ? evt.nativeEvent.locationX
          : evt.nativeEvent.locationY;
        const pagePointer = h
          ? evt.nativeEvent.pageX
          : evt.nativeEvent.pageY;

        seekTrackPageOffset.current = pagePointer - localPointer;
        const position = inv ? sWidth - localPointer : localPointer;
        const playbackPosition = Math.max(
          0,
          Math.min(sWidth, latestSeekerPosition.current),
        );

        seekStartPosition.current = playbackPosition;
        dragStartPosition.current = position;
        hasLeftStartPoint.current = false;
        isSnappedToStart.current = false;
        setSnapPos(playbackPosition);
        latestSeekerPosition.current = position;
        setSPos(position);
      },
      onPanResponderMove: (_evt, gestureState) => {
        const {
          horizontal: h,
          inverted: inv,
          seekerWidth: sWidth,
          setSeekerPosition: setSPos,
          setSeeking: setSeek,
          onSeekSnap: onSnap,
        } = propsRef.current;

        const pagePointer = h ? gestureState.moveX : gestureState.moveY;
        const pointerPosition = pagePointer - seekTrackPageOffset.current;
        const fallbackDiff = h ? gestureState.dx : gestureState.dy;
        const fallbackPosition =
          dragStartPosition.current + fallbackDiff * (inv ? -1 : 1);
        const rawPosition = Number.isFinite(pointerPosition)
          ? inv
            ? sWidth - pointerPosition
            : pointerPosition
          : fallbackPosition;
        const distanceFromStart = Math.abs(
          rawPosition - seekStartPosition.current,
        );

        if (
          !hasLeftStartPoint.current &&
          distanceFromStart >= SNAP_EXIT_DISTANCE
        ) {
          hasLeftStartPoint.current = true;
        }

        let position = rawPosition;
        if (hasLeftStartPoint.current) {
          if (isSnappedToStart.current) {
            if (distanceFromStart <= SNAP_EXIT_DISTANCE) {
              position = seekStartPosition.current;
            } else {
              isSnappedToStart.current = false;
            }
          } else if (distanceFromStart <= SNAP_ENTER_DISTANCE) {
            isSnappedToStart.current = true;
            position = seekStartPosition.current;
            onSnap?.();
          }
        }

        latestSeekerPosition.current = position;
        setSPos(position);
        setSeek(true);
      },
      onPanResponderRelease: () => {
        const {
          seekerWidth: sWidth,
          duration: dur,
          loading: isLoading,
          onEnd: handleEnd,
          setSeeking: setSeek,
          setSeekSnapPosition: setSnapPos,
          seek: doSeek,
          setControlTimeout: setTimeoutFn,
        } = propsRef.current;

        const constrainedPosition = Math.max(
          0,
          Math.min(sWidth, latestSeekerPosition.current),
        );
        const percent = sWidth > 0 ? constrainedPosition / sWidth : 0;
        const time = dur * percent;

        if (!propsRef.current.isLive && dur > 0 && time >= dur && !isLoading) {
          if (typeof handleEnd === 'function') {
            handleEnd();
          }
        }

        setSeek(false);
        setSnapPos(null);
        doSeek && doSeek(time);
        setTimeoutFn();
      },
      onPanResponderTerminate: () => {
        const {
          seekerWidth: sWidth,
          duration: dur,
          setSeeking: setSeek,
          setSeekSnapPosition: setSnapPos,
          seek: doSeek,
          setControlTimeout: setTimeoutFn,
        } = propsRef.current;

        const constrainedPosition = Math.max(
          0,
          Math.min(sWidth, latestSeekerPosition.current),
        );
        const percent = sWidth > 0 ? constrainedPosition / sWidth : 0;
        setSeek(false);
        setSnapPos(null);
        doSeek && doSeek(dur * percent);
        setTimeoutFn();
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });

    respondersRef.current = { volumePanResponder, seekPanResponder };
  }

  return respondersRef.current;
};
