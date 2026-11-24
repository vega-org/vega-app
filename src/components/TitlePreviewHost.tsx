import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Video, {ResizeMode, ViewType, type VideoRef} from 'react-native-video';
import {isTV} from '../lib/tv';
import useTitlePreviewStore, {
  type ActiveTitlePreview,
} from '../lib/zustand/titlePreviewStore';
import {TVFocusable} from './tv';

const DEFAULT_PREVIEW_ASPECT_RATIO = 16 / 9;

function TitlePreviewOverlay({
  activePreview,
  onDismiss,
}: {
  activePreview: ActiveTitlePreview;
  onDismiss: () => void;
}) {
  const {height: windowHeight} = useWindowDimensions();
  const [hasAudio, setHasAudio] = useState(false);
  const [muted, setMuted] = useState(true);
  const [useGifFallback, setUseGifFallback] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_PREVIEW_ASPECT_RATIO);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const videoRef = useRef<VideoRef>(null);
  const seekWidth = useRef(0);
  const isScrubbing = useRef(false);

  const seek = (seconds: number) => {
    const target = Math.max(0, Math.min(duration, seconds));
    setPosition(target);
    videoRef.current?.seek(target);
  };
  const timeAt = (x: number) => Math.max(0, Math.min(1, x / Math.max(seekWidth.current, 1))) * duration;

  useEffect(() => {
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        onDismiss();
      }
    });
    return () => {
      backSub.remove();
      appStateSub.remove();
    };
  }, [onDismiss]);

  const effectiveMediaType = useGifFallback
    ? 'gif'
    : activePreview.preview.mediaType;
  const maxStageHeight = Math.max(180, Math.round(windowHeight * 0.52));

  const handleOpen = useCallback(() => {
    const openDetails = activePreview.onOpenDetails;
    onDismiss();
    openDetails?.();
  }, [activePreview.onOpenDetails, onDismiss]);

  return (
    <View
      pointerEvents={activePreview.dismissOnRelease ? 'none' : 'auto'}
      accessibilityViewIsModal={!activePreview.dismissOnRelease}
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: 1200,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
          backgroundColor: 'rgba(0, 0, 0, 0.72)',
        },
      ]}>
      {!activePreview.dismissOnRelease ? (
        <Pressable
          accessibilityLabel="Dismiss preview"
          focusable={false}
          accessible={false}
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: '#000000',
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.45,
          shadowRadius: 18,
          shadowOffset: {width: 0, height: 8},
        }}>
        <View
          style={{
            width: '100%',
            aspectRatio,
            maxHeight: maxStageHeight,
            backgroundColor: '#000000',
            overflow: 'hidden',
            justifyContent: 'center',
            alignItems: 'center',
          }}>
          {effectiveMediaType === 'gif' ? (
            <Image
              source={{
                uri: activePreview.preview.url,
                headers: activePreview.preview.headers,
              }}
              resizeMode="contain"
              style={StyleSheet.absoluteFill}
              onError={onDismiss}
            />
          ) : null}

          {effectiveMediaType === 'video' ? (
            <Video
              ref={videoRef}
              source={{
                uri: activePreview.preview.url,
                headers: activePreview.preview.headers,
              }}
              viewType={ViewType.TEXTURE}
              resizeMode={ResizeMode.CONTAIN}
              repeat
              muted={muted}
              disableFocus={muted}
              controls={false}
              hideShutterView
              playInBackground={false}
              playWhenInactive={false}
              style={StyleSheet.absoluteFill}
              onLoad={data => {
                setDuration(Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0);
                const width = data.naturalSize?.width;
                const height = data.naturalSize?.height;
                if (
                  typeof width === 'number' &&
                  typeof height === 'number' &&
                  width > 0 &&
                  height > 0
                ) {
                  setAspectRatio(Math.min(16 / 9, Math.max(0.75, width / height)));
                }
                if (data.audioTracks?.length) setHasAudio(true);
              }}
              onAudioTracks={({audioTracks}) => {
                if (audioTracks.length) setHasAudio(true);
              }}
              onProgress={({currentTime}) => {
                if (!isScrubbing.current) setPosition(currentTime);
              }}
              onError={() => {
                if (!activePreview.preview.explicitType && !useGifFallback) {
                  setUseGifFallback(true);
                } else {
                  onDismiss();
                }
              }}
            />
          ) : null}

          {!activePreview.dismissOnRelease && activePreview.onOpenDetails ? (
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Open title"
              hasTVPreferredFocus={isTV}
              onPress={handleOpen}
              style={StyleSheet.absoluteFill}
              children={null}
            />
          ) : null}

          {!activePreview.dismissOnRelease &&
          effectiveMediaType === 'video' &&
          hasAudio ? (
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel={muted ? 'Unmute preview' : 'Mute preview'}
              onPress={() => setMuted(value => !value)}
              borderRadius={20}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <MaterialCommunityIcons
                name={muted ? 'volume-off' : 'volume-high'}
                size={20}
                color="#FFFFFF"
              />
            </TVFocusable>
          ) : null}
          {!activePreview.dismissOnRelease && effectiveMediaType === 'video' && duration > 0 ? (
            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Preview position"
              accessibilityValue={{min: 0, max: Math.ceil(duration), now: Math.floor(Math.min(position, duration))}}
              accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
              onAccessibilityAction={({nativeEvent}) => seek(position + (nativeEvent.actionName === 'increment' ? 5 : -5))}
              onLayout={({nativeEvent}) => {seekWidth.current = nativeEvent.layout.width;}}
              onStartShouldSetResponder={() => true}
              onResponderGrant={({nativeEvent}) => {
                isScrubbing.current = true;
                setPosition(timeAt(nativeEvent.locationX));
              }}
              onResponderMove={({nativeEvent}) => setPosition(timeAt(nativeEvent.locationX))}
              onResponderRelease={({nativeEvent}) => {
                isScrubbing.current = false;
                seek(timeAt(nativeEvent.locationX));
              }}
              onResponderTerminate={() => {isScrubbing.current = false;}}
              style={{position: 'absolute', left: 14, right: 14, bottom: 0, height: 36, justifyContent: 'center'}}>
              <View pointerEvents="none" style={{height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)'}}>
                <View style={{width: `${Math.min(100, position / duration * 100)}%`, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF'}} />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const TitlePreviewHost = () => {
  const activePreview = useTitlePreviewStore(state => state.activePreview);
  const dismissPreview = useTitlePreviewStore(state => state.dismissPreview);
  const handleDismiss = useCallback(() => dismissPreview(), [dismissPreview]);

  if (!activePreview) {
    return null;
  }

  return (
    <TitlePreviewOverlay
      key={activePreview.sessionId}
      activePreview={activePreview}
      onDismiss={handleDismiss}
    />
  );
};

export default TitlePreviewHost;
