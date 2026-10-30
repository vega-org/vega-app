import {openExternalApp, usesExternalApp} from '../lib/externalApps';
import {applyProviderEpisodeMetadata} from '../lib/providerEpisodeMetadata';
import useMetadataOverrideStore, {metadataOverrideKey} from '../lib/zustand/metadataOverrideStore';
import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  View,
  TouchableOpacity,
  ToastAndroid,
  FlatList,
  Image,
  ScrollView,
  BackHandler,
  findNodeHandle,
  UIManager,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {EpisodeLink, Link} from '../lib/providers/types';
import {RootStackParamList} from '../App';
import Downloader from './Downloader';
import {cacheStorage, mainStorage, settingsStorage} from '../lib/storage';
import {ifExists} from '../lib/file/ifExists';
import {isTV} from '../lib/tv';
import {useEpisodes, useStreamData} from '../lib/hooks/useEpisodes';
import EpisodeListSkeleton from './EpisodeListSkeleton';
import DropdownField from './ui/DropdownField';
import {
  createDesktopCompatibleFileName,
  createDirectDownloadId,
  createSeriesDownloadId,
} from '../lib/downloadId';
import useDownloadsStore from '../lib/zustand/downloadsStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import MaterialDialogSurface from './ui/MaterialDialogSurface';
import LoadingIndicator from './ui/LoadingIndicator';
import {LEGACY_TERTIARY_BACKGROUND} from '../theme/seeds';
import Text from './ui/Text';
import EpisodeRowContent, {getValidImageUri} from './EpisodeRowContent';
import {setSyncedEpisodeProgress} from '../lib/sync/syncService';
import {episodesUpTo, markEpisodesWatched} from '../lib/utils/episodeProgress';
import {TVFocusable, TVFocusGuide, TVTouchable} from './tv';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import useContinueWatchingStore from '../lib/zustand/continueWatchingStore';
import {
  EpisodeRange,
  buildEpisodeRanges,
  rangeForIndex,
} from '../lib/utils/episodeRanges';
import {
  EpisodeRangeChips,
  EpisodeResumeCard,
  ResumeTarget,
} from './EpisodeResumeCard';
import SeasonSearchSortBar from './season/SeasonSearchSortBar';
import EpisodeSelectionBar, {
  EpisodeSelectCheck,
} from './season/EpisodeSelectionBar';
import {useEpisodeSelection} from './season/useEpisodeSelection';
import {queueQuickDownload} from '../lib/quickDownload';
import {ensureDownloadLocationAccess} from '../lib/downloadLocation';
import {EpisodeLinkTarget} from '../lib/episodeLinks';
import {Stream} from '../lib/providers/types';
import {CURRENT_DOWNLOAD_STATUSES} from '../lib/zustand/downloadsStore';
import {torrentManager} from '../lib/torrentManager';
import {
  isDummyTorrentLink,
  isTorrentStream,
  pickVideoFileIndex,
  resolveTorrentStream,
} from '../lib/torrentStream';

const CONTROL_TEXT = '#F5F0EF';
const CONTROL_TEXT_MUTED = '#D4CBC9';
// const CONTROL_OUTLINE = '#494240';

interface SeasonListProps {
  LinkList: Link[];
  poster: {
    logo?: string;
    poster?: string;
    background?: string;
  };
  type: string;
  metaTitle: string;
  providerValue: string;
  refreshing?: boolean;
  routeParams: Readonly<{
    link: string;
    provider?: string;
    poster?: string;
  }>;
  imdbId?: string;
  synopsis?: string;
  refreshVersion?: number;
  quickDownload?: boolean;
}

interface PlayHandlerProps {
  linkIndex: number;
  type: string;
  primaryTitle: string;
  seasonTitle: string;
  episodeData: EpisodeLink[] | Link['directLinks'];
  /** Opens the cast screen instead of the local or external player. */
  cast?: boolean;
}

interface LastPlayed {
  season: string;
  link: string;
  title?: string;
}

const readProgress = (link: string): {position?: number; duration?: number} => {
  try {
    return JSON.parse(cacheStorage.getString(link) || '{}');
  } catch {
    return {};
  }
};

interface StickyMenuState {
  active: boolean;
  link?: string;
  type?: string;
}

interface EpisodeDetailsState {
  link: string;
  title: string;
  description: string;
  image?: string;
}

const readLastPlayedLink = (key: string): string | undefined => {
  try {
    const stored = cacheStorage.getString(key);
    return stored ? JSON.parse(stored)?.link : undefined;
  } catch {
    return undefined;
  }
};

// Opens a stream in an external player app. Errors reject the promise.
const launchExternalPlayer = async (
  streamUrl: string,
  headers?: Record<string, string>,
  title?: string,
) => {
  await openExternalApp('player', streamUrl, 'video/*', headers, title);
};

const getOriginalLinkIndex = <T extends {link: string}>(
  links: T[] | undefined,
  link: string,
  fallbackIndex: number,
): number => {
  const originalIndex = links?.findIndex(item => item.link === link) ?? -1;
  return originalIndex >= 0 ? originalIndex : fallbackIndex;
};

interface EpisodeCardRowProps {
  item: any;
  index: number;
  isFirst: boolean;
  isCompleted: boolean;
  isSticky: boolean;
  onPress: () => void;
  onBeforePlay?: (control: View | null) => void;
  onPlayControlRef?: (link: string, control: View | null) => void;
  onLongPress: () => void;
  displayTitle: string;
  primary: string;
  onShowDetailsPressIn?: () => void;
  onShowDetails?: () => void;
  detailsPreferred?: boolean;
  thumbnail?: React.ReactNode;
  downloadComponent?: React.ReactNode;
  /** Replaces the download button while selecting episodes. */
  selectionMark?: React.ReactNode;
  /** Set only in select mode; the row then toggles selection. */
  selected?: boolean;
}

export const EpisodeCardRow: React.FC<EpisodeCardRowProps> = ({
  item,
  index,
  isCompleted,
  isSticky,
  onPress,
  onBeforePlay,
  onPlayControlRef,
  onLongPress,
  displayTitle,
  primary,
  onShowDetailsPressIn,
  onShowDetails,
  detailsPreferred,
  downloadComponent,
  thumbnail,
  selectionMark,
  selected,
}) => {
  const focusBorderColor = useTVFocusBorderColor();
  const selectionA11y =
    selected === undefined
      ? undefined
      : {
          accessibilityLabel: `${selected ? 'Deselect' : 'Select'} ${displayTitle}`,
          accessibilityState: {selected},
        };
  const playControlRef = useRef<View>(null);
  const itemLink: string = item.link;
  useEffect(() => {
    if (!isTV || !onPlayControlRef) return;
    onPlayControlRef(itemLink, playControlRef.current);
    return () => onPlayControlRef(itemLink, null);
  }, [itemLink, onPlayControlRef]);

  if (!isTV) {
    return (
      <View
        key={item.link + index}
        className={`w-full my-1.5 ${
          isCompleted || isSticky ? 'opacity-60' : ''
        }`}>
        <View
          className="min-h-[76px] flex-row w-full items-center px-3 py-2"
          style={{
            backgroundColor: LEGACY_TERTIARY_BACKGROUND,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
          }}>
          <TouchableOpacity
            accessibilityRole="button"
            style={{
              minWidth: 0,
              flex: 1,
              alignItems: 'center',
              flexDirection: 'row',
              gap: 12,
            }}
            onPress={onPress}
            onLongPress={onLongPress}
            {...selectionA11y}>
            <EpisodeRowContent
              title={displayTitle}
              description={item.description}
              image={item.image}
            thumbnail={thumbnail}
              accentColor={primary}
              textColor={CONTROL_TEXT}
              mutedTextColor={CONTROL_TEXT_MUTED}
              onShowDetailsPressIn={onShowDetailsPressIn}
              onShowDetails={onShowDetails}
            />
          </TouchableOpacity>
          {selectionMark ?? downloadComponent}
        </View>
      </View>
    );
  }

  // TV Layout: Separate focus targets for episode play card, details button, and download button
  return (
    <TVFocusGuide
      autoFocus={Boolean(detailsPreferred)}
      style={{
        width: '100%',
        marginVertical: 4,
        opacity: isCompleted || isSticky ? 0.6 : 1,
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
        }}>
        <TVFocusable
          ref={playControlRef}
          accessibilityRole="button"
          accessibilityLabel={`Play ${displayTitle}`}
          focusBorderColor={focusBorderColor}
          focusScale={1}
          borderRadius={14}
          onPress={() => {
            onBeforePlay?.(playControlRef.current);
            onPress();
          }}
          onLongPress={onLongPress}
          {...selectionA11y}
          style={{
            flex: 1,
            minHeight: 76,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: LEGACY_TERTIARY_BACKGROUND,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.08)',
            gap: 12,
          }}
          focusedStyle={{
            backgroundColor: '#262626',
          }}>
          <EpisodeRowContent
            title={displayTitle}
            description={item.description}
            image={item.image}
            thumbnail={thumbnail}
            accentColor={primary}
            textColor={CONTROL_TEXT}
            mutedTextColor={CONTROL_TEXT_MUTED}
            onShowDetailsPressIn={onShowDetailsPressIn}
            onShowDetails={onShowDetails}
          />
        </TVFocusable>

        {Boolean(onShowDetails) && (
          <TVFocusable
            key={detailsPreferred ? 'restore-details-focus' : 'episode-details'}
            hasTVPreferredFocus={detailsPreferred}
            accessibilityRole="button"
            accessibilityLabel={`Episode details for ${displayTitle}`}
            focusBorderColor={focusBorderColor}
            focusScale={1.05}
            borderRadius={24}
            onPress={onShowDetails}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: LEGACY_TERTIARY_BACKGROUND,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 8,
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.08)',
            }}>
            <MaterialCommunityIcons
              name="information-outline"
              size={22}
              color={primary}
            />
          </TVFocusable>
        )}

        <View style={{marginLeft: 8}}>
          {selectionMark ?? downloadComponent}
        </View>
      </View>
    </TVFocusGuide>
  );
};

const ServerRowItem = ({
  item,
  index,
  primary,
  onPress,
}: {
  item: any;
  index: number;
  primary: string;
  onPress: () => void;
}) => {
  const [tvFocused, setTvFocused] = useState(false);
  const focusBorderColor = useTVFocusBorderColor();
  return (
    <TVFocusable
      key={`server-${index}-${item.server}`}
      hasTVPreferredFocus={index === 0}
      registerScreenFocus={false}
      accessibilityRole="button"
      accessibilityLabel={item.server || `Server ${index + 1}`}
      onFocus={() => setTvFocused(true)}
      onBlur={() => setTvFocused(false)}
      focusBorderColor={focusBorderColor}
      focusScale={1.02}
      borderRadius={14}
      style={{
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        backgroundColor: tvFocused ? '#262626' : LEGACY_TERTIARY_BACKGROUND,
        borderRadius: 14,
        borderWidth: tvFocused ? 2.5 : 1,
        borderColor: tvFocused ? focusBorderColor : 'rgba(255,255,255,0.08)',
      }}
      onPress={onPress}>
      <View>
        <Text
          className="text-lg capitalize font-bold"
          style={{color: CONTROL_TEXT}}>
          {item.server || `Server ${index + 1}`}
        </Text>
        <Text className="text-xs" style={{color: CONTROL_TEXT_MUTED}}>
          {item.type ? `Format: ${item.type.toUpperCase()}` : ''}
        </Text>
      </View>
      <MaterialCommunityIcons name="vlc" size={24} color={primary} />
    </TVFocusable>
  );
};

const SeasonListContent: React.FC<SeasonListProps> = ({
  LinkList,
  poster,
  type,
  metaTitle,
  providerValue,
  refreshing,
  routeParams,
  imdbId,
  synopsis,
  refreshVersion,
  quickDownload,
}) => {
  const manualMetadata = useMetadataOverrideStore(state => state.overrides[metadataOverrideKey(providerValue, routeParams.link)]);
  const colors = useM3Colors();
  const primary = colors.primary;
  const focusBorderColor = useTVFocusBorderColor();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {fetchStreams} = useStreamData();
  const detailsPressRef = useRef<string | null>(null);
  const playerReturnFocusRef = useRef<View | null>(null);
  const restorePlayerFocusRef = useRef(false);

  // Play controls by episode link. Player can auto-advance, so on return the
  // last played episode may not be the one that opened Player.
  const playControlsRef = useRef(new Map<string, View>());
  const registerPlayControl = useCallback(
    (link: string, control: View | null) => {
      if (control) playControlsRef.current.set(link, control);
      else playControlsRef.current.delete(link);
    },
    [],
  );
  const lastPlayedKeyRef = useRef('');

  useFocusEffect(
    useCallback(() => {
      if (!isTV || !restorePlayerFocusRef.current) return;
      const timer = setTimeout(() => {
        const lastPlayedLink = readLastPlayedLink(lastPlayedKeyRef.current);
        const target =
          (lastPlayedLink && playControlsRef.current.get(lastPlayedLink)) ||
          playerReturnFocusRef.current;
        const handle = findNodeHandle(target);
        if (handle) {
          UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
        }
        restorePlayerFocusRef.current = false;
      }, 350);
      return () => clearTimeout(timer);
    }, []),
  );

  const rememberPlayerFocus = useCallback((control: View | null) => {
    if (!isTV) return;
    playerReturnFocusRef.current = control;
    restorePlayerFocusRef.current = true;
  }, []);
  const episodeSortOrderKey = `episodeSortOrder:${providerValue}:${routeParams.link}`;
  const lastPlayedKey = `LastPlayed:${providerValue}:${routeParams.link}`;
  // Written in an effect, not during render: React Compiler skips components
  // that write refs while rendering. The focus timer reads it 350 ms later.
  useEffect(() => {
    lastPlayedKeyRef.current = lastPlayedKey;
  }, [lastPlayedKey]);

  // Memoized initial active season
  const [activeSeason, setActiveSeason] = useState<Link>(() => {
    if (!LinkList || LinkList.length === 0) {
      return {} as Link;
    }

    const cached = cacheStorage.getString(
      `ActiveSeason${metaTitle + providerValue}`,
    );

    if (cached) {
      try {
        const parsedSeason = JSON.parse(cached);
        // Verify the cached season still exists in LinkList
        const seasonExists = LinkList.find(
          link => link.title === parsedSeason.title,
        );
        if (seasonExists) {
          return parsedSeason;
        }
      } catch (error) {
        console.warn('Failed to parse cached season:', error);
      }
    }

    return LinkList[0];
  });

  // React Query for episodes
  const {
    data: episodeList = [],
    isLoading: episodeLoading,
    error: episodeError,
    refetch: refetchEpisodes,
  } = useEpisodes(
    activeSeason?.episodesLink,
    providerValue,
    activeSeason?.episodesLink ? true : false,
  );

  useEffect(() => {
    if (refreshing && activeSeason?.episodesLink) {
      refetchEpisodes();
    }
  }, [activeSeason?.episodesLink, refetchEpisodes, refreshVersion, refreshing]);

  // UI state
  const [vlcLoading, setVlcLoading] = useState<boolean>(false);
  const [stickyMenu, setStickyMenu] = useState<StickyMenuState>({
    active: false,
  });

  // Search and sorting state - memoized initial values
  const [searchText, setSearchText] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() =>
    mainStorage.getString(episodeSortOrderKey) === 'desc' ? 'desc' : 'asc',
  );

  useEffect(() => {
    setSortOrder(
      mainStorage.getString(episodeSortOrderKey) === 'desc' ? 'desc' : 'asc',
    );
  }, [episodeSortOrderKey]);

  // External player state
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [externalPlayerStreams, setExternalPlayerStreams] = useState<any[]>([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState<boolean>(false);
  const [episodeDetails, setEpisodeDetails] =
    useState<EpisodeDetailsState | null>(null);
  const [restoreDetailsLink, setRestoreDetailsLink] = useState<string | null>(null);
  const closeEpisodeDetails = useCallback(() => {
    setRestoreDetailsLink(episodeDetails?.link ?? null);
    setEpisodeDetails(null);
  }, [episodeDetails?.link]);
  const [episodeDetailsImageFailed, setEpisodeDetailsImageFailed] =
    useState(false);

  useEffect(() => {
    setEpisodeDetailsImageFailed(false);
  }, [episodeDetails?.image]);

  useEffect(() => {
    if (!isTV || !episodeDetails) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeEpisodeDetails();
      return true;
    });
    return () => sub.remove();
  }, [episodeDetails, closeEpisodeDetails]);

  // VLC loading animation - using shared value so it reacts to vlcLoading state
  const vlcRotation = useSharedValue(0);

  useEffect(() => {
    if (vlcLoading) {
      vlcRotation.value = 0;
      vlcRotation.value = withRepeat(
        withTiming(360, {duration: 800}),
        -1,
        false,
      );
    } else {
      cancelAnimation(vlcRotation);
      vlcRotation.value = 0;
    }
  }, [vlcLoading]);

  const vlcLoadingAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${vlcRotation.value}deg`}],
  }));

  const validEpisodes = useMemo(
    () =>
      Array.isArray(episodeList)
        ? episodeList.filter(episode => episode && episode.title && episode.link).map(episode => applyProviderEpisodeMetadata(episode, activeSeason.title, manualMetadata))
        : [],
    [episodeList, activeSeason.title, manualMetadata],
  );
  const validDirectLinks = useMemo(
    () =>
      Array.isArray(activeSeason?.directLinks)
        ? activeSeason.directLinks.filter(link => link && link.title && link.link).map(episode => applyProviderEpisodeMetadata(episode, activeSeason.title, manualMetadata))
        : [],
    [activeSeason.directLinks, activeSeason.title, manualMetadata],
  );

  // Long seasons are shown in blocks of 50; the chosen block is remembered per season.
  const rangesOnEpisodes = validEpisodes.length > 0;
  const episodeRanges = useMemo(
    () =>
      buildEpisodeRanges(
        rangesOnEpisodes ? validEpisodes.length : validDirectLinks.length,
      ),
    [rangesOnEpisodes, validEpisodes.length, validDirectLinks.length],
  );
  const rangeKey = `EpisodeRange:${providerValue}:${routeParams.link}:${activeSeason?.title}`;
  const [rangeStart, setRangeStart] = useState(
    () => Number(cacheStorage.getString(rangeKey)) || 0,
  );
  useEffect(() => {
    setRangeStart(Number(cacheStorage.getString(rangeKey)) || 0);
  }, [rangeKey]);
  const selectedRange: EpisodeRange | undefined = episodeRanges.length
    ? episodeRanges.find(r => r.start === rangeStart) ?? episodeRanges[0]
    : undefined;
  const selectRange = useCallback(
    (range: EpisodeRange) => {
      setRangeStart(range.start);
      cacheStorage.setString(rangeKey, String(range.start));
    },
    [rangeKey],
  );

  // What the list shows: search covers every range; otherwise the chosen range.
  const visibleItems = useCallback(
    <T extends {title?: string}>(items: T[], ranged: boolean): T[] => {
      let result = items;
      if (searchText.trim()) {
        const query = searchText.toLowerCase();
        result = result.filter(item => item?.title?.toLowerCase().includes(query));
      } else if (ranged && selectedRange) {
        result = result.slice(selectedRange.start, selectedRange.end);
      }
      return sortOrder === 'desc' ? [...result].reverse() : result;
    },
    [searchText, selectedRange, sortOrder],
  );
  const filteredAndSortedEpisodes = useMemo(
    () => visibleItems(validEpisodes, true),
    [visibleItems, validEpisodes],
  );
  const filteredAndSortedDirectLinks = useMemo(
    () => visibleItems(validDirectLinks, !rangesOnEpisodes),
    [visibleItems, validDirectLinks, rangesOnEpisodes],
  );

  // The player gets the whole season so next-episode crosses range borders.
  const playableEpisodes = useMemo(
    () => (sortOrder === 'desc' ? [...validEpisodes].reverse() : validEpisodes),
    [validEpisodes, sortOrder],
  );
  const playableDirectLinks = useMemo(
    () =>
      sortOrder === 'desc' ? [...validDirectLinks].reverse() : validDirectLinks,
    [validDirectLinks, sortOrder],
  );

  // Select mode: pick episodes and copy their download links (#566).
  const selectableItems = useMemo(
    () => [...validEpisodes, ...validDirectLinks],
    [validEpisodes, validDirectLinks],
  );
  const fetchDownloadStreams = useCallback(
    (link: string, signal: AbortSignal) =>
      fetchStreams(link, type, providerValue, {signal, isDownload: true}),
    [fetchStreams, type, providerValue],
  );
  const prepareSelectedDownloads = useCallback(async () => {
    const location = await ensureDownloadLocationAccess(
      settingsStorage.getDownloadLocationConfig(),
    );
    if (!location) return false;
    settingsStorage.setDownloadLocation(location);
    return true;
  }, []);
  const downloadSelectedEpisode = useCallback(
    async (episode: EpisodeLinkTarget, stream: Stream, signal: AbortSignal) => {
      const direct = !validEpisodes.some(item => item.link === episode.link);
      const list = direct ? activeSeason.directLinks : episodeList;
      const index = getOriginalLinkIndex(list, episode.link, 0);
      const downloadId = (
        direct ? createDirectDownloadId : createSeriesDownloadId
      )(metaTitle, activeSeason.title, index);
      const downloads = Object.values(useDownloadsStore.getState().downloads);
      const existing = downloads.find(
        item =>
          !item.isSubtitle &&
          (item.id === downloadId ||
            (item.infoUrl === routeParams.link &&
              item.sourceLink === episode.link)),
      );
      if (
        existing &&
        (existing.status === 'completed' ||
          CURRENT_DOWNLOAD_STATUSES.has(existing.status))
      )
        return false;
      const item = episode as EpisodeLink;
      await queueQuickDownload(
        {
          downloadId,
          title: `${metaTitle.length > 30 ? metaTitle.slice(0, 30) + '...' : metaTitle} ${episode.title}`,
          showName: metaTitle,
          episodeName: episode.title,
          seasonTitle: activeSeason.title,
          episodeIndex: index,
          mediaType: direct && !isTV && (item as any).type !== 'series' ? 'movie' : 'series',
          imdbId,
          poster: poster.poster,
          background: poster.background,
          synopsis,
          provider: providerValue,
          infoUrl: routeParams.link,
          sourceLink: episode.link,
          skip: item.skip || (item as any).skips,
          fileName:
            direct &&
            (item as any).type !== 'series' &&
            (activeSeason.directLinks?.length || 0) <= 1
              ? createDesktopCompatibleFileName(metaTitle, 'movie')
              : createDesktopCompatibleFileName(
                  `${metaTitle} ${episode.title}`,
                  'series',
                ),
          deleteDownload: () => {},
        },
        stream,
        signal,
      );
      return true;
    },
    [
      activeSeason,
      episodeList,
      validEpisodes,
      metaTitle,
      routeParams.link,
      imdbId,
      poster,
      synopsis,
      providerValue,
    ],
  );
  const selection = useEpisodeSelection({
    items: selectableItems,
    resetKey: activeSeason?.episodesLink || activeSeason?.title,
    fetchStreams: fetchDownloadStreams,
    prepareDownloads: prepareSelectedDownloads,
    downloadEpisode: downloadSelectedEpisode,
  });

  // Memoized completion checker
  const isCompleted = useCallback((link: string) => {
    const watchProgress = JSON.parse(cacheStorage.getString(link) || '{}');
    const percentage =
      (watchProgress?.position / watchProgress?.duration) * 100;
    return percentage > 85;
  }, []);

  // Memoized toggle sort order
  const toggleSortOrder = useCallback(() => {
    const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(newOrder);
    mainStorage.setString(episodeSortOrderKey, newOrder);
  }, [episodeSortOrderKey, sortOrder]);

  // Memoized season change handler
  const handleSeasonChange = useCallback(
    (item: Link) => {
      setActiveSeason(item);
      cacheStorage.setString(
        `ActiveSeason${metaTitle + providerValue}`,
        JSON.stringify(item),
      );
    },
    [metaTitle, providerValue],
  );

  // Memoized external player handler
  // Promise chains instead of try/finally here and below: React Compiler
  // skips any component that contains a finally clause.
  const handleExternalPlayer = useCallback(
    (link: string, streamType: string) => {
      setVlcLoading(true);
      setIsLoadingStreams(true);

      return fetchStreams(link, streamType, providerValue)
        .then(streams => {
          if (!streams || streams.length === 0) {
            ToastAndroid.show(
              'No streams available from provider',
              ToastAndroid.SHORT,
            );
            return;
          }

          console.log('Available Streams Count:', streams.length);
          setExternalPlayerStreams([...streams]);
          setIsLoadingStreams(false);
          setVlcLoading(false);
          setShowServerModal(true);

          ToastAndroid.show(
            `Found ${streams.length} servers`,
            ToastAndroid.SHORT,
          );
        })
        .catch((error: any) => {
          console.error('Error fetching streams:', error);
          const errorMessage = error?.message || 'Failed to load streams';
          ToastAndroid.show(errorMessage, ToastAndroid.SHORT);
        })
        .finally(() => {
          setVlcLoading(false);
          setIsLoadingStreams(false);
        });
    },
    [fetchStreams, providerValue],
  );

  // Torrent kept streaming for the external player. External players cannot
  // open magnet links, so they get the local stream server's URL instead.
  const externalTorrentRef = useRef<string | null>(null);

  const resolveExternalStreamUrl = useCallback(
    async (stream: {link: string; type?: string}): Promise<string> => {
      if (!isTorrentStream(stream)) {
        return stream.link;
      }
      if (isDummyTorrentLink(stream.link)) {
        throw new Error('Invalid torrent link');
      }
      ToastAndroid.show('Loading torrent...', ToastAndroid.SHORT);

      // Only one torrent streams to the external player at a time.
      const previous = externalTorrentRef.current;
      externalTorrentRef.current = null;
      if (previous) {
        torrentManager.deleteTorrent(previous, true).catch(() => {});
      }

      const resolved = await resolveTorrentStream(stream.link, {
        addTorrent: link => torrentManager.addTorrent(link),
        deleteTorrent: hash => torrentManager.deleteTorrent(hash, true),
        findVideoFileIndex: async hash =>
          pickVideoFileIndex(await torrentManager.getFiles(hash)),
        prepareVideoFile: (hash, fileIndex) =>
          torrentManager.prepareVideoFile(
            hash,
            fileIndex,
            false,
            settingsStorage.isTorrentFullDownload(),
          ),
        getStreamUrl: (hash, fileIndex) =>
          torrentManager.getStreamUrl(hash, fileIndex),
        onAdded: hash => {
          externalTorrentRef.current = hash;
        },
        isCancelled: () => false,
      });
      if (!resolved) {
        throw new Error('Failed to load torrent');
      }
      resolved.preparation.catch(error =>
        console.error('Failed to prepare torrent for external player:', error),
      );
      return resolved.streamUrl;
    },
    [],
  );

  // Memoized external player opener
  const openExternalPlayer = useCallback(
    async (
      stream: {link: string; type?: string},
      headers?: Record<string, string>,
      title?: string,
    ) => {
      setShowServerModal(false);
      setVlcLoading(true);

      await resolveExternalStreamUrl(stream)
        .then(streamUrl => launchExternalPlayer(streamUrl, headers, title))
        .catch(error => {
          console.error('Error opening external player:', error);
          ToastAndroid.show(
            'Failed to open external player',
            ToastAndroid.SHORT,
          );
        })
        .finally(() => {
          setVlcLoading(false);
        });
    },
    [resolveExternalStreamUrl],
  );

  // Memoized play handler
  const playHandler = useCallback(
    async ({
      linkIndex,
      type: playbackType,
      primaryTitle,
      seasonTitle,
      episodeData,
      cast,
    }: PlayHandlerProps) => {
      if (!episodeData || episodeData.length === 0) {
        return;
      }

      const link = episodeData[linkIndex].link;
      const lastPlayed: LastPlayed = {
        season: seasonTitle,
        link,
        title: episodeData[linkIndex]?.title,
      };
      cacheStorage.setString(lastPlayedKey, JSON.stringify(lastPlayed));
      const file = (
        metaTitle +
        seasonTitle +
        episodeData[linkIndex]?.title
      ).replaceAll(/[^a-zA-Z0-9]/g, '_');

      const externalPlayer = usesExternalApp('player');
      const dwFile = await ifExists(file);

      const downloadIndex = getOriginalLinkIndex(episodeList, link, linkIndex);
      const downloadId = createSeriesDownloadId(
        metaTitle,
        seasonTitle,
        downloadIndex,
      );
      const localDownload =
        useDownloadsStore.getState().downloads[downloadId];
      const localPath =
        (localDownload?.status === 'completed' && localDownload?.filePath) ||
        dwFile;

      if (externalPlayer && !cast) {
        if (localPath) {
          await launchExternalPlayer(localPath, undefined, primaryTitle);
          return;
        }
        handleExternalPlayer(link, playbackType);
        return;
      }

      navigation.navigate('Player', {
        linkIndex,
        episodeList: episodeData,
        type: playbackType,
        primaryTitle: primaryTitle,
        secondaryTitle: seasonTitle,
        poster: poster,
        providerValue: providerValue,
        infoUrl: routeParams.link,
        alwaysCast: !isTV && (cast || settingsStorage.isAlwaysCastMode()),
      });
    },
    [
      routeParams.link,
      poster,
      providerValue,
      metaTitle,
      handleExternalPlayer,
      navigation,
      lastPlayedKey,
      episodeList,
    ],
  );

  // Memoized long press handler
  const onLongPressHandler = useCallback(
    (active: boolean, link: string, streamType?: string) => {
      if (settingsStorage.isHapticFeedbackEnabled()) {
        RNReactNativeHapticFeedback.trigger('effectTick', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
      setStickyMenu({active: active, link: link, type: streamType});
    },
    [],
  );

  // Memoized mark as watched handler
  const markAsWatched = useCallback(() => {
    if (stickyMenu.link) {
      cacheStorage.setString(
        stickyMenu.link,
        JSON.stringify({
          position: 1,
          duration: 1,
        }),
      );
      const episode = [
        ...episodeList,
        ...(activeSeason.directLinks || []),
      ].find(item => item.link === stickyMenu.link);
      if (episode) {
        setSyncedEpisodeProgress({
          episode,
          title: metaTitle,
          poster: poster.poster,
          background: poster.background,
          provider: providerValue,
          infoUrl: routeParams.link,
          type,
          position: 1,
          duration: 1,
          seasonTitle: activeSeason.title,
        });
      }
      setStickyMenu({active: false});
    }
  }, [
    activeSeason.directLinks,
    episodeList,
    metaTitle,
    poster.background,
    poster.poster,
    providerValue,
    routeParams.link,
    stickyMenu.link,
    type,
  ]);

  // Memoized mark as unwatched handler
  const markAsUnwatched = useCallback(() => {
    if (stickyMenu.link) {
      cacheStorage.setString(
        stickyMenu.link,
        JSON.stringify({
          position: 0,
          duration: 1,
        }),
      );
      const episode = [
        ...episodeList,
        ...(activeSeason.directLinks || []),
      ].find(item => item.link === stickyMenu.link);
      if (episode) {
        setSyncedEpisodeProgress({
          episode,
          title: metaTitle,
          poster: poster.poster,
          background: poster.background,
          provider: providerValue,
          infoUrl: routeParams.link,
          type,
          position: 0,
          duration: 1,
          seasonTitle: activeSeason.title,
        });
      }
      setStickyMenu({active: false});
    }
  }, [
    activeSeason.directLinks,
    episodeList,
    metaTitle,
    poster.background,
    poster.poster,
    providerValue,
    routeParams.link,
    stickyMenu.link,
    type,
  ]);

  // The long-pressed episode's list, in episode order (not the sort order).
  const stickyMenuEpisodes = useMemo(() => {
    const link = stickyMenu.link;
    if (!link) return [];
    if (validEpisodes.some(item => item.link === link)) return validEpisodes;
    return validDirectLinks.some(item => item.link === link)
      ? validDirectLinks
      : [];
  }, [stickyMenu.link, validEpisodes, validDirectLinks]);

  const markEpisodes = useCallback(
    (episodes: EpisodeLink[], watched: boolean, syncEpisode?: EpisodeLink) => {
      markEpisodesWatched(episodes, watched, {
        sync: {
          title: metaTitle,
          poster: poster.poster,
          background: poster.background,
          provider: providerValue,
          infoUrl: routeParams.link,
          type,
          seasonTitle: activeSeason.title,
        },
        syncEpisode,
      });
      setStickyMenu({active: false});
    },
    [
      activeSeason.title,
      metaTitle,
      poster.background,
      poster.poster,
      providerValue,
      routeParams.link,
      type,
    ],
  );

  const markPreviousAsWatched = useCallback(() => {
    if (stickyMenu.link) {
      markEpisodes(episodesUpTo(stickyMenuEpisodes, stickyMenu.link), true);
    }
  }, [markEpisodes, stickyMenu.link, stickyMenuEpisodes]);

  const markAllAsWatched = useCallback(() => {
    markEpisodes(
      stickyMenuEpisodes,
      true,
      stickyMenuEpisodes.find(item => item.link === stickyMenu.link),
    );
  }, [markEpisodes, stickyMenu.link, stickyMenuEpisodes]);

  const markAllAsUnwatched = useCallback(() => {
    markEpisodes(
      stickyMenuEpisodes,
      false,
      stickyMenuEpisodes.find(item => item.link === stickyMenu.link),
    );
  }, [markEpisodes, stickyMenu.link, stickyMenuEpisodes]);

  // Memoized sticky menu external player handler
  const handleStickyMenuExternalPlayer = useCallback(() => {
    setStickyMenu({active: false});
    if (stickyMenu.link && stickyMenu.type) {
      handleExternalPlayer(stickyMenu.link, stickyMenu.type);
    }
  }, [stickyMenu.link, stickyMenu.type, handleExternalPlayer]);

  // Cast the long-pressed episode, from whichever list it belongs to.
  const handleStickyMenuCast = useCallback(() => {
    setStickyMenu({active: false});
    if (!stickyMenu.link) return;
    const episodeIndex = playableEpisodes.findIndex(
      item => item.link === stickyMenu.link,
    );
    const directIndex =
      episodeIndex < 0
        ? playableDirectLinks.findIndex(item => item.link === stickyMenu.link)
        : -1;
    if (episodeIndex < 0 && directIndex < 0) return;
    playHandler({
      linkIndex: episodeIndex >= 0 ? episodeIndex : directIndex,
      type,
      primaryTitle: metaTitle,
      seasonTitle: activeSeason?.title || '',
      episodeData: episodeIndex >= 0 ? playableEpisodes : playableDirectLinks,
      cast: true,
    });
  }, [
    stickyMenu.link,
    playableEpisodes,
    playableDirectLinks,
    playHandler,
    type,
    metaTitle,
    activeSeason.title,
  ]);

  // Memoized episode render item
  const renderEpisodeItem = useCallback(
    ({item, index}: {item: EpisodeLink; index: number}) => {
      if (!item || !item.link || !item.title) {
        console.warn('Invalid episode item at index', index, item);
        return null; // Skip rendering if item is invalid
      }

      const downloadIndex = getOriginalLinkIndex(episodeList, item.link, index);
      const downloadId = createSeriesDownloadId(
        metaTitle,
        activeSeason.title,
        downloadIndex,
      );
      const handleEpisodePress = () => {
        playHandler({
          linkIndex: Math.max(
            0,
            playableEpisodes.findIndex(episode => episode.link === item.link),
          ),
          type,
          primaryTitle: metaTitle,
          seasonTitle: activeSeason?.title || '',
          episodeData: playableEpisodes,
        });
      };
      const selectCheck = selection.active ? (
        <EpisodeSelectCheck
          selected={selection.selected.has(item.link)}
          color={primary}
        />
      ) : null;

      return (
        <EpisodeCardRow
          key={item.link + index}
          item={item}
          index={index}
          isFirst={index === 0}
          isCompleted={isCompleted(item.link)}
          isSticky={stickyMenu.link === item.link}
          detailsPreferred={isTV && restoreDetailsLink === item.link}
          displayTitle={item.title}
          primary={primary}
          onPress={() => {
            if (detailsPressRef.current === item.link) {
              detailsPressRef.current = null;
              return;
            }
            if (selection.active) {
              selection.toggle(item.link);
              return;
            }
            handleEpisodePress();
          }}
          onBeforePlay={rememberPlayerFocus}
          onPlayControlRef={registerPlayControl}
          onLongPress={() =>
            selection.active
              ? selection.toggle(item.link)
              : onLongPressHandler(true, item.link, 'series')
          }
          onShowDetailsPressIn={() => {
            detailsPressRef.current = item.link;
          }}
          onShowDetails={
            item.description?.trim()
              ? () => {
                  setRestoreDetailsLink(null);
                  setEpisodeDetails({
                    link: item.link,
                    title: item.title,
                    description: item.description!.trim(),
                    image: item.image,
                  });
                  setTimeout(() => {
                    if (detailsPressRef.current === item.link) {
                      detailsPressRef.current = null;
                    }
                  }, 0);
                }
              : undefined
          }
          selectionMark={selectCheck}
          selected={
            selection.active ? selection.selected.has(item.link) : undefined
          }
          downloadComponent={
            <Downloader
              downloadId={downloadId}
              episodeIndex={downloadIndex}
              providerValue={providerValue}
              link={item.link}
              type={type}
              mediaType="series"
              showName={metaTitle}
              seasonTitle={activeSeason.title}
              episodeName={item.title}
              imdbId={imdbId}
              poster={poster.poster}
              background={poster.background}
              synopsis={synopsis}
              infoUrl={routeParams.link}
              skip={item.skip || (item as any)?.skips}
              quickDownload={
                quickDownload ||
                activeSeason?.quickDownload ||
                item?.quickDownload
              }
              title={
                metaTitle.length > 30
                  ? metaTitle.slice(0, 30) + '... ' + item.title
                  : metaTitle + ' ' + item.title
              }
              fileName={createDesktopCompatibleFileName(
                `${metaTitle} ${item.title}`,
                'series',
              )}
            />
          }
        />
      );
    },
    [
      isCompleted,
      stickyMenu.link,
      playHandler,
      rememberPlayerFocus,
      metaTitle,
      activeSeason.title,
      activeSeason.quickDownload,
      episodeList,
      playableEpisodes,
      onLongPressHandler,
      primary,
      providerValue,
      routeParams.link,
      imdbId,
      poster.poster,
      poster.background,
      type,
      restoreDetailsLink,
      quickDownload,
      synopsis,
      selection.active,
      selection.selected,
      selection.toggle,
    ],
  );

  // Memoized direct link render item
  const renderDirectLinkItem = useCallback(
    ({item, index}: {item: any; index: number}) => {
      if (!item || !item.link || !item.title) {
        console.warn('Invalid direct link item at index', index, item);
        return null; // Skip rendering if item is invalid
      }

      const downloadIndex = getOriginalLinkIndex(
        activeSeason.directLinks,
        item.link,
        index,
      );
      const downloadId = createDirectDownloadId(
        metaTitle,
        activeSeason.title,
        downloadIndex,
      );
      const displayTitle =
        item.title?.trim() ||
        (activeSeason?.directLinks?.length && activeSeason.directLinks.length > 1
          ? `${activeSeason?.title || 'Episode'} ${index + 1}`
          : activeSeason?.title && activeSeason.title.toLowerCase() !== 'default'
          ? activeSeason.title
          : 'Play');
      const handleEpisodePress = () => {
        playHandler({
          linkIndex: Math.max(
            0,
            playableDirectLinks.findIndex(link => link.link === item.link),
          ),
          type,
          primaryTitle: metaTitle,
          seasonTitle: activeSeason?.title || '',
          episodeData: playableDirectLinks,
        });
      };
      const selectCheck = selection.active ? (
        <EpisodeSelectCheck
          selected={selection.selected.has(item.link)}
          color={primary}
        />
      ) : null;

      return (
        <EpisodeCardRow
          key={item.link + index}
          item={item}
          index={index}
          isFirst={index === 0}
          isCompleted={isCompleted(item.link)}
          isSticky={stickyMenu.link === item.link}
          detailsPreferred={isTV && restoreDetailsLink === item.link}
          displayTitle={displayTitle}
          primary={primary}
          onPress={() => {
            if (detailsPressRef.current === item.link) {
              detailsPressRef.current = null;
              return;
            }
            if (selection.active) {
              selection.toggle(item.link);
              return;
            }
            handleEpisodePress();
          }}
          onBeforePlay={rememberPlayerFocus}
          onPlayControlRef={registerPlayControl}
          onLongPress={() =>
            selection.active
              ? selection.toggle(item.link)
              : onLongPressHandler(true, item.link, item?.type || 'series')
          }
          onShowDetailsPressIn={() => {
            detailsPressRef.current = item.link;
          }}
          onShowDetails={
            item.description?.trim()
              ? () => {
                  setRestoreDetailsLink(null);
                  setEpisodeDetails({
                    link: item.link,
                    title: item.title,
                    description: item.description.trim(),
                    image: item.image,
                  });
                  setTimeout(() => {
                    if (detailsPressRef.current === item.link) {
                      detailsPressRef.current = null;
                    }
                  }, 0);
                }
              : undefined
          }
          selectionMark={selectCheck}
          selected={
            selection.active ? selection.selected.has(item.link) : undefined
          }
          downloadComponent={
            <Downloader
              downloadId={downloadId}
              episodeIndex={downloadIndex}
              providerValue={providerValue}
              link={item.link}
              type={type}
              mediaType={isTV ? 'series' : item?.type === 'series' ? 'series' : 'movie'}
              showName={metaTitle}
              seasonTitle={activeSeason.title}
              episodeName={item.title}
              imdbId={imdbId}
              poster={poster.poster}
              background={poster.background}
              synopsis={synopsis}
              infoUrl={routeParams.link}
              skip={item.skip || (item as any)?.skips}
              quickDownload={
                quickDownload ||
                activeSeason?.quickDownload ||
                item?.quickDownload
              }
              title={
                metaTitle.length > 30
                  ? metaTitle.slice(0, 30) + '... ' + item.title
                  : metaTitle + ' ' + item.title
              }
              fileName={
                item?.type === 'series' ||
                (activeSeason?.directLinks &&
                  activeSeason.directLinks.length > 1)
                  ? createDesktopCompatibleFileName(
                      `${metaTitle} ${item.title}`,
                      'series',
                    )
                  : createDesktopCompatibleFileName(metaTitle, 'movie')
              }
            />
          }
        />
      );
    },
    [
      isCompleted,
      stickyMenu.link,
      playHandler,
      rememberPlayerFocus,
      metaTitle,
      activeSeason.title,
      activeSeason.directLinks,
      activeSeason.quickDownload,
      playableDirectLinks,
      onLongPressHandler,
      primary,
      providerValue,
      routeParams.link,
      imdbId,
      poster.poster,
      poster.background,
      type,
      restoreDetailsLink,
      quickDownload,
      synopsis,
      selection.active,
      selection.selected,
      selection.toggle,
    ],
  );

  // Memoized server render item
  const renderServerItem = useCallback(
    (item: any, index: number) => (
      <ServerRowItem
        key={`server-${index}-${item.server}`}
        item={item}
        index={index}
        primary={primary}
        onPress={() =>
          openExternalPlayer(
            item,
            item.headers,
            `${metaTitle || ''} ${item.server || ''}`.trim(),
          )
        }
      />
    ),
    [primary, openExternalPlayer, metaTitle],
  );

  // Last played episode of this title, re-read whenever the screen regains focus.
  const continueItems = useContinueWatchingStore(state => state.items);
  const readLastPlayed = useCallback((): LastPlayed | null => {
    let stored: LastPlayed | null = null;
    try {
      const raw = cacheStorage.getString(lastPlayedKey);
      if (raw) stored = JSON.parse(raw);
    } catch {}
    // Continue watching follows every episode played, here, in the player's
    // next-episode flow, and on synced devices. When it points elsewhere than
    // the local record, it is the newer one.
    const item = continueItems.find(
      entry =>
        entry.infoUrl === routeParams.link &&
        entry.providerValue === providerValue &&
        entry.episode?.link,
    );
    if (!item) return stored;
    // Desktop plays downloads from a file path; sourceLink is the provider link.
    const link = item.episode.sourceLink || item.episode.link;
    if (stored && (stored.link === link || stored.link === item.episode.link)) {
      return stored;
    }
    return {
      season: item.seasonTitle || '',
      link,
      title: item.episode.title,
    };
  }, [lastPlayedKey, continueItems, routeParams.link, providerValue]);
  const [lastPlayed, setLastPlayed] = useState<LastPlayed | null>(readLastPlayed);
  useFocusEffect(
    useCallback(() => {
      setLastPlayed(readLastPlayed());
    }, [readLastPlayed]),
  );
  const [pendingResume, setPendingResume] = useState<string | null>(null);
  const resumeCardRef = useRef<View | null>(null);

  const seasonItems: EpisodeLink[] = rangesOnEpisodes
    ? validEpisodes
    : validDirectLinks;
  const seasonPlayable: EpisodeLink[] = rangesOnEpisodes
    ? playableEpisodes
    : playableDirectLinks;
  const lastSeason =
    lastPlayed?.season && lastPlayed.season !== activeSeason?.title
      ? LinkList.find(link => link.title === lastPlayed.season)
      : undefined;

  const resumeTarget = useMemo((): (ResumeTarget & {link?: string}) | null => {
    if (lastPlayed && lastSeason) {
      // Last episode is in another season: switch to it on press.
      return {
        mode: 'resume',
        seasonTitle: lastSeason.title,
        title: lastPlayed.title || 'Last episode',
      };
    }
    const index = lastPlayed
      ? seasonItems.findIndex(item => item.link === lastPlayed.link)
      : -1;
    if (index >= 0) {
      const item = seasonItems[index];
      const {position = 0, duration = 0} = readProgress(item.link);
      const fraction = duration > 0 ? position / duration : 0;
      if (fraction > 0.85) {
        const next = seasonItems[index + 1];
        return next ? {mode: 'next', title: next.title, link: next.link} : null;
      }
      return {
        mode: 'resume',
        title: item.title,
        link: item.link,
        progress: fraction || undefined,
        remainingSeconds: duration > 0 ? duration - position : undefined,
      };
    }
    if (seasonItems.length > 1) {
      return {mode: 'start', title: seasonItems[0].title, link: seasonItems[0].link};
    }
    return null;
  }, [lastPlayed, lastSeason, seasonItems]);

  const playLink = useCallback(
    (link: string) => {
      const index = seasonItems.findIndex(item => item.link === link);
      if (index < 0) return;
      const range = rangeForIndex(episodeRanges, index);
      if (range) selectRange(range);
      playHandler({
        linkIndex: Math.max(
          0,
          seasonPlayable.findIndex(item => item.link === link),
        ),
        type,
        primaryTitle: metaTitle,
        seasonTitle: activeSeason?.title || '',
        episodeData: seasonPlayable,
      });
    },
    [
      seasonItems,
      seasonPlayable,
      episodeRanges,
      selectRange,
      playHandler,
      type,
      metaTitle,
      activeSeason.title,
    ],
  );

  const handleResume = useCallback(() => {
    if (!resumeTarget) return;
    // On TV, focus returns to this button after the player closes.
    rememberPlayerFocus(resumeCardRef.current);
    if (lastSeason && lastPlayed) {
      setPendingResume(lastPlayed.link);
      handleSeasonChange(lastSeason);
      return;
    }
    if (resumeTarget.link) playLink(resumeTarget.link);
  }, [
    resumeTarget,
    lastSeason,
    lastPlayed,
    handleSeasonChange,
    playLink,
    rememberPlayerFocus,
  ]);

  // After switching season for a resume, play once its episodes arrive.
  useEffect(() => {
    if (!pendingResume || episodeLoading) return;
    if (lastPlayed?.season && lastPlayed.season !== activeSeason?.title) return;
    setPendingResume(null);
    const index = seasonItems.findIndex(item => item.link === pendingResume);
    if (index < 0) {
      ToastAndroid.show('Episode not found in this season', ToastAndroid.SHORT);
      return;
    }
    const {position = 0, duration = 0} = readProgress(pendingResume);
    const next = seasonItems[index + 1];
    playLink(
      duration > 0 && position / duration > 0.85 && next ? next.link : pendingResume,
    );
  }, [
    pendingResume,
    episodeLoading,
    lastPlayed,
    activeSeason?.title,
    seasonItems,
    playLink,
  ]);

  // Show loading skeleton while episodes are loading
  if (episodeLoading) {
    return (
      <View>
        {LinkList.length > 1 && (
          <DropdownField
            options={LinkList}
            value={activeSeason}
            placeholder="Select Season"
            getKey={item =>
              item.episodesLink || item.directLinks?.[0]?.link || item.title
            }
            getLabel={item => item.title || 'Unknown'}
            onChange={handleSeasonChange}
            showFullOptionLabels
          />
        )}

        <EpisodeListSkeleton />
      </View>
    );
  }

  // Show error state
  if (episodeError) {
    return (
      <View className="p-4">
        <Text className="text-red-500 text-center">
          {episodeError.message || 'Failed to load episodes. Please try again.'}
        </Text>
        <TVTouchable
          className="mt-2 bg-red-600 p-2 rounded-md"
          focusBorderRadius={6}
          onPress={() => refetchEpisodes()}>
          <Text className="text-white text-center">Retry</Text>
        </TVTouchable>
      </View>
    );
  }

  return (
    <View>
      <TVFocusGuide autoFocus={false}>
        {resumeTarget && (
          <EpisodeResumeCard
            ref={resumeCardRef}
            target={resumeTarget}
            onPress={handleResume}
          />
        )}

        {/* Season Selector */}
        <DropdownField
          options={LinkList}
          value={activeSeason}
          placeholder="Select Season"
          getKey={item =>
            item.episodesLink || item.directLinks?.[0]?.link || item.title
          }
          getLabel={item => item.title || 'Unknown'}
          onChange={handleSeasonChange}
          showFullOptionLabels
          style={{marginBottom: 8}}
        />

        {/* Search and Sort Controls */}
        {(episodeList.length > 2 ||
          (activeSeason?.directLinks && activeSeason.directLinks?.length > 2) ||
          searchText) && (
          <SeasonSearchSortBar
            searchText={searchText}
            setSearchText={setSearchText}
            sortOrder={sortOrder}
            toggleSortOrder={toggleSortOrder}
            focusBorderColor={focusBorderColor}
          />
        )}

        {episodeRanges.length > 0 && !searchText.trim() && selectedRange && (
          <EpisodeRangeChips
            ranges={episodeRanges}
            selectedStart={selectedRange.start}
            onSelect={selectRange}
          />
        )}

        {selection.active && (
          <EpisodeSelectionBar
            selectedCount={selection.selectedCount}
            allSelected={selection.allSelected}
            progress={selection.progress}
            onExit={selection.exit}
            onToggleSelectAll={selection.toggleAll}
            onCopyLinks={selection.copyLinks}
            onDownload={selection.downloadSelected}
            onCancelCopy={selection.cancelCopy}
          />
        )}
      </TVFocusGuide>

      {/* Episode/Direct Links List */}
      <View className="w-full mt-3">
        {/* Episodes List */}
        {filteredAndSortedEpisodes.length > 0 && (
          <FlatList
            data={filteredAndSortedEpisodes}
            keyExtractor={(item, index) => `episode-${item.link}-${index}`}
            renderItem={renderEpisodeItem}
            maxToRenderPerBatch={10}
            windowSize={10}
            removeClippedSubviews={!isTV}
          />
        )}

        {/* Direct Links List */}
        {filteredAndSortedDirectLinks.length > 0 && (
          <View className="w-full mt-2">
            <FlatList
              data={filteredAndSortedDirectLinks}
              keyExtractor={(item, index) => `direct-${item.link}-${index}`}
              renderItem={renderDirectLinkItem}
              maxToRenderPerBatch={10}
              windowSize={10}
              removeClippedSubviews={!isTV}
            />
          </View>
        )}

        {/* No Content Available */}
        {filteredAndSortedEpisodes.length === 0 &&
          filteredAndSortedDirectLinks.length === 0 &&
          LinkList?.length === 0 && (
            <Text
              className="min-h-20 text-lg font-semibold"
              style={{color: colors.onSurfaceVariant}}>
              No stream found
            </Text>
          )}
      </View>

      {/* VLC Loading Indicator */}
      {vlcLoading && (
        <View className="absolute top-0 left-0 w-full h-full bg-black/60 bg-opacity-50 justify-center items-center">
          <Animated.View style={[vlcLoadingAnimatedStyle]}>
            <MaterialCommunityIcons name="vlc" size={70} color={primary} />
          </Animated.View>
          <Text
            className="mt-2 text-lg font-semibold"
            style={{color: colors.onSurface}}>
            Loading available servers...
          </Text>
        </View>
      )}

      <MaterialDialogSurface
        visible={episodeDetails !== null}
        onDismiss={closeEpisodeDetails}
        style={{padding: 0}}>
        {episodeDetails ? (
          <>
            {getValidImageUri(episodeDetails.image) &&
            !episodeDetailsImageFailed ? (
              <Image
                source={{uri: getValidImageUri(episodeDetails.image)}}
                resizeMode="cover"
                resizeMethod="resize"
                onError={() => setEpisodeDetailsImageFailed(true)}
                style={{aspectRatio: 16 / 9, width: '100%'}}
              />
            ) : (
              <View
                style={{
                  alignItems: 'center',
                  aspectRatio: 16 / 9,
                  backgroundColor: colors.surfaceContainerHighest,
                  justifyContent: 'center',
                  width: '100%',
                }}>
                <MaterialCommunityIcons
                  name="image-off-outline"
                  size={44}
                  color={colors.onSurfaceVariant}
                />
              </View>
            )}
            <View style={{padding: 20}}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                <Text
                  role="titleLarge"
                  style={{
                    color: colors.onSurface,
                    fontWeight: '700',
                    flex: 1,
                    marginRight: 8,
                  }}>
                  {episodeDetails.title}
                </Text>
                {isTV && (
                  <TVFocusable
                    hasTVPreferredFocus={true}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    borderRadius={18}
                    focusScale={1}
                    focusBorderColor={focusBorderColor}
                    onPress={closeEpisodeDetails}
                    style={{padding: 4}}>
                    <MaterialCommunityIcons
                      name="close"
                      size={24}
                      color="#CCCCCC"
                    />
                  </TVFocusable>
                )}
              </View>
              <ScrollView style={{maxHeight: 230}} showsVerticalScrollIndicator={false}>
                <Text
                  role="bodyMedium"
                  style={{
                    color: colors.onSurfaceVariant,
                    lineHeight: 22,
                    marginTop: 4,
                  }}>
                  {episodeDetails.description}
                </Text>
              </ScrollView>
              {isTV && (
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="Close episode details"
                  borderRadius={14}
                  focusScale={1}
                  focusBorderColor={focusBorderColor}
                  onPress={closeEpisodeDetails}
                  style={{
                    marginTop: 16,
                    paddingVertical: 12,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 14,
                    alignItems: 'center',
                  }}>
                  <Text style={{color: '#FFFFFF', fontWeight: '600', fontSize: 15}}>
                    Close
                  </Text>
                </TVFocusable>
              )}
            </View>
          </>
        ) : null}
      </MaterialDialogSurface>

      <MaterialDialogSurface
        visible={showServerModal}
        onDismiss={() => setShowServerModal(false)}>
        <Text
          className="mb-2 text-center text-xl font-bold"
          style={{color: colors.onSurface}}>
          Select External Player Server
        </Text>
        <Text
          className="mb-4 text-center text-sm"
          style={{color: colors.onSurfaceVariant}}>
          {externalPlayerStreams.length} servers available
        </Text>

        {isLoadingStreams ? (
          <LoadingIndicator size={40} color={primary} />
        ) : (
          <>
            <ScrollView focusable={false} style={{maxHeight: 300}}>
              {externalPlayerStreams.map((item, index) =>
                renderServerItem(item, index),
              )}
              {externalPlayerStreams.length === 0 && (
                <Text
                  className="p-4 text-center"
                  style={{color: colors.onSurfaceVariant}}>
                  No servers available
                </Text>
              )}
            </ScrollView>

            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hasTVPreferredFocus={externalPlayerStreams.length === 0}
              registerScreenFocus={false}
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                marginTop: 16,
                paddingVertical: 12,
                backgroundColor: colors.secondaryContainer,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => setShowServerModal(false)}>
              <Text
                className="text-center font-bold"
                style={{color: colors.onSecondaryContainer}}>
                Cancel
              </Text>
            </TVFocusable>
          </>
        )}
      </MaterialDialogSurface>

      <MaterialDialogSurface
        visible={stickyMenu.active}
        onDismiss={() => setStickyMenu({active: false})}>
        <Text
          className="mb-4 text-xl font-bold"
          style={{color: colors.onSurface}}>
          Episode actions
        </Text>
        <View style={{gap: 10}}>
          {isCompleted(stickyMenu.link || '') ? (
            <TVFocusable
              accessibilityRole="button"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 18,
              }}
              onPress={markAsUnwatched}>
              <Ionicons name="checkmark-done" size={28} color={primary} />
              <Text style={{color: colors.onSurface}}>Mark as unwatched</Text>
            </TVFocusable>
          ) : (
            <TVFocusable
              accessibilityRole="button"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 18,
              }}
              onPress={markAsWatched}>
              <Ionicons name="checkmark" size={25} color={primary} />
              <Text style={{color: colors.onSurface}}>Mark as watched</Text>
            </TVFocusable>
          )}
          {stickyMenuEpisodes.length > 1 &&
            stickyMenuEpisodes[0].link !== stickyMenu.link && (
              <TVFocusable
                accessibilityRole="button"
                borderRadius={18}
                focusScale={1}
                focusBorderColor={focusBorderColor}
                style={{
                  height: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  backgroundColor: colors.surfaceContainerHighest,
                  borderRadius: 18,
                }}
                onPress={markPreviousAsWatched}>
                <MaterialCommunityIcons
                  name="check-all"
                  size={24}
                  color={primary}
                />
                <Text style={{color: colors.onSurface}}>
                  Mark previous as watched
                </Text>
              </TVFocusable>
            )}
          {stickyMenuEpisodes.length > 1 && (
            <TVFocusable
              accessibilityRole="button"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 18,
              }}
              onPress={markAllAsWatched}>
              <MaterialCommunityIcons
                name="eye-check-outline"
                size={24}
                color={primary}
              />
              <Text style={{color: colors.onSurface}}>
                Mark all as watched
              </Text>
            </TVFocusable>
          )}
          {stickyMenuEpisodes.length > 1 && (
            <TVFocusable
              accessibilityRole="button"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 18,
              }}
              onPress={markAllAsUnwatched}>
              <MaterialCommunityIcons
                name="eye-off-outline"
                size={24}
                color={primary}
              />
              <Text style={{color: colors.onSurface}}>
                Mark all as unwatched
              </Text>
            </TVFocusable>
          )}
          <TVFocusable
            accessibilityRole="button"
            borderRadius={18}
            focusScale={1}
            focusBorderColor={focusBorderColor}
            style={{
              height: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 18,
            }}
            onPress={() => {
              setStickyMenu({active: false});
              selection.start(stickyMenu.link);
            }}>
            <MaterialCommunityIcons
              name="checkbox-multiple-marked-outline"
              size={22}
              color={primary}
            />
            <Text style={{color: colors.onSurface}}>Select episodes</Text>
          </TVFocusable>
          <TVFocusable
            accessibilityRole="button"
            borderRadius={18}
            focusScale={1}
            focusBorderColor={focusBorderColor}
            style={{
              height: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 18,
            }}
            onPress={handleStickyMenuExternalPlayer}>
            <Feather name="external-link" size={20} color={primary} />
            <Text style={{color: colors.onSurface}}>External player</Text>
          </TVFocusable>
          {!isTV && (
            <TVFocusable
              accessibilityRole="button"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 18,
              }}
              onPress={handleStickyMenuCast}>
              <MaterialCommunityIcons name="cast" size={22} color={primary} />
              <Text style={{color: colors.onSurface}}>Cast</Text>
            </TVFocusable>
          )}
        </View>
      </MaterialDialogSurface>
    </View>
  );
};

// The empty state lives here so SeasonListContent always runs the same hooks
// when LinkList goes from empty to loaded after a refresh.
const SeasonList: React.FC<SeasonListProps> = props => {
  if (!props.LinkList || props.LinkList.length === 0) {
    return (
      <View className="p-4">
        <Text className="text-white text-center">No Streams Available</Text>
      </View>
    );
  }
  return <SeasonListContent {...props} />;
};

export default SeasonList;
