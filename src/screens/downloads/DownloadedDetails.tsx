import ImportedFileDetails from './components/ImportedFileDetails';
import DetailsHero from './components/DetailsHero';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  BackHandler,
  ScrollView,
  StatusBar,
  Text,
  View,
  findNodeHandle,
  UIManager,
} from 'react-native';
import type {DownloadsStackParamList, RootStackParamList} from '../../App';
import ManagedEpisodeSelectionBar from '../../components/ManagedEpisodeSelectionBar';
import AppDialog from '../../components/AppDialog';
import EpisodeListSkeleton from '../../components/EpisodeListSkeleton';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import DropdownField from '../../components/ui/DropdownField';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import {downloadOutputExists} from '../../lib/downloadDestination';
import {settingsStorage} from '../../lib/storage';
import {formatDownloadBytes} from '../../lib/downloadFormatting';
import {
  groupCompletedDownloads,
  sortDownloadedEpisodes,
} from '../../lib/downloadLibrary';
import type {DownloadItem} from '../../lib/zustand/downloadsStore';
import useDownloadsStore, {
  selectCompletedDownloads,
} from '../../lib/zustand/downloadsStore';
import {useShallow} from 'zustand/react/shallow';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {useArtworkShape} from '../../lib/hooks/useHomePageData';
import {useDownloadedTitleValidation} from '../../lib/hooks/useDownloadedTitleValidation';
import DownloadedEpisodeControls from './components/DownloadedEpisodeControls';
import DownloadedEpisodeRow from './components/DownloadedEpisodeRow';
import {deleteDownloadedItemAndSubtitles} from './utils/deleteDownloadedItem';

type DownloadedDetailsProps = CompositeScreenProps<
  NativeStackScreenProps<DownloadsStackParamList, 'DownloadedDetails'>,
  NativeStackScreenProps<RootStackParamList>
>;

const getSeasonTitle = (item: DownloadItem): string =>
  item.seasonTitle || 'Downloaded';

const DownloadedFileDetails = ({navigation, route}: DownloadedDetailsProps) => {
  const playerReturnFocusRef = useRef<View | null>(null);
  const restorePlayerFocusRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!isTV || !restorePlayerFocusRef.current) return;
      const timer = setTimeout(() => {
        const handle = findNodeHandle(playerReturnFocusRef.current);
        if (handle) {
          UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
        }
        restorePlayerFocusRef.current = false;
      }, 350);
      return () => clearTimeout(timer);
    }, []),
  );
  const colors = useM3Colors();
  const primary = colors.primary;
  const focusBorderColor = useTVFocusBorderColor();
  const completed = useDownloadsStore(useShallow(selectCompletedDownloads));
  const markMissing = useDownloadsStore(state => state.markMissing);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DownloadItem[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelection = (item: DownloadItem) => setSelectedIds(current => {const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;});
  const exitSelection = () => {setSelecting(false); setSelectedIds(new Set());};
  const group = useMemo(
    () =>
      groupCompletedDownloads(completed).find(
        item => item.id === route.params.groupId,
      ),
    [completed, route.params.groupId],
  );
  const seasons = useMemo(
    () => [...new Set(group?.items.map(getSeasonTitle) || [])],
    [group],
  );
  const seasonOptions = useMemo(
    () => seasons.map(title => ({title})),
    [seasons],
  );
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(
    seasons[0],
  );

  useEffect(() => {
    if (!selectedSeason || !seasons.includes(selectedSeason)) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  const [searchText, setSearchText] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selecting) {exitSelection();} else navigation.goBack();
        return true;
      });
      return () => backSub.remove();
    }, [navigation, selecting]),
  );

  const items = useMemo(() => {
    if (!group) {
      return [];
    }
    let list = sortDownloadedEpisodes(
      group.items.filter(item => getSeasonTitle(item) === selectedSeason),
    );
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      list = list.filter(item =>
        (item.episodeName || item.title || '').toLowerCase().includes(query),
      );
    }
    if (sortOrder === 'desc') {
      list = [...list].reverse();
    }
    return list;
  }, [group, selectedSeason, searchText, sortOrder]);

  const seasonRecordIds = useMemo(
    () => (group?.items || [])
      .filter(item => getSeasonTitle(item) === selectedSeason)
      .map(item => item.id),
    [group, selectedSeason],
  );
  const isValidating = useDownloadedTitleValidation(
    JSON.stringify([route.params.groupId, selectedSeason]),
    seasonRecordIds,
  );

  // Posters and small images are blurred behind the header, with the sharp
  // poster shown above the title instead of stretched across it. Hooks stay
  // above the early return: the group disappears when its last file is deleted.
  const artworkUri = group?.items[0]?.background || group?.items[0]?.poster;
  const {ready: backdropReady, posterLike} = useArtworkShape(artworkUri);

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-6">
        <Text className="text-center text-white/70">
          This downloaded title is no longer available.
        </Text>
        <TVFocusable
          hasTVPreferredFocus={isTV}
          accessibilityRole="button"
          borderRadius={14}
          focusScale={1.05}
          focusBorderColor={focusBorderColor}
          style={{
            backgroundColor: primary,
            borderRadius: 14,
            marginTop: 20,
            paddingHorizontal: 24,
            paddingVertical: 12,
          }}
          onPress={() => navigation.goBack()}>
          <Text className="font-semibold" style={{color: colors.onPrimary}}>
            Go back
          </Text>
        </TVFocusable>
      </View>
    );
  }

  const metadata = group.items[0];
  const totalBytes = group.items.reduce(
    (total, item) => total + item.totalBytes,
    0,
  );

  const playItem = async (item: DownloadItem) => {
    const exists = await downloadOutputExists(item.filePath).catch(() => undefined);
    if (exists === undefined) {
      showAppDialog({title: 'Unable to check download', message: 'The download folder could not be accessed. Check its permission and try again.', actions: [{label: 'OK'}]});
      return;
    }
    if (!exists) {
      markMissing(item.id);
      return;
    }
    const playableItems = items.filter(
      candidate => candidate.status === 'completed',
    );
    navigation.navigate('Player', {
      episodeList: playableItems.map(candidate => ({
        id: candidate.id,
        title: candidate.episodeName || candidate.title,
        link: candidate.filePath,
        sourceLink: candidate.sourceLink,
        skip: candidate.skip,
      })),
      linkIndex: playableItems.findIndex(candidate => candidate.id === item.id),
      type: item.type || (playableItems.length > 1 ? 'series' : 'movie'),
      directUrl: item.filePath,
      primaryTitle: group.title,
      secondaryTitle: item.seasonTitle,
      poster: {
        poster: metadata.poster,
        background: metadata.background,
      },
      providerValue: item.provider || metadata.provider || 'vega',
      infoUrl: item.infoUrl || metadata.infoUrl,
      alwaysCast: !isTV && settingsStorage.isAlwaysCastMode(),
    });
  };

  // Promise chain instead of try/finally: React Compiler skips any component
  // that contains a finally clause.
  const deleteItems = async (targets: DownloadItem[]) => {
    if (deletingId || !targets.length) return;
    setDeletingId(targets[0].id);
    try {
      for (const item of targets) await deleteDownloadedItemAndSubtitles(item);
      exitSelection();
    } catch (error) {
      showAppDialog({title: 'Could not delete all files', message: error instanceof Error ? error.message : String(error), actions: [{label: 'OK'}]});
    } finally {
      setDeletingId(null);
    }
  };

  const backgroundImage =
    metadata.background ||
    metadata.poster ||
    'https://placehold.jp/24/171717/ffffff/800x450.png?text=Vega';
  const hasArtwork = !!(metadata.background || metadata.poster);

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} style={{flex: 1, backgroundColor: '#000000'}}>
      <StatusBar translucent backgroundColor="transparent" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: selecting ? 120 : 0}}>
        <DetailsHero
          title={group.title}
          backgroundImage={backgroundImage}
          posterLike={posterLike}
          backdropReady={backdropReady}
          hasArtwork={hasArtwork}
          synopsis={metadata.synopsis}
          subtitleRow={
            <View className="mt-3 flex-row items-center">
              <MaterialCommunityIcons
                name="download-circle-outline"
                size={18}
                color={colors.primary}
              />
              <Text
                className="ml-2 text-sm font-medium"
                style={{color: colors.onSurfaceVariant}}>
                {`${group.items.length} download${
                  group.items.length === 1 ? '' : 's'
                }`}
                {'  '}·{'  '}
                {formatDownloadBytes(totalBytes)}
              </Text>
            </View>
          }
          onBack={() => navigation.goBack()}
        />

        <View className={`bg-black px-5 pb-6 ${metadata.synopsis ? '' : 'pt-3'}`}>
          {seasonOptions.length > 0 ? (
            <DropdownField
              options={seasonOptions}
              value={seasonOptions.find(
                option => option.title === selectedSeason,
              )}
              getKey={option => option.title}
              getLabel={option => option.title}
              onChange={option => setSelectedSeason(option.title)}
            />
          ) : null}

          {/* Search and Sort Controls */}
          {(group.items.length > 2 || searchText) && (
            <DownloadedEpisodeControls
              searchText={searchText}
              onSearchChange={setSearchText}
              sortOrder={sortOrder}
              onToggleSort={() =>
                setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
              }
            />
          )}

          <Text
            className="mb-3 mt-7 text-xl font-bold"
            style={{color: colors.onBackground}}>
            Ready to watch
          </Text>
          {!isValidating && items.length === 0 && searchText ? (
            <Text
              className="my-4 text-center text-sm"
              style={{color: colors.onSurfaceVariant}}>
              No downloaded episodes found for "{searchText}"
            </Text>
          ) : null}

          {isValidating ? (
            <EpisodeListSkeleton downloaded />
          ) : items.map(item => (
            <DownloadedEpisodeRow
              key={item.id}
              item={item}
              isDeleting={!!deletingId}
              selecting={selecting}
              selected={selectedIds.has(item.id)}
              onToggleSelection={toggleSelection}
              onStartSelection={episode => {setSelecting(true); toggleSelection(episode);}}
              onPlay={playItem}
              onBeforePlay={control => {
                if (!isTV) return;
                playerReturnFocusRef.current = control;
                restorePlayerFocusRef.current = true;
              }}
              onDelete={episode => setPendingDelete([episode])}
            />
          ))}
        </View>
        <View className="h-16" />
      </ScrollView>
      {selecting && <ManagedEpisodeSelectionBar count={selectedIds.size} busy={!!deletingId} allSelected={items.length > 0 && items.every(item => selectedIds.has(item.id))} onDone={exitSelection}
        onSelectAll={() => setSelectedIds(current => {const next = new Set(current); const all = items.every(item => next.has(item.id)); for (const item of items) {if (all) next.delete(item.id); else next.add(item.id);} return next;})}
        onInvertSelection={() => setSelectedIds(current => {const next = new Set(current); for (const item of items) {if (next.has(item.id)) next.delete(item.id); else next.add(item.id);} return next;})}
        onDelete={() => setPendingDelete(group.items.filter(item => selectedIds.has(item.id)))} />}
      <AppDialog
        visible={pendingDelete.length > 0}
        title={pendingDelete.length > 1 ? `Delete ${pendingDelete.length} downloads?` : "Delete download?"}
        message={`Remove ${
          pendingDelete.length > 1 ? `${pendingDelete.length} downloaded episodes` : pendingDelete[0]?.episodeName || pendingDelete[0]?.title || 'this download'
        } from your device?`}
        primary={primary}
        variant="warning"
        actions={[
          {label: 'Cancel'},
          {
            label: 'Delete',
            variant: 'destructive',
            onPress: () => {
              const targets = pendingDelete;
              setPendingDelete([]);
              deleteItems(targets);
            },
          },
        ]}
        onDismiss={() => setPendingDelete([])}
      />
    </TVFocusGuide>
  );
};

export default function DownloadedDetails(props: DownloadedDetailsProps) {
  return props.route.params.localTitleId
    ? <ImportedFileDetails id={props.route.params.localTitleId} onBack={() => props.navigation.goBack()} />
    : <DownloadedFileDetails {...props} />;
}
