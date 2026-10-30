import React, {useCallback, useMemo, useState} from 'react';
import {
  BackHandler,
  FlatList,
  ScrollView,
  View,
  ToastAndroid,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {openExternalApp} from '../../lib/externalApps';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {RootStackParamList} from '../../App';
import {
  getEpisodeLabel,
  naturalCompare,
  type LocalTitle,
} from '../../lib/localContent/model';
import {getLocalPlayerParams} from '../../lib/localContent/playback';
import {
  markLocalEpisodesWatched,
  readLocalProgress,
} from '../../lib/localContent/progress';
import {settingsStorage} from '../../lib/storage';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import {SeasonSearchSortBar} from '../season/SeasonSearchSortBar';
import {EpisodeCardRow} from '../SeasonList';
import {TVFocusable} from '../tv';
import DropdownField from '../ui/DropdownField';
import AppText from '../ui/Text';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import LocalVideoThumbnail from './LocalVideoThumbnail';
import LocalResumeCard from './LocalResumeCard';

/** Browsing actions shared by Library and Continue Watching. File deletion lives in Downloads. */
export default function LocalEpisodeList({title}: {title: LocalTitle}) {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [season, setSeason] = useState('');
  const [descending, setDescending] = useState(false);
  const [searchText, setSearchText] = useState('');
  const focusBorderColor = useTVFocusBorderColor();
  const [actionUri, setActionUri] = useState<string | null>(null);
  const [detailsUri, setDetailsUri] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [, refreshProgress] = useState(0);
  useFocusEffect(
    useCallback(() => {
      refreshProgress(value => value + 1);
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      if (!selection) return;
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        setSelection(null);
        return true;
      });
      return () => listener.remove();
    }, [selection]),
  );
  const seasons = useMemo(
    () =>
      [...new Set(title.episodes.map(episode => episode.folder))].sort(
        naturalCompare,
      ),
    [title.episodes],
  );
  const activeSeason = seasons.includes(season) ? season : seasons[0];
  const episodes = useMemo(
    () =>
      title.episodes
        .filter(episode => episode.folder === activeSeason)
        .sort((a, b) => naturalCompare(a.name, b.name)),
    [title.episodes, activeSeason],
  );
  const shown = useMemo(() => {
    const matches = episodes.filter(episode =>
      getEpisodeLabel(episode, title)
        .toLowerCase()
        .includes(searchText.trim().toLowerCase()),
    );
    return descending ? [...matches].reverse() : matches;
  }, [episodes, descending, searchText, title]);
  const metadataByUri = useMemo(() => {
    const byNumber = new Map(
      title.metadata?.videos?.map(video => [
        `${video.season}:${video.episode}`,
        video,
      ]) || [],
    );
    return new Map(
      title.episodes.map(episode => [
        episode.uri,
        byNumber.get(`${episode.season}:${episode.episode}`),
      ]),
    );
  }, [title.episodes, title.metadata?.videos]);
  const metadataFor = (uri: string) => metadataByUri.get(uri);
  const completed = (uri: string) => {
    const progress = readLocalProgress(uri);
    return (
      progress.duration > 0 && progress.position / progress.duration > 0.85
    );
  };
  const play = (uri: string, cast = false) => {
    const params = getLocalPlayerParams(title, uri);
    if (params)
      navigation.navigate('Player', {
        ...params,
        alwaysCast: !isTV && (cast || settingsStorage.isAlwaysCastMode()),
      });
  };
  const toggle = (uri: string) =>
    setSelection(previous => {
      const next = new Set(previous || []);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  const mark = (uris: string[], watched: boolean) => {
    markLocalEpisodesWatched(title, uris, watched);
    setActionUri(null);
    setSelection(null);
    refreshProgress(value => value + 1);
  };
  const actionEpisode = episodes.find(episode => episode.uri === actionUri);
  const selectedUris = episodes
    .filter(episode => selection?.has(episode.uri))
    .map(episode => episode.uri);
  const detailEpisode = title.episodes.find(
    episode => episode.uri === detailsUri,
  );
  const action = (label: string, onPress: () => void, preferred = false) => (
    <TVFocusable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred}
      registerScreenFocus={false}
      onPress={onPress}
      borderRadius={18}
      focusScale={1}
      style={{
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: colors.surfaceContainerHighest,
      }}>
      <AppText style={{color: colors.onSurface}}>{label}</AppText>
    </TVFocusable>
  );
  return (
    <View style={{gap: 16}}>
      <LocalResumeCard title={title} />
      <DropdownField
        options={seasons}
        value={activeSeason}
        getKey={value => value}
        getLabel={value => value}
        onChange={value => {
          setSeason(value);
          setSelection(null);
        }}
        placeholder="Select season"
        showFullOptionLabels
      />
      <SeasonSearchSortBar
        searchText={searchText}
        setSearchText={setSearchText}
        sortOrder={descending ? 'desc' : 'asc'}
        toggleSortOrder={() => setDescending(value => !value)}
        focusBorderColor={focusBorderColor}
      />
      {selection && (
        <View style={{gap: 8}}>
          <AppText style={{color: colors.onSurface}}>
            {selection.size} selected
          </AppText>
          {action('Select all', () =>
            setSelection(new Set(episodes.map(episode => episode.uri))),
          )}
          {action('Invert selection', () =>
            setSelection(
              new Set(
                episodes
                  .filter(episode => !selection.has(episode.uri))
                  .map(episode => episode.uri),
              ),
            ),
          )}
          {action('Mark selected as watched', () => mark(selectedUris, true))}
          {action('Mark selected as unwatched', () =>
            mark(selectedUris, false),
          )}
          {action('Done', () => setSelection(null))}
        </View>
      )}
      <FlatList
        scrollEnabled={false}
        data={shown}
        keyExtractor={episode => episode.uri}
        ListEmptyComponent={
          <AppText style={{color: colors.onSurfaceVariant}}>
            No video files. Pull down to rescan the folder.
          </AppText>
        }
        renderItem={({item, index}) => {
          const metadata = metadataFor(item.uri);
          return (
            <EpisodeCardRow
              item={{link: item.uri, description: metadata?.overview}}
              index={index}
              isFirst={index === 0}
              displayTitle={getEpisodeLabel(item, title)}
              primary={colors.primary}
              isCompleted={completed(item.uri)}
              isSticky={actionUri === item.uri}
              thumbnail={
                <LocalVideoThumbnail
                  uri={item.uri}
                  image={metadata?.thumbnail}
                />
              }
              onPress={() => (selection ? toggle(item.uri) : play(item.uri))}
              onLongPress={() =>
                selection ? toggle(item.uri) : setActionUri(item.uri)
              }
              selected={selection ? selection.has(item.uri) : undefined}
              selectionMark={
                selection ? (
                  <MaterialCommunityIcons
                    name={
                      selection.has(item.uri)
                        ? 'checkbox-marked'
                        : 'checkbox-blank-outline'
                    }
                    color={colors.primary}
                    size={24}
                  />
                ) : undefined
              }
              onShowDetails={
                metadata?.overview ? () => setDetailsUri(item.uri) : undefined
              }
              downloadComponent={
                !selection ? (
                  <TVFocusable
                    accessibilityRole="button"
                    accessibilityLabel={`Episode actions for ${getEpisodeLabel(item, title)}`}
                    onPress={() => setActionUri(item.uri)}
                    borderRadius={24}
                    style={{padding: 12}}>
                    <MaterialCommunityIcons
                      name="dots-vertical"
                      color={colors.primary}
                      size={24}
                    />
                  </TVFocusable>
                ) : undefined
              }
            />
          );
        }}
      />
      <MaterialDialogSurface
        visible={!!actionEpisode}
        onDismiss={() => setActionUri(null)}>
        <AppText
          role="titleLarge"
          style={{color: colors.onSurface, marginBottom: 16}}>
          Episode actions
        </AppText>
        <ScrollView style={{maxHeight: 400}} contentContainerStyle={{gap: 10}}>
          {actionEpisode && (
            <>
              {action(
                completed(actionEpisode.uri)
                  ? 'Mark as unwatched'
                  : 'Mark as watched',
                () => mark([actionEpisode.uri], !completed(actionEpisode.uri)),
                true,
              )}
              {episodes[0]?.uri !== actionEpisode.uri &&
                action('Mark previous as watched', () =>
                  mark(
                    episodes
                      .slice(0, episodes.indexOf(actionEpisode) + 1)
                      .map(episode => episode.uri),
                    true,
                  ),
                )}
              {episodes.length > 1 &&
                action('Mark all as watched', () =>
                  mark(
                    episodes.map(episode => episode.uri),
                    true,
                  ),
                )}
              {episodes.length > 1 &&
                action('Mark all as unwatched', () =>
                  mark(
                    episodes.map(episode => episode.uri),
                    false,
                  ),
                )}
              {action('Select episodes', () => {
                setSelection(new Set([actionEpisode.uri]));
                setActionUri(null);
              })}
              {action('External player', () => {
                setActionUri(null);
                openExternalApp('player', actionEpisode.uri, 'video/*').catch(() =>
                  ToastAndroid.show(
                    'Could not open an external player',
                    ToastAndroid.LONG,
                  ),
                );
              })}
              {!isTV &&
                action('Cast', () => {
                  setActionUri(null);
                  play(actionEpisode.uri, true);
                })}
            </>
          )}
        </ScrollView>
      </MaterialDialogSurface>
      <MaterialDialogSurface
        visible={!!detailEpisode}
        onDismiss={() => setDetailsUri(null)}>
        <AppText
          role="titleLarge"
          style={{color: colors.onSurface, marginBottom: 12}}>
          {detailEpisode && getEpisodeLabel(detailEpisode, title)}
        </AppText>
        <ScrollView style={{maxHeight: 300}}>
          <AppText style={{color: colors.onSurfaceVariant}}>
            {detailsUri && metadataFor(detailsUri)?.overview}
          </AppText>
        </ScrollView>
        {action('Close', () => setDetailsUri(null), true)}
      </MaterialDialogSurface>
    </View>
  );
}
