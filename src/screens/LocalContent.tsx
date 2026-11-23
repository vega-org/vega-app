import {
  ImportAction,
  MetadataPicker,
} from '../components/metadata/MetadataPicker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LibraryIcon from '../components/library/LibraryIcon';
import {Host, Switch} from '@expo/ui/jetpack-compose';
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {WatchListStackParamList} from '../App';
import AppText from '../components/ui/Text';
import {TVFocusable, TVFocusGuide} from '../components/tv';
import {isTV} from '../lib/tv/constants';
import {useM3Colors, useM3HostTheme} from '../theme/M3PaletteContext';
import {listLocalFolder, pickLocalFolder} from '../lib/localContent/files';
import {prepareLocalImport, type LocalTitle} from '../lib/localContent/model';
import useLocalContentStore from '../lib/zustand/localContentStore';
import useWatchListStore from '../lib/zustand/watchListStore';
import {DEFAULT_COLLECTION_ID} from '../lib/storage/WatchListStorage';
import {releasePersistableUriPermission} from '../lib/uriPermission';
import {settingsStorage} from '../lib/storage/SettingsStorage';

function ImportReview({
  title,
  index,
  total,
  preferredCollection,
  onSave,
  onSkip,
  onCancel,
  picker,
  setPicker,
  focusEpoch,
}: {
  title: LocalTitle;
  index: number;
  total: number;
  preferredCollection?: string;
  onSave: (title: LocalTitle) => void;
  onSkip?: () => void;
  onCancel: () => void;
  picker: boolean;
  setPicker: (value: boolean) => void;
  focusEpoch: number;
}) {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const [useMetadataTitles, setUseMetadataTitles] = useState(
    title.useMetadataTitles,
  );
  const collections = useWatchListStore(state => state.collections);
  const [metadata, setMetadata] = useState(title.metadata);
  const [selectedCollections, setSelectedCollections] = useState(
    () =>
      title.collections?.filter(id => collections.some(c => c.id === id)) ||
      (preferredCollection
        ? [preferredCollection]
        : collections.some(c => c.id === DEFAULT_COLLECTION_ID)
          ? [DEFAULT_COLLECTION_ID]
          : collections.slice(0, 1).map(c => c.id)),
  );
  if (picker)
    return (
      <MetadataPicker
        title={{...title, metadata}}
        onBack={() => setPicker(false)}
        onChoose={value => {
          setMetadata(value);
          setPicker(false);
        }}
      />
    );
  return (
    <TVFocusGuide
      autoFocus
      trapFocusLeft
      trapFocusRight
      trapFocusUp
      trapFocusDown
      style={{flex: 1}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}>
        <AppText role="titleLarge" style={{color: colors.onSurface}}>
          {onSkip ? `Import ${index + 1} of ${total}` : 'Import title'}
        </AppText>
        <ImportAction label="Cancel" onPress={onCancel} />
      </View>
      <ScrollView
        focusable={false}
        accessible={false}
        contentContainerStyle={{gap: 24, paddingBottom: 24}}>
        <View style={{gap: 6}}>
          <AppText role="headlineSmall" style={{color: colors.onSurface}}>
            {title.name}
          </AppText>
          <AppText style={{color: colors.onSurfaceVariant}}>
            {title.episodes.length} video files ·{' '}
            {new Set(title.episodes.map(e => e.folder)).size} folders
          </AppText>
        </View>
        <View
          style={{
            backgroundColor: colors.surfaceContainer,
            padding: 18,
            borderRadius: 20,
            gap: 16,
          }}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>
            Movie or series
          </AppText>
          {metadata ? (
            <View style={{flexDirection: 'row', gap: 16, alignItems: 'center'}}>
              {metadata.poster && (
                <Image
                  source={{uri: metadata.poster}}
                  style={{width: 64, height: 96, borderRadius: 8}}
                />
              )}
              <View style={{flex: 1, gap: 6}}>
                <AppText role="titleLarge" style={{color: colors.onSurface}}>
                  {metadata.title}
                </AppText>
                <AppText style={{color: colors.onSurfaceVariant}}>
                  {[
                    metadata.year,
                    metadata.type === 'series' ? 'Series' : 'Movie',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
                <AppText style={{color: colors.onSurfaceVariant}}>
                  {metadata.imdbId}
                </AppText>
              </View>
            </View>
          ) : (
            <AppText style={{color: colors.onSurfaceVariant}}>
              Choose a title for artwork, synopsis and episode names. Otherwise
              the folder and file names will be used.
            </AppText>
          )}
          <ImportAction
            label={
              metadata ? 'Change movie or series' : 'Choose movie or series'
            }
            preferredFocus
            focusEpoch={focusEpoch}
            onPress={() => setPicker(true)}
          />
          {metadata && (
            <ImportAction
              label="Use folder name instead"
              onPress={() => setMetadata(undefined)}
            />
          )}
        </View>
        <TVFocusable
          accessibilityRole="switch"
          accessibilityLabel="Metadata names"
          accessibilityState={{checked: useMetadataTitles}}
          onPress={() => setUseMetadataTitles(value => !value)}
          borderRadius={20}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            padding: 16,
            borderRadius: 20,
            backgroundColor: colors.surfaceContainer,
          }}>
          <View style={{flex: 1, gap: 4}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              Metadata names
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
              Use matched movie and episode titles. Unmatched files keep their
              names.
            </AppText>
          </View>
          <View
            pointerEvents={isTV ? 'none' : 'auto'}
            importantForAccessibility={isTV ? 'no-hide-descendants' : 'auto'}
            style={{width: 52, height: 48}}>
            <Host matchContents {...hostTheme} style={{width: 52, height: 48}}>
              <Switch
                enabled={!isTV}
                value={useMetadataTitles}
                onCheckedChange={setUseMetadataTitles}
                colors={{
                  checkedTrackColor: colors.primary,
                  checkedThumbColor: colors.onPrimary,
                  checkedBorderColor: colors.primary,
                  uncheckedTrackColor: colors.surfaceContainerHighest,
                  uncheckedThumbColor: colors.outline,
                  uncheckedBorderColor: colors.outline,
                }}
              />
            </Host>
          </View>
        </TVFocusable>
        <View style={{gap: 14}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>
            Save to library
          </AppText>
          <View style={{gap: 8}}>
            {collections.map(collection => {
              const selected = selectedCollections.includes(collection.id);
              return (
                <TVFocusable
                  key={collection.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={collection.name}
                  accessibilityState={{checked: selected}}
                  borderRadius={16}
                  onPress={() =>
                    setSelectedCollections(ids =>
                      ids.includes(collection.id)
                        ? ids.filter(id => id !== collection.id)
                        : [...ids, collection.id],
                    )
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    padding: 12,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: selected
                      ? colors.primary
                      : colors.outlineVariant,
                    backgroundColor: selected
                      ? colors.secondaryContainer
                      : colors.surfaceContainerHigh,
                  }}>
                  <LibraryIcon
                    icon={collection.icon || 'popcorn'}
                    color={collection.color}
                    size={22}
                    tile
                  />
                  <AppText
                    role="titleMedium"
                    style={{flex: 1, color: colors.onSurface}}>
                    {collection.name}
                  </AppText>
                  <MaterialCommunityIcons
                    name={
                      selected
                        ? 'checkbox-marked-circle'
                        : 'checkbox-blank-circle-outline'
                    }
                    size={24}
                    color={selected ? colors.primary : colors.onSurfaceVariant}
                  />
                </TVFocusable>
              );
            })}
          </View>
          <AppText style={{color: colors.onSurfaceVariant}}>
            {collections.length
              ? 'Choose one or more categories.'
              : 'The title will appear under All.'}
          </AppText>
        </View>
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: onSkip ? 'space-between' : 'flex-end',
          gap: 12,
          paddingTop: 12,
        }}>
        {onSkip && <ImportAction label="Skip folder" onPress={onSkip} />}
        <ImportAction
          label={index + 1 === total ? 'Import' : 'Next'}
          primary
          disabled={collections.length > 0 && selectedCollections.length === 0}
          onPress={() =>
            onSave({
              ...title,
              metadata,
              useMetadataTitles,
              collections: selectedCollections,
              inLibrary: true,
            })
          }
        />
      </View>
    </TVFocusGuide>
  );
}

function releaseUnusedRoot(root?: string) {
  if (
    !root ||
    useLocalContentStore.getState().titles.some(title => title.rootUri === root)
  )
    return;
  const downloads = settingsStorage.getDownloadLocationConfig();
  if (downloads?.type === 'saf' && downloads.uri === root) return;
  releasePersistableUriPermission(root);
}

export default function LocalContent({
  navigation,
  route,
}: NativeStackScreenProps<WatchListStackParamList, 'LocalContent'>) {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const GuideContainer = isTV ? TVFocusable : View;
  const [review, setReview] = useState<LocalTitle[]>([]);
  const [index, setIndex] = useState(0);
  const [bulkImport, setBulkImport] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [focusEpoch, setFocusEpoch] = useState(0);
  const staged = useRef<LocalTitle[]>([]);
  const root = useRef<string | undefined>(undefined);
  const task = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      task.current?.abort();
      releaseUnusedRoot(root.current);
    },
    [],
  );
  useEffect(() => {
    const title = useLocalContentStore
      .getState()
      .titles.find(t => t.id === route.params?.editId);
    if (title) {
      setReview([title]);
      setIndex(0);
    }
  }, [route.params?.editId]);
  const cancel = () => {
    setPicker(false);
    task.current?.abort();
    setReview([]);
    staged.current = [];
    releaseUnusedRoot(root.current);
    root.current = undefined;
    if (route.params?.editId) navigation.goBack();
  };
  const scan = async (bulk: boolean) => {
    if (task.current) return;
    setBulkImport(bulk);
    const controller = new AbortController();
    task.current = controller;
    setBusy('Choose a folder');
    setError('');
    try {
      const folder = await pickLocalFolder();
      if (!folder) return;
      root.current = folder.uri;
      if (controller.signal.aborted) {
        releaseUnusedRoot(root.current);
        return;
      }
      const titles = await prepareLocalImport(
        folder,
        bulk,
        listLocalFolder,
        useLocalContentStore.getState().titles,
        controller.signal,
        name => setBusy(`Scanning ${name}…`),
      );
      if (controller.signal.aborted) return;
      if (!titles.length)
        throw new Error('No supported video files found in this folder.');
      staged.current = [];
      setIndex(0);
      setReview(titles);
    } catch (cause) {
      releaseUnusedRoot(root.current);
      root.current = undefined;
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Import failed');
    } finally {
      task.current = null;
      setBusy('');
    }
  };
  const advance = (title?: LocalTitle) => {
    if (title) staged.current.push(title);
    setPicker(false);
    if (index + 1 < review.length) {
      setIndex(index + 1);
      return;
    }
    useLocalContentStore.getState().saveTitles(staged.current);
    staged.current = [];
    setReview([]);
    releaseUnusedRoot(root.current);
    root.current = undefined;
    if (route.params?.editId || navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate('WatchList');
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top + 16,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 20,
        gap: 24,
      }}>
      {review.length === 0 && (
        <TVFocusGuide autoFocus trapFocusRight style={{flex: 1, gap: 24}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 16}}>
            <ImportAction
              preferredFocus
              label="Back"
              onPress={() => navigation.goBack()}
            />
            <AppText
              role="headlineSmall"
              style={{color: colors.onSurface, flex: 1}}>
              Import local content
            </AppText>
          </View>
          <ScrollView
            focusable={false}
            accessible={false}
            style={{flex: 1}}
            contentContainerStyle={{gap: 24, paddingBottom: 12}}>
            <AppText style={{color: colors.onSurfaceVariant}}>
              Add your movies and series to Library. Choose their artwork and a
              library category after selecting the folder.
            </AppText>
            <View
              style={{
                backgroundColor: colors.surfaceContainer,
                borderRadius: 24,
                padding: 20,
                gap: 12,
              }}>
              <AppText role="titleLarge" style={{color: colors.onSurface}}>
                One movie or series
              </AppText>
              <AppText style={{color: colors.onSurfaceVariant}}>
                Select its folder. Subfolders become seasons.
              </AppText>
              <ImportAction
                label="Import folder"
                primary
                disabled={!!busy}
                onPress={() => {
                  scan(false);
                }}
              />
            </View>
            <View
              style={{
                backgroundColor: colors.surfaceContainer,
                borderRadius: 24,
                padding: 20,
                gap: 12,
              }}>
              <AppText role="titleLarge" style={{color: colors.onSurface}}>
                Several movies or series
              </AppText>
              <AppText style={{color: colors.onSurfaceVariant}}>
                Select a parent folder. Review each title before importing.
              </AppText>
              <ImportAction
                label="Bulk import"
                disabled={!!busy}
                onPress={() => {
                  scan(true);
                }}
              />
            </View>
            <GuideContainer
              accessibilityLabel="How to arrange your folders"
              style={{
                backgroundColor: colors.surfaceContainer,
                borderRadius: 20,
                padding: 20,
                gap: 12,
              }}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>
                How to arrange your folders
              </AppText>
              <AppText style={{color: colors.onSurfaceVariant}}>
                For one title, select the movie or series folder. For bulk
                import, select the parent folder containing a folder for each
                movie or series.
              </AppText>
              <View
                style={{
                  backgroundColor: colors.surfaceContainerHigh,
                  borderRadius: 12,
                  padding: 16,
                }}>
                <AppText
                  role="bodySmall"
                  style={{
                    color: colors.onSurface,
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    lineHeight: 22,
                  }}>
                  {
                    'Media/  ← Bulk import\n  Movie/\n    Movie.mp4\n  Series/  ← Import folder\n    Bonus.mkv\n    Season 1/\n      S01E01.mkv\n      S01E02.mkv\n    Season 2/\n      S02E01.mkv'
                  }
                </AppText>
              </View>
              <AppText style={{color: colors.onSurfaceVariant}}>
                Subfolder names appear in the season dropdown. Files directly
                inside a title folder appear under Default. Nested folders are
                included too.
              </AppText>
              <AppText style={{color: colors.onSurfaceVariant}}>
                Use episode names like S01E01 or 1x01 to match episode metadata.
                Files that cannot be matched keep their original names. IMDb
                matching is optional.
              </AppText>
            </GuideContainer>
            {!!busy && (
              <View style={{flexDirection: 'row', gap: 12}}>
                <ActivityIndicator color={colors.primary} />
                <AppText style={{color: colors.onSurface}}>{busy}</AppText>
              </View>
            )}
            {!!error && (
              <AppText accessibilityRole="alert" style={{color: colors.error}}>
                {error}
              </AppText>
            )}
          </ScrollView>
        </TVFocusGuide>
      )}
      <Modal
        visible={review.length > 0}
        animationType="slide"
        onShow={() => setFocusEpoch(value => value + 1)}
        onRequestClose={() => (picker ? setPicker(false) : cancel())}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 16,
          }}>
          {review[index] && (
            <ImportReview
              key={review[index].id}
              title={review[index]}
              index={index}
              total={review.length}
              preferredCollection={route.params?.collectionId}
              onSave={advance}
              onSkip={bulkImport ? () => advance() : undefined}
              onCancel={cancel}
              picker={picker}
              setPicker={setPicker}
              focusEpoch={focusEpoch}
            />
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
