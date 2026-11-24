import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Image, Text, View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {
  formatDownloadBytes,
  formatDownloadProgressLabel,
  formatDownloadSpeed,
} from '../../../lib/downloadFormatting';
import type {
  DownloadItem,
  DownloadStatus,
} from '../../../lib/zustand/downloadsStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import DownloadProgressBar from './DownloadProgressBar';
import DownloadConnectionsPanel from './DownloadConnectionsPanel';
import useDownloadConnectionsStore from '../../../lib/zustand/downloadConnectionsStore';

const statusLabels: Record<DownloadStatus, string> = {
  queued: 'Queued',
  starting: 'Starting',
  downloading: 'Downloading',
  pausing: 'Pausing',
  paused: 'Paused',
  finalizing: 'Finalizing',
  completed: 'Completed',
  interrupted: 'Interrupted',
  error: 'Failed',
  missing: 'Missing',
  canceling: 'Canceling',
};

const getSubtitle = (item: DownloadItem): string => {
  if (item.type === 'movie') {
    return 'Movie';
  }
  return (
    [item.seasonTitle, item.episodeName].filter(Boolean).join(' • ') ||
    'Episode'
  );
};

const CurrentDownloadRow = ({
  item,
  primary,
  onCancel,
  onPause,
  onResume,
  onRetry,
  onStartNow,
  firstActionRef,
  onFirstActionLayout,
}: {
  item: DownloadItem;
  primary: string;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onStartNow: () => void;
  firstActionRef?: React.RefObject<View | null>;
  onFirstActionLayout?: () => void;
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const progress =
    item.totalBytes > 0 ? item.downloadedBytes / item.totalBytes : 0;
  const failed = item.status === 'error' || item.status === 'interrupted';
  const canCancel = item.status !== 'canceling';
  const details = useDownloadConnectionsStore(
    state => state.details[item.id],
  );
  const [expanded, setExpanded] = useState(false);
  const showDetails = expanded && details && item.totalBytes > 0;

  return (
    <View
      className="mb-3 p-3"
      style={{
        backgroundColor: colors.surfaceContainerHigh,
        borderColor: colors.outlineVariant,
        borderRadius: 20,
        borderWidth: 1,
      }}>
      <TVFocusable
        testID={`download-details-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} connections for ${item.title}`}
        accessibilityState={{expanded}}
        disabled={!details}
        onPress={() => setExpanded(value => !value)}
        borderRadius={16}
        focusBorderColor={focusBorderColor}
        style={{flexDirection: 'row'}}>
        <View
          className="h-24 w-16 overflow-hidden"
          style={{
            backgroundColor: colors.surfaceContainerHighest,
            borderRadius: 16,
          }}>
          {item.poster ? (
            <Image
              source={{uri: item.poster}}
              className="h-full w-full"
              resizeMode="cover"
              resizeMethod="resize"
            />
          ) : (
            <View className="h-full w-full items-center justify-center">
              <MaterialCommunityIcons
                name="movie-open-outline"
                size={26}
                color={primary}
              />
            </View>
          )}
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text
                className="text-base font-semibold"
                style={{color: colors.onSurface}}
                numberOfLines={2}>
                {item.title}
              </Text>
              <Text
                className="mt-1 text-xs"
                style={{color: colors.onSurfaceVariant}}
                numberOfLines={1}>
                {getSubtitle(item)}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Text
                className="text-xs font-medium"
                style={{
                  color: failed ? colors.error : colors.onSurfaceVariant,
                }}>
                {statusLabels[item.status]}
              </Text>
              {details ? (
                <MaterialCommunityIcons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.onSurfaceVariant}
                />
              ) : null}
            </View>
          </View>

          <View className="mt-3">
            <DownloadProgressBar
              progress={progress}
              color={failed ? colors.error : primary}
            />
            <View className="mt-2 flex-row justify-between">
              <Text
                className="text-xs"
                style={{color: colors.onSurfaceVariant}}>
                {item.sourceType === 'hls' || item.videoType === 'm3u8'
                  ? formatDownloadProgressLabel(item)
                  : `${formatDownloadBytes(item.downloadedBytes)}${
                      item.totalBytes > 0
                        ? ` / ${formatDownloadBytes(item.totalBytes)}`
                        : ''
                    }`}
              </Text>
              {item.speed > 0 && (
                <Text
                  className="text-xs"
                  style={{color: colors.onSurfaceVariant}}>
                  {formatDownloadSpeed(item.speed)}
                </Text>
              )}
            </View>
          </View>
        </View>
      </TVFocusable>

      {showDetails && (
        <DownloadConnectionsPanel
          details={details}
          totalBytes={item.totalBytes}
          primary={primary}
        />
      )}

      {failed && item.errorMessage && (
        <Text className="mt-3 text-sm" style={{color: colors.error}}>
          {item.errorMessage}
        </Text>
      )}

      <View className="mt-3 flex-row justify-end gap-2">
        {item.status === 'queued' && (
          <TVFocusable
            testID={`start-now-download-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Start ${item.title} now`}
            onPress={onStartNow}
            borderRadius={14}
            focusScale={1.05}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: colors.secondaryContainer,
              borderRadius: 14,
              flexDirection: 'row',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <MaterialCommunityIcons
              name="play-circle-outline"
              size={18}
              color={colors.onSecondaryContainer}
            />
            <Text
              className="ml-1 text-sm font-bold"
              numberOfLines={1}
              style={{color: colors.onSecondaryContainer}}>
              Start now
            </Text>
          </TVFocusable>
        )}
        {item.canPause && item.status === 'downloading' && (
          <TVFocusable
            testID={`pause-download-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Pause download ${item.title}`}
            onPress={onPause}
            borderRadius={14}
            focusScale={1.05}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 14,
              flexDirection: 'row',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <MaterialCommunityIcons name="pause" size={18} color={primary} />
            <Text
              className="ml-1 text-sm font-medium"
              numberOfLines={1}
              style={{color: colors.onSurface}}>
              Pause
            </Text>
          </TVFocusable>
        )}
        {item.canResume && item.status === 'paused' && (
          <TVFocusable
            testID={`resume-download-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Resume download ${item.title}`}
            onPress={onResume}
            borderRadius={14}
            focusScale={1.05}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 14,
              flexDirection: 'row',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <MaterialCommunityIcons name="play" size={18} color={primary} />
            <Text
              className="ml-1 text-sm font-medium"
              numberOfLines={1}
              style={{color: colors.onSurface}}>
              Resume
            </Text>
          </TVFocusable>
        )}
        {failed && item.retryable && (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`Retry download ${item.title}`}
            onPress={onRetry}
            borderRadius={14}
            focusScale={1.05}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 14,
              flexDirection: 'row',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <MaterialCommunityIcons name="refresh" size={18} color={primary} />
            <Text
              className="ml-1 text-sm font-medium"
              numberOfLines={1}
              style={{color: colors.onSurface}}>
              Retry
            </Text>
          </TVFocusable>
        )}
        {canCancel && (
          <TVFocusable
            ref={firstActionRef}
            onLayout={onFirstActionLayout}
            hasTVPreferredFocus={Boolean(firstActionRef)}
            accessibilityRole="button"
            accessibilityLabel={`Cancel download ${item.title}`}
            onPress={onCancel}
            borderRadius={14}
            focusScale={1.05}
            focusBorderColor="#FFFFFF"
            style={{
              alignItems: 'center',
              backgroundColor: colors.errorContainer,
              borderRadius: 14,
              flexDirection: 'row',
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}>
            <MaterialCommunityIcons
              name="close"
              size={18}
              color={colors.onErrorContainer}
            />
            <Text
              className="ml-1 text-sm font-medium"
              numberOfLines={1}
              style={{color: colors.onErrorContainer}}>
              Cancel
            </Text>
          </TVFocusable>
        )}
      </View>
    </View>
  );
};

export default CurrentDownloadRow;
