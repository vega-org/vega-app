import {openExternalApp as launchDownloadApp, usesExternalApp} from '../lib/externalApps';
import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, ToastAndroid, Pressable, UIManager, findNodeHandle } from 'react-native';
import { ifExists } from '../lib/file/ifExists';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Octicons from '@expo/vector-icons/Octicons';
import { Stream, SkipInterval } from '../lib/providers/types';
import Svg, { Circle, Path } from 'react-native-svg';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import useContentStore from '../lib/zustand/contentStore';
import { cancelDownload } from '../lib/downloadManager';
import { downloadManager } from '../lib/downloader';
import DownloadBottomSheet from './DownloadBottomSheet';
import LoadingIndicator from './ui/LoadingIndicator';
import { settingsStorage } from '../lib/storage';
import { useTVFocusBorderColor } from '../lib/tv/useTVFocusBorderColor';
import { isTV } from '../lib/tv';
import { TVFocusable } from './tv';
import { providerManager } from '../lib/services/ProviderManager';
import {
  deleteDownloadedFileByBaseName,
  LEGACY_SUBTITLE_EXTENSIONS,
} from '../lib/downloadLocation';
import { deleteDownloadOutput } from '../lib/downloadDestination';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
  createSubtitleFileName,
  isSubtitleDownloadItem,
} from '../lib/downloadId';
import useDownloadsStore, {
  CURRENT_DOWNLOAD_STATUSES,
} from '../lib/zustand/downloadsStore';
import {useShallow} from 'zustand/react/shallow';
import {
  selectDownloadLocation,
  validateDownloadLocationAccess,
} from '../lib/downloadLocation';
import DownloadLocationDialog from './DownloadLocationDialog';
import { useM3Colors } from '../theme/M3PaletteContext';
import { LEGACY_TERTIARY_BACKGROUND } from '../theme/seeds';
import { showAppDialog } from '../lib/zustand/appDialogStore';

const DOWNLOAD_PROGRESS_SIZE = 42;
const DOWNLOAD_PROGRESS_RADIUS = 18;
const DOWNLOAD_PROGRESS_CENTER = DOWNLOAD_PROGRESS_SIZE / 2;

const createProgressPiePath = (progress: number) => {
  if (progress <= 0 || progress >= 1) {
    return undefined;
  }
  const endAngle = progress * Math.PI * 2 - Math.PI / 2;
  const endX =
    DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.cos(endAngle);
  const endY =
    DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.sin(endAngle);
  const largeArcFlag = progress > 0.5 ? 1 : 0;

  return [
    `M ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER}`,
    `L ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER - DOWNLOAD_PROGRESS_RADIUS
    }`,
    `A ${DOWNLOAD_PROGRESS_RADIUS} ${DOWNLOAD_PROGRESS_RADIUS} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
    'Z',
  ].join(' ');
};

const DownloadProgress = ({
  downloadedBytes,
  totalBytes,
  color,
}: {
  downloadedBytes: number;
  totalBytes: number;
  color: string;
}) => {
  const hasKnownTotal = totalBytes > 0;
  const progress = hasKnownTotal
    ? Math.min(1, Math.max(0, downloadedBytes / totalBytes))
    : 0;
  const progressPath = createProgressPiePath(progress);

  return (
    <View
      style={{
        alignItems: 'center',
        height: DOWNLOAD_PROGRESS_SIZE,
        justifyContent: 'center',
        width: DOWNLOAD_PROGRESS_SIZE,
      }}>
      <Svg
        height={DOWNLOAD_PROGRESS_SIZE}
        width={DOWNLOAD_PROGRESS_SIZE}
        style={{ position: 'absolute' }}>
        <Circle
          cx={DOWNLOAD_PROGRESS_CENTER}
          cy={DOWNLOAD_PROGRESS_CENTER}
          r={DOWNLOAD_PROGRESS_RADIUS}
          fill="rgba(255,255,255,0.16)"
        />
        {progress >= 1 ? (
          <Circle
            cx={DOWNLOAD_PROGRESS_CENTER}
            cy={DOWNLOAD_PROGRESS_CENTER}
            r={DOWNLOAD_PROGRESS_RADIUS}
            fill={color}
          />
        ) : progressPath ? (
          <Path d={progressPath} fill={color} />
        ) : null}
      </Svg>
      {!hasKnownTotal ? (
        <MaterialIcons name="downloading" size={24} color={color} />
      ) : null}
    </View>
  );
};

type PendingDownload = {
  downloadId: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  mediaType: 'movie' | 'series';
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  provider?: string;
  server?: string;
  quality?: string;
  isSubtitle?: boolean;
  infoUrl?: string;
  sourceLink?: string;
  url: string;
  fileName: string;
  fileType: string;
  headers?: Record<string, string>;
  subtitles?: Array<{ url: string; language: string; format?: string }>;
  skip?: SkipInterval[];
  deleteDownload: () => void;
};

const DownloadComponent = ({
  link,
  downloadId,
  fileName,
  type,
  mediaType,
  providerValue,
  title,
  showName,
  episodeName,
  seasonTitle,
  episodeIndex,
  imdbId,
  poster,
  background,
  synopsis,
  infoUrl,
  quickDownload,
  skip,
}: {
  link: string;
  downloadId: string;
  fileName: string;
  type: string;
  mediaType: 'movie' | 'series';
  providerValue: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  infoUrl?: string;
  quickDownload?: boolean;
  skip?: SkipInterval[];
}) => {
  const colors = useM3Colors();
  const primary = colors.primary;
  const focusBorderColor = useTVFocusBorderColor(primary);
  const provider = useContentStore(state => state.provider);

  const videoDownload = useDownloadsStore(
    state =>
      (state.downloads[downloadId] &&
        !isSubtitleDownloadItem(state.downloads[downloadId])
        ? state.downloads[downloadId]
        : null) ||
      Object.values(state.downloads).find(
        item =>
          !isSubtitleDownloadItem(item) &&
          item.infoUrl === infoUrl &&
          item.sourceLink === link,
      ),
  );

  // useShallow: the filter returns a new array on every store change, which
  // re-rendered every episode row on each download progress update.
  const subDownloads = useDownloadsStore(
    useShallow(state =>
      Object.values(state.downloads).filter(
        item =>
          isSubtitleDownloadItem(item) &&
          (item.id.startsWith(`${downloadId}_subtitle_`) ||
            (item.infoUrl === infoUrl && item.sourceLink === link)),
      ),
    ),
  );

  const removeDownload = useDownloadsStore(state => state.removeDownload);
  const [legacyDownloadedFile, setLegacyDownloadedFile] = useState<
    string | boolean
  >(false);
  const [downloadModal, setDownloadModal] = useState(false);
  const downloadButtonRef = React.useRef<View>(null);
  const setDownloadModalWithFocus = (visible: boolean) => {
    setDownloadModal(visible);
    if (!visible && isTV) {
      setTimeout(() => {
        const handle = findNodeHandle(downloadButtonRef.current);
        if (handle) {
          UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
        }
      }, 150);
    }
  };
  const [servers, setServers] = useState<Stream[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] =
    useState<PendingDownload | null>(null);
  const [locationDialogVisible, setLocationDialogVisible] = useState(false);
  const [selectingLocation, setSelectingLocation] = useState(false);

  const isVideoActive = Boolean(
    videoDownload && CURRENT_DOWNLOAD_STATUSES.has(videoDownload.status),
  );
  const activeSubDownload = subDownloads.find(sub =>
    CURRENT_DOWNLOAD_STATUSES.has(sub.status),
  );
  const downloadActive = isVideoActive || Boolean(activeSubDownload);
  const currentActiveDownload =
    videoDownload && isVideoActive ? videoDownload : activeSubDownload;

  const isVideoDownloaded =
    videoDownload?.status === 'completed' || Boolean(legacyDownloadedFile);
  const hasDownloadedSubs = subDownloads.some(
    sub => sub.status === 'completed',
  );

  const downloadedSubsList = subDownloads
    .filter(s => s.status === 'completed')
    .map(s => {
      let subTitle = s.episodeName || s.title;
      if (s.id.includes('_subtitle_')) {
        const parts = s.id.split('_subtitle_');
        if (parts[1]) subTitle = parts[1];
      }
      return {
        id: s.id,
        title: subTitle,
        filePath: s.filePath,
      };
    });

  const startDownloadWithLocation = async (request: PendingDownload) => {
    const currentLocation = settingsStorage.getDownloadLocationConfig();
    if (await validateDownloadLocationAccess(currentLocation)) {
      await downloadManager(request);
      return;
    }
    setPendingDownload(request);
    setLocationDialogVisible(true);
  };

  const selectLocationAndContinue = async () => {
    if (!pendingDownload || selectingLocation) {
      return;
    }
    setSelectingLocation(true);
    try {
      const location = await selectDownloadLocation();
      if (!location || !(await validateDownloadLocationAccess(location))) {
        return;
      }
      settingsStorage.setDownloadLocation(location);
      const request = pendingDownload;
      setPendingDownload(null);
      setLocationDialogVisible(false);
      await downloadManager(request);
    } finally {
      setSelectingLocation(false);
    }
  };

  useEffect(() => {
    if (videoDownload) {
      return;
    }
    const checkIfDownloaded = async () => {
      const exists = await ifExists(fileName);
      setLegacyDownloadedFile(exists);
    };
    checkIfDownloaded();
  }, [videoDownload, fileName]);

  // handle video download deletion
  const deleteVideoDownload = async () => {
    try {
      const target = videoDownload;
      const deleted = target?.filePath
        ? await deleteDownloadOutput(target.filePath, {
          downloadLocation: target.downloadLocation,
          outputDirectoryNames: [
            createDownloadDirectoryName(target.showName || target.title),
            ...[createDownloadSeasonDirectoryName(target.seasonTitle)].filter(
              (name): name is string => Boolean(name),
            ),
          ],
        })
        : await deleteDownloadedFileByBaseName(
          settingsStorage.getDownloadLocationConfig(),
          fileName,
        );

      if (deleted) {
        removeDownload(target?.id || downloadId);
        setLegacyDownloadedFile(false);
      }
    } catch (error) {
      console.error('Error deleting video download:', error);
    }
  };

  // handle subtitle download deletion
  const deleteSubtitleDownload = async (subTitle: string) => {
    try {
      const subItem = subDownloads.find(
        s =>
          s.id === `${downloadId}_subtitle_${subTitle}` ||
          s.title.includes(subTitle),
      );
      if (!subItem) {
        return;
      }

      const deleted = subItem.filePath
        ? await deleteDownloadOutput(subItem.filePath, {
          downloadLocation: subItem.downloadLocation,
          outputDirectoryNames: [
            createDownloadDirectoryName(subItem.showName || subItem.title),
            ...[createDownloadSeasonDirectoryName(subItem.seasonTitle)].filter(
              (name): name is string => Boolean(name),
            ),
          ],
        })
        : await deleteDownloadedFileByBaseName(
          settingsStorage.getDownloadLocationConfig(),
          createSubtitleFileName(fileName, subTitle),
          LEGACY_SUBTITLE_EXTENSIONS,
        );

      if (deleted) {
        removeDownload(subItem.id);
      }
    } catch (error) {
      console.error('Error deleting subtitle download:', error);
    }
  };

  const isSubDownloaded = (subTitle: string): boolean => {
    return subDownloads.some(
      s =>
        (s.id === `${downloadId}_subtitle_${subTitle}` ||
          s.title.includes(subTitle)) &&
        s.status === 'completed',
    );
  };

  const downloadSingleVideoStream = async (server: Stream) => {
    const resolvedSkip =
      server.skip && server.skip.length > 0
        ? server.skip
        : (server as any)?.skips && (server as any).skips.length > 0
          ? (server as any).skips
          : skip && skip.length > 0
            ? skip
            : undefined;

    await startDownloadWithLocation({
      downloadId,
      title: title,
      showName,
      episodeName,
      seasonTitle,
      episodeIndex,
      mediaType,
      imdbId,
      poster,
      background,
      synopsis,
      provider: providerValue || provider.value,
      server: server.server,
      quality: server.quality,
      infoUrl,
      sourceLink: link,
      url: server.link,
      fileName: fileName,
      fileType: server.type,
      headers: server?.headers,
      skip: resolvedSkip,
      subtitles: server.subtitles?.map(subtitle => ({
        url: subtitle.uri,
        language: subtitle.language || 'Unknown',
        format: subtitle.type === 'text/vtt' ? 'vtt' : 'srt',
      })),
      deleteDownload: deleteVideoDownload,
    });
  };

  const downloadQuickStream = async (server: Stream) => {
    await downloadSingleVideoStream(server);

    if (server.subtitles && server.subtitles.length > 0) {
      const sub = server.subtitles[0];
      await startDownloadWithLocation({
        downloadId: `${downloadId}_subtitle_${sub.title}`,
        title: title + ' ' + sub.title + ' Subtitle ',
        showName,
        episodeName,
        seasonTitle,
        episodeIndex,
        mediaType,
        imdbId,
        poster,
        background,
        synopsis,
        provider: providerValue || provider.value,
        isSubtitle: true,
        infoUrl,
        sourceLink: link,
        url: sub.uri,
        fileName: createSubtitleFileName(fileName, sub.title),
        fileType: sub.type === 'text/vtt' ? 'vtt' : 'srt',
        deleteDownload: () => deleteSubtitleDownload(sub.title),
      });
    }
  };

  const fetchAndOpenSheet = async (isLongPress = false) => {
    const isAlwaysExternal =
      usesExternalApp('downloader');
    const shouldUseQuickDownload =
      Boolean(quickDownload) &&
      !isLongPress &&
      !isAlwaysExternal &&
      !isVideoDownloaded &&
      !hasDownloadedSubs;

    if (!shouldUseQuickDownload) {
      setDownloadModal(true);
    }

    if (shouldUseQuickDownload && servers.length > 0 && !serverLoading) {
      downloadQuickStream(servers[0]);
      return;
    }

    if (serverLoading || (!isLongPress && servers.length > 0)) {
      return;
    }

    setServerLoading(true);
    setServerError(null);
    try {
      const availableServers = await providerManager.getStream({
        link,
        type,
        signal: new AbortController().signal,
        providerValue: providerValue || provider.value,
        isDownload: true,
      });
      const validServers = availableServers || [];
      setServers(validServers);
      if (validServers.length === 0) {
        setServerError('No downloadable streams found');
        if (shouldUseQuickDownload) {
          setDownloadModal(true);
        }
      } else if (shouldUseQuickDownload) {
        await downloadQuickStream(validServers[0]);
      }
    } catch (error: any) {
      console.error('Error fetching servers:', error);
      const errorMessage = error?.message || 'Failed to fetch servers';
      setServerError(errorMessage);
      setServers([]);
      if (shouldUseQuickDownload) {
        setDownloadModal(true);
      }
    } finally {
      setServerLoading(false);
    }
  };

  const openExternalApp = async (
    targetLink: string,
    targetType?: string,
    headers?: Record<string, string>,
  ) => {
    try {
      const torrent = targetType === 'torrent' || targetLink.startsWith('magnet:');
      await launchDownloadApp('downloader', targetLink, torrent ? null : 'application/octet-stream', headers);
    } catch (error) {
      ToastAndroid.show(error instanceof Error ? error.message : 'Could not open downloader', ToastAndroid.LONG);
    }
  };

  const showCancelConfirmation = () => {
    const activeId = currentActiveDownload?.id || downloadId;
    showAppDialog({
      title: 'Cancel download?',
      message:
        'The current download will stop and its partial file will be removed.',
      variant: 'warning',
      actions: [
        { label: 'Keep downloading' },
        {
          label: 'Cancel download',
          variant: 'destructive',
          onPress: async () => {
            try {
              await cancelDownload(activeId);
            } catch (error) {
              console.log('Error cancelling download', error);
            }
          },
        },
      ],
    });
  };

  return (
    <>
      <View
        collapsable={false}
        className="h-12 w-12 flex-row items-center justify-center rounded-full"
        style={{ backgroundColor: LEGACY_TERTIARY_BACKGROUND }}>
        {isTV ? (
          <TVFocusable
            ref={downloadButtonRef}
            accessibilityRole="button"
            accessibilityLabel={
              downloadActive
                ? 'Cancel download'
                : isVideoDownloaded || hasDownloadedSubs
                ? 'Downloaded episode. Tap to manage.'
                : 'Download episode'
            }
            borderRadius={24}
            focusScale={1.15}
            focusBorderColor={focusBorderColor}
            onPress={() => {
              if (serverLoading) return;
              if (downloadActive) {
                showCancelConfirmation();
                return;
              }
              fetchAndOpenSheet(false);
            }}
            onLongPress={() => {
              if (serverLoading || downloadActive) return;
              fetchAndOpenSheet(true);
            }}
            style={{
              height: 48,
              width: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {downloadActive ? (
              <DownloadProgress
                downloadedBytes={currentActiveDownload?.downloadedBytes ?? 0}
                totalBytes={currentActiveDownload?.totalBytes ?? 0}
                color={primary}
              />
            ) : serverLoading ? (
              <LoadingIndicator size={28} color={primary} />
            ) : isVideoDownloaded || hasDownloadedSubs ? (
              <MaterialIcons name="check-circle" size={24} color={primary} />
            ) : (
              <Octicons name="download" size={22} color={primary} />
            )}
          </TVFocusable>
        ) : downloadActive ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              currentActiveDownload?.totalBytes
                ? `Download ${Math.round(
                  (currentActiveDownload.downloadedBytes /
                    currentActiveDownload.totalBytes) *
                  100,
                )} percent complete. Tap to cancel.`
                : 'Download in progress. Tap to cancel.'
            }
            onPress={showCancelConfirmation}
            className="h-12 w-12 items-center justify-center">
            <DownloadProgress
              downloadedBytes={currentActiveDownload?.downloadedBytes ?? 0}
              totalBytes={currentActiveDownload?.totalBytes ?? 0}
              color={primary}
            />
          </TouchableOpacity>
        ) : isVideoDownloaded || hasDownloadedSubs ? (
          <TouchableOpacity
            disabled={serverLoading}
            onPress={() => fetchAndOpenSheet(false)}
            onLongPress={() => {
              if (settingsStorage.isHapticFeedbackEnabled()) {
                ReactNativeHapticFeedback.trigger('effectHeavyClick', {
                  enableVibrateFallback: true,
                  ignoreAndroidSystemSettings: false,
                });
              }
              fetchAndOpenSheet(true);
            }}
            className="h-12 w-12 items-center justify-center">
            {serverLoading ? (
              <LoadingIndicator size={35} color={primary} />
            ) : (
              <MaterialIcons name="check-circle" size={24} color={primary} />
            )}
          </TouchableOpacity>
        ) : (
          <Pressable
            disabled={serverLoading}
            accessibilityRole="button"
            focusable={!serverLoading}
            isTVSelectable={!serverLoading}
            onPress={() => fetchAndOpenSheet(false)}
            onLongPress={() => {
              if (settingsStorage.isHapticFeedbackEnabled()) {
                ReactNativeHapticFeedback.trigger('effectHeavyClick', {
                  enableVibrateFallback: true,
                  ignoreAndroidSystemSettings: false,
                });
              }
              fetchAndOpenSheet(true);
            }}
            className="h-12 w-12 items-center justify-center rounded-xl"
            style={({ pressed, focused }) => ({
              borderWidth: focused ? 2 : 0,
              borderColor: focused ? focusBorderColor : 'transparent',
              backgroundColor: focused
                ? 'rgba(255, 255, 255, 0.12)'
                : 'transparent',
              transform: [{ scale: focused ? 1.15 : pressed ? 0.92 : 1 }],
            })}>
            {serverLoading ? (
              <LoadingIndicator size={35} color={primary} />
            ) : (
              <Octicons
                name="download"
                size={24}
                color={primary}
              />
            )}
          </Pressable>
        )}
      </View>
      {/* download modal */}
      <DownloadBottomSheet
        setModal={setDownloadModalWithFocus}
        showModal={downloadModal}
        data={servers}
        loading={serverLoading}
        error={serverError}
        title=""
        videoDownloaded={isVideoDownloaded}
        downloadedServer={videoDownload?.server}
        onDeleteVideo={deleteVideoDownload}
        downloadedSubtitles={downloadedSubsList}
        isSubDownloaded={isSubDownloaded}
        onDeleteSub={deleteSubtitleDownload}
        onPressVideo={(server: Stream) => {
          downloadSingleVideoStream(server);
        }}
        onPressExternalVideo={(server: Stream) => {
          openExternalApp(server.link, server.type, server.headers);
        }}
        onPressSubs={(sub: { link: string; type: string; title: string }) => {
          startDownloadWithLocation({
            downloadId: `${downloadId}_subtitle_${sub.title}`,
            title: title + ' ' + sub.title + ' Subtitle ',
            showName,
            episodeName,
            seasonTitle,
            mediaType,
            imdbId,
            poster,
            background,
            synopsis,
            provider: providerValue || provider.value,
            isSubtitle: true,
            infoUrl,
            sourceLink: link,
            url: sub.link,
            fileName: createSubtitleFileName(fileName, sub.title),
            fileType: sub.type,
            deleteDownload: () => deleteSubtitleDownload(sub.title),
          });
        }}
        onPressExternalSubs={(sub: { link: string; type: string; title: string }) => {
          openExternalApp(sub.link, 'text/vtt');
        }}
      />
      <DownloadLocationDialog
        visible={locationDialogVisible}
        primary={primary}
        selecting={selectingLocation}
        onCancel={() => {
          if (selectingLocation) {
            return;
          }
          setPendingDownload(null);
          setLocationDialogVisible(false);
        }}
        onSelectFolder={() => {
          selectLocationAndContinue().catch(console.error);
        }}
      />
    </>
  );
};

export default DownloadComponent;
