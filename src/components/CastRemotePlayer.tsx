import React, {useCallback, useMemo, useState} from 'react';
import {
  ImageBackground,
  LayoutChangeEvent,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import GoogleCast, {
  CastButton,
  MediaPlayerState,
  RemoteMediaClient,
  useCastDevice,
  useMediaStatus,
  useStreamPosition,
} from 'react-native-google-cast';
import {settingsStorage} from '../lib/storage';

type CastRemotePlayerProps = {
  client: RemoteMediaClient;
  title?: string;
  subtitle?: string;
  artwork?: string;
  accentColor: string;
  onBack: () => void;
  onError?: (message: string) => void;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

// MaterialIcons only has numbered seek glyphs for these steps.
const SEEK_BACK_ICONS: Record<number, IconName> = {
  5: 'replay-5',
  10: 'replay-10',
  30: 'replay-30',
};
const SEEK_FORWARD_ICONS: Record<number, IconName> = {
  5: 'forward-5',
  10: 'forward-10',
  30: 'forward-30',
};

const CastRemotePlayer = ({
  client,
  title,
  subtitle,
  artwork,
  accentColor,
  onBack,
  onError,
}: CastRemotePlayerProps) => {
  const device = useCastDevice({ignoreSessionUpdatesInBackground: true});
  const mediaStatus = useMediaStatus();
  const streamPosition = useStreamPosition(0.5) || 0;
  const [seekSeconds] = useState(() => settingsStorage.getSeekInterval());
  const [showTimeRemaining, setShowTimeRemaining] = useState(() =>
    settingsStorage.isShowTimeRemaining(),
  );
  const [seekBarWidth, setSeekBarWidth] = useState(0);
  const [pendingAction, setPendingAction] = useState(false);

  const duration = mediaStatus?.mediaInfo?.streamDuration || 0;
  const isPlaying = mediaStatus?.playerState === MediaPlayerState.PLAYING;
  const isBuffering =
    mediaStatus?.playerState === MediaPlayerState.BUFFERING ||
    mediaStatus?.playerState === MediaPlayerState.LOADING;
  const progress = duration > 0 ? Math.min(streamPosition / duration, 1) : 0;

  const deviceLabel = useMemo(
    () => device?.friendlyName || 'Cast device',
    [device?.friendlyName],
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>, errorMessage: string) => {
      if (pendingAction) {
        return;
      }

      setPendingAction(true);
      try {
        await action();
      } catch (error) {
        console.warn(errorMessage, error);
        onError?.(errorMessage);
      } finally {
        setPendingAction(false);
      }
    },
    [onError, pendingAction],
  );

  const togglePlayback = useCallback(() => {
    runAction(
      () => (isPlaying ? client.pause() : client.play()),
      'Could not control Cast playback',
    );
  }, [client, isPlaying, runAction]);

  const seekBy = useCallback(
    (offset: number) => {
      const position = Math.max(
        0,
        duration > 0
          ? Math.min(streamPosition + offset, duration)
          : streamPosition + offset,
      );
      runAction(
        () => client.seek({position}),
        'Could not seek on the Cast device',
      );
    },
    [client, duration, runAction, streamPosition],
  );

  const seekFromPress = useCallback(
    (locationX: number) => {
      if (!duration || !seekBarWidth) {
        return;
      }

      const position =
        Math.max(0, Math.min(locationX / seekBarWidth, 1)) * duration;
      runAction(
        () => client.seek({position}),
        'Could not seek on the Cast device',
      );
    },
    [client, duration, runAction, seekBarWidth],
  );

  const stopCasting = useCallback(() => {
    runAction(
      () => GoogleCast.getSessionManager().endCurrentSession(true),
      'Could not stop casting',
    );
  }, [runAction]);

  const handleSeekBarLayout = useCallback((event: LayoutChangeEvent) => {
    setSeekBarWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <ImageBackground
      source={artwork ? {uri: artwork} : undefined}
      resizeMode="cover"
      resizeMethod="resize"
      className="flex-1 bg-black">
      <View className="absolute inset-0 bg-black/70" />

      <View className="absolute top-5 left-5 right-5 z-20 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-6">
          <TouchableOpacity
            accessibilityLabel="Leave player"
            onPress={onBack}
            className="w-11 h-11 rounded-full bg-black/45 items-center justify-center mr-3">
            <MaterialIcons name="arrow-back" size={27} color="white" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-white text-lg font-semibold" numberOfLines={1}>
              {title || 'Vega'}
            </Text>
            {!!subtitle && (
              <Text className="text-white/65 text-xs mt-0.5" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        <View className="w-11 h-11 rounded-full bg-black/45 items-center justify-center">
          <CastButton
            accessibilityLabel="Cast options"
            tintColor="white"
            style={{width: 26, height: 26}}
          />
        </View>
      </View>

      <View className="flex-1 items-center justify-center px-12 pb-20">
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-5"
          style={{backgroundColor: `${accentColor}33`}}>
          <MaterialIcons name="cast-connected" size={42} color={accentColor} />
        </View>
        <Text className="text-white/65 text-sm">Playing on</Text>
        <Text className="text-white text-2xl font-semibold mt-1" numberOfLines={1}>
          {deviceLabel}
        </Text>
        <Text
          className="text-white/80 text-base mt-3 max-w-[70%] text-center"
          numberOfLines={2}>
          {subtitle || title}
        </Text>
      </View>

      <View className="absolute left-8 right-8 bottom-5 rounded-3xl bg-black/75 border border-white/10 px-6 py-4">
        <View className="flex-row items-center">
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              showTimeRemaining ? 'Show total duration' : 'Show remaining time'
            }
            onPress={() => {
              setShowTimeRemaining(prev => {
                const next = !prev;
                settingsStorage.setShowTimeRemaining(next);
                return next;
              });
            }}>
            <Text className="text-white/70 text-xs w-14">
              {formatTime(streamPosition)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Cast playback position"
            onLayout={handleSeekBarLayout}
            onPress={event => seekFromPress(event.nativeEvent.locationX)}
            className="flex-1 h-7 justify-center mx-3">
            <View className="h-1 rounded-full bg-white/25 overflow-hidden">
              <View
                className="h-full rounded-full"
                style={{width: `${progress * 100}%`, backgroundColor: accentColor}}
              />
            </View>
          </Pressable>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              showTimeRemaining ? 'Show total duration' : 'Show remaining time'
            }
            onPress={() => {
              setShowTimeRemaining(prev => {
                const next = !prev;
                settingsStorage.setShowTimeRemaining(next);
                return next;
              });
            }}>
            <Text className="text-white/70 text-xs w-14 text-right">
              {showTimeRemaining && duration > 0
                ? `-${formatTime(Math.max(0, duration - streamPosition))}`
                : formatTime(duration)}
            </Text>
          </Pressable>
        </View>

        <View className="flex-row items-center justify-center mt-2 gap-7">
          <TouchableOpacity
            accessibilityLabel={`Seek backward ${seekSeconds} seconds`}
            disabled={pendingAction}
            onPress={() => seekBy(-seekSeconds)}
            className="w-11 h-11 rounded-full bg-white/10 items-center justify-center">
            <MaterialIcons
              name={SEEK_BACK_ICONS[seekSeconds] ?? 'fast-rewind'}
              size={26}
              color="white"
            />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel={isPlaying ? 'Pause casting' : 'Play casting'}
            disabled={pendingAction}
            onPress={togglePlayback}
            className="w-14 h-14 rounded-full items-center justify-center"
            style={{backgroundColor: accentColor}}>
            <MaterialIcons
              name={isBuffering ? 'hourglass-top' : isPlaying ? 'pause' : 'play-arrow'}
              size={34}
              color="black"
            />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel={`Seek forward ${seekSeconds} seconds`}
            disabled={pendingAction}
            onPress={() => seekBy(seekSeconds)}
            className="w-11 h-11 rounded-full bg-white/10 items-center justify-center">
            <MaterialIcons
              name={SEEK_FORWARD_ICONS[seekSeconds] ?? 'fast-forward'}
              size={26}
              color="white"
            />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel="Stop casting"
            disabled={pendingAction}
            onPress={stopCasting}
            className="absolute right-0 flex-row items-center rounded-full bg-white/10 px-4 h-11">
            <MaterialIcons name="stop-circle" size={22} color="white" />
            <Text className="text-white text-xs ml-2">Stop casting</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ImageBackground>
  );
};

export default CastRemotePlayer;
