import React, {Dispatch, SetStateAction, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  View,
  GestureResponderHandlers,
  Image,
  Platform,
  Pressable,
  Text,
} from 'react-native';
import {styles} from './styles';
import {formatTime} from '../../utils';
import type {SkipInterval} from '../../../../lib/providers/types';

interface SeekbarProps {
  controlScale?: number;
  seekbarScale?: number;
  seekerFillWidth: number;
  seekerPosition: number;
  seekColor: string;
  cachedPosition: number;
  seekerPanHandlers: GestureResponderHandlers;
  setSeekerWidth: Dispatch<SetStateAction<number>>;
  time?: number;
  duration: number;
  showDuration: boolean;
  showTimeRemaining: boolean;
  showHours: boolean;
  toggleTimer: () => void;
  resetControlTimeout: () => void;
  seeking: boolean;
  previewTime: number;
  thumbnailUri: string | null;
  thumbnailLoading: boolean;
  snapPosition: number | null;
  skips?: SkipInterval[];
}

const PREVIEW_WIDTH = 160;

export const Seekbar = ({
  seekColor,
  controlScale = 1,
  seekbarScale = 1,
  seekerFillWidth,
  seekerPosition,
  cachedPosition,
  seekerPanHandlers,
  setSeekerWidth,
  showDuration,
  showHours,
  showTimeRemaining,
  time,
  duration,
  toggleTimer,
  resetControlTimeout,
  seeking,
  previewTime,
  thumbnailUri,
  thumbnailLoading,
  snapPosition,
  skips,
}: SeekbarProps) => {
  const size = controlScale * seekbarScale;
  const [trackWidth, setTrackWidth] = useState(0);
  const previewLeft = useMemo(
    () =>
      Math.max(
        0,
        Math.min(
          Math.max(0, trackWidth - PREVIEW_WIDTH),
          seekerPosition - PREVIEW_WIDTH / 2,
        ),
      ),
    [seekerPosition, trackWidth],
  );
  const timestampStyle = {
    color: 'hsl(0, 0%, 70%)',
    fontSize: 12 * controlScale,
    lineHeight: 16 * controlScale,
    includeFontPadding: false,
    fontWeight: '300' as const,
    letterSpacing: 0.2,
  };

  return (
    <View
      style={{
        // Bottom row retains a 44dp touch target when controls shrink.
        marginBottom: 10 + Math.max(44, 44 * controlScale) + controlScale,
        paddingHorizontal: 12,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <Pressable
        hitSlop={12}
        // TV uses the Player timeline; this toggle has no focus ring there.
        focusable={!Platform.isTV}
        accessibilityRole="button"
        accessibilityLabel={
          showTimeRemaining ? 'Show total duration' : 'Show remaining time'
        }
        onPress={() => {
          toggleTimer();
          resetControlTimeout();
        }}>
        <Text style={timestampStyle}>
          {formatTime({
            duration,
            time,
            showDuration,
            showHours,
            showTimeRemaining: false,
          })}
        </Text>
      </Pressable>
      <View
        style={{...styles.container, width: '80%', height: 20 * size, alignSelf: 'center', flexShrink: 1, minWidth: 0}}
        collapsable={false}
        {...seekerPanHandlers}>
        {seeking && trackWidth > 0 ? (
          <View style={[styles.preview, {left: previewLeft, bottom: 30 * size}]} pointerEvents="none">
            {thumbnailUri ? (
              <Image
                key={thumbnailUri}
                source={{uri: thumbnailUri}}
                style={styles.previewImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.previewPlaceholder} />
            )}
            {thumbnailLoading ? (
              <View style={styles.previewLoading}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : null}
            <View style={styles.previewTimestampContainer}>
              <Text style={styles.previewTimestamp}>
                {(() => {
                  const formattedPreview = formatTime({
                    duration,
                    time: previewTime,
                    showDuration,
                    showHours,
                    showTimeRemaining: false,
                  });
                  if (time !== undefined && Math.abs(previewTime - time) >= 1) {
                    const diff = Math.round(previewTime - time);
                    const diffSign = diff > 0 ? '+' : '-';
                    const absDiff = Math.abs(diff);
                    const diffFormatted = formatTime({
                      duration: absDiff,
                      time: absDiff,
                      showDuration: false,
                      showHours: absDiff >= 3600,
                      showTimeRemaining: false,
                    });
                    return `${formattedPreview} (${diffSign}${diffFormatted})`;
                  }
                  return formattedPreview;
                })()}
              </Text>
            </View>
          </View>
        ) : null}
        <View
          style={[styles.track, {height: 2 * size, top: 9 * size, borderRadius: size}]}
          onLayout={event => {
            const width = event.nativeEvent.layout.width;
            if (width > 0 && Math.abs(width - trackWidth) > 1) {
              setTrackWidth(width);
              setSeekerWidth(width);
            }
          }}
          pointerEvents="none">
          <View
            style={{
              width: cachedPosition,
              backgroundColor: '#dedede',
              height: 2 * size,
              position: 'absolute',
              top: 0,
              borderRadius: size,
            }}
            pointerEvents="none"
          />
          <View
            style={[
              styles.fill,
              {
                width: seekerFillWidth,
                height: 2 * size,
                borderRadius: size,
                backgroundColor: seekColor || '#FFF',
              },
            ]}
            pointerEvents="none"
          />
          {duration > 0 && trackWidth > 0 && skips && skips.length > 0
            ? skips.map((skip, idx) => {
                const gaps = [];
                if (skip.from > 0 && skip.from < duration) {
                  const leftPos = (skip.from / duration) * trackWidth;
                  gaps.push(
                    <View
                      key={`skip-from-${idx}-${skip.from}`}
                      style={{
                        position: 'absolute',
                        left: Math.max(0, leftPos - 1.5 * size),
                        top: 0,
                        width: 3 * size,
                        height: 2 * size,
                        backgroundColor: '#000000',
                        zIndex: 3,
                      }}
                      pointerEvents="none"
                    />,
                  );
                }
                if (skip.to > 0 && skip.to < duration) {
                  const leftPos = (skip.to / duration) * trackWidth;
                  gaps.push(
                    <View
                      key={`skip-to-${idx}-${skip.to}`}
                      style={{
                        position: 'absolute',
                        left: Math.max(0, leftPos - 1.5 * size),
                        top: 0,
                        width: 3 * size,
                        height: 2 * size,
                        backgroundColor: '#000000',
                        zIndex: 3,
                      }}
                      pointerEvents="none"
                    />,
                  );
                }
                return gaps;
              })
            : null}
        </View>
        {seeking && snapPosition !== null ? (
          <View
            style={[styles.snapMarker, {left: snapPosition - size, top: 4 * size, width: 2 * size, height: 12 * size, borderRadius: size}]}
            pointerEvents="none"
          />
        ) : null}
        <View
          style={[styles.handle, {left: seekerPosition, top: 0, marginLeft: -12 * size, width: 24 * size, height: 24 * size}]}
          pointerEvents="none">
          <View
            style={[styles.circle, {backgroundColor: seekColor || '#FFF', top: 6 * size, left: 8 * size, width: 8 * size, height: 8 * size, borderRadius: 4 * size}]}
            pointerEvents="none"
          />
        </View>
      </View>
      <Pressable
        hitSlop={12}
        focusable={!Platform.isTV}
        accessibilityRole="button"
        accessibilityLabel={
          showTimeRemaining ? 'Show total duration' : 'Show remaining time'
        }
        onPress={() => {
          toggleTimer();
          resetControlTimeout();
        }}>
        <Text style={timestampStyle}>
          {formatTime({
            duration,
            time: showTimeRemaining
              ? Math.max(0, duration - (time ?? 0))
              : duration,
            showDuration,
            showHours,
            showTimeRemaining,
          })}
        </Text>
      </Pressable>
    </View>
  );
};
