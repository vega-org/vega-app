import React, {useRef} from 'react';
import {View} from 'react-native';
import ManagedEpisodeRow from '../../../components/ManagedEpisodeRow';
import LocalVideoThumbnail from '../../../components/local-content/LocalVideoThumbnail';
import {formatDownloadBytes} from '../../../lib/downloadFormatting';
import type {DownloadItem} from '../../../lib/zustand/downloadsStore';

interface DownloadedEpisodeRowProps {
  item: DownloadItem;
  isDeleting: boolean;
  onPlay: (item: DownloadItem) => void;
  onBeforePlay?: (control: View | null) => void;
  onDelete: (item: DownloadItem) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelection?: (item: DownloadItem) => void;
  onStartSelection?: (item: DownloadItem) => void;
}

export const DownloadedEpisodeRow: React.FC<DownloadedEpisodeRowProps> = ({
  item,
  isDeleting,
  onPlay,
  onBeforePlay,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelection,
  onStartSelection,
}) => {
  const controlRef = useRef<View>(null);
  return (
    <ManagedEpisodeRow
      controlRef={controlRef}
      title={item.episodeName || item.title}
      description={formatDownloadBytes(item.totalBytes)}
      thumbnail={<LocalVideoThumbnail uri={item.filePath} />}
      selecting={selecting}
      selected={selected}
      busy={isDeleting}
      onPress={() => {
        if (selecting) onToggleSelection?.(item);
        else {
          onBeforePlay?.(controlRef.current);
          onPlay(item);
        }
      }}
      onLongPress={() => onStartSelection?.(item)}
      onDelete={() => onDelete(item)}
    />
  );
};
export default React.memo(DownloadedEpisodeRow);
