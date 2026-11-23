import {Pressable, ScrollView, View, TextInput, StyleSheet} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Slider from '../components/Slider';
import ScreenSafeArea from '../components/ui/ScreenSafeArea';
import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SearchStackParamList} from '../App';
import {providerManager} from '../lib/services/ProviderManager';
import useContentStore from '../lib/zustand/contentStore';
import AppText from '../components/ui/Text';
import LoadingIndicator from '../components/ui/LoadingIndicator';
import IconButton from '../components/ui/IconButton';
import Button from '../components/ui/Button';
import {TVFocusGuide, TVFocusable} from '../components/tv';
import {isTV} from '../lib/tv';
import {useM3Colors} from '../theme/M3PaletteContext';
import {runProviderSearches} from '../lib/search/runProviderSearches';
import type {ProviderExtension} from '../lib/storage/extensionStorage';
import {useFloatingTabBarInset} from '../components/navigation/FloatingTabBarInsetContext';

type Props = NativeStackScreenProps<SearchStackParamList, 'SearchResults'>;

interface SearchPageData {
  title: string;
  Posts: any[];
  filter: string;
  providerValue: string;
  value: string;
  name: string;
}

// The selected provider is searched first, the rest in installed order.
const activeFirst = (providers: ProviderExtension[]) => {
  const active = useContentStore.getState().provider?.value;
  return [
    ...providers.filter(p => p.value === active),
    ...providers.filter(p => p.value !== active),
  ];
};

const SearchResults = ({route, navigation}: Props): React.ReactElement => {
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const storeProviders = useContentStore(state => state.installedProviders);
  // Reordering providers in the drawer makes a new array with the same
  // providers. Only a real install or removal should restart the searches.
  const providersKey = storeProviders.map(p => p.value).sort().join('|');
  const installedProviders = useMemo(() => storeProviders, [providersKey]);
  const [searchData, setSearchData] = useState<SearchPageData[]>([]);
  const [emptyResults, setEmptyResults] = useState<SearchPageData[]>([]);
  const [showEmptyResults, setShowEmptyResults] = useState(false);
  const [editQuery, setEditQuery] = useState(route.params.filter);
  const [isEditFocused, setIsEditFocused] = useState(false);

  useEffect(() => setEditQuery(route.params.filter), [route.params.filter]);

  const submitEditedSearch = useCallback(() => {
    const query = editQuery.trim();
    if (query && query !== route.params.filter) {
      navigation.setParams({filter: query});
    }
  }, [editQuery, navigation, route.params.filter]);

  const trueLoading = useMemo(
    () =>
      installedProviders.map(item => ({
        name: item.display_name,
        value: item.value,
        isLoading: true,
        error: undefined as string | undefined, // explicitly type it
      })),
    [installedProviders],
  );

  const [loading, setLoading] = useState(trueLoading);
  const abortController = useRef<AbortController | null>(null);

  // Use refs to store latest data without causing re-renders
  const searchDataRef = useRef<SearchPageData[]>([]);
  const emptyResultsRef = useRef<SearchPageData[]>([]);

  const updateSearchData = useCallback((newData: SearchPageData) => {
    searchDataRef.current = [...searchDataRef.current, newData];
    setSearchData(searchDataRef.current);
  }, []);

  const updateEmptyResults = useCallback((newData: SearchPageData) => {
    emptyResultsRef.current = [...emptyResultsRef.current, newData];
    setEmptyResults(emptyResultsRef.current);
  }, []);

  const updateLoading = useCallback(
    (value: string, updates: Partial<{isLoading: boolean; error: string}>) => {
      setLoading(prev =>
        prev.map(i => (i.value === value ? {...i, ...updates} : i)),
      );
    },
    [],
  );

  const isAllLoaded = useMemo(
    () => loading.every(i => !i.isLoading),
    [loading],
  );

  const failed = useMemo(() => loading.filter(i => i.error), [loading]);

  const searchProviders = useCallback(
    (providers: ProviderExtension[], signal: AbortSignal) =>
      runProviderSearches({
        providers: activeFirst(providers),
        signal,
        search: (item, providerSignal) =>
          providerManager.getSearchPosts({
            searchQuery: route.params.filter,
            page: 1,
            providerValue: item.value,
            signal: providerSignal,
          }),
        onSettled: (item, outcome) => {
          if ('error' in outcome) {
            console.error(
              `Error fetching data for ${item.display_name}:`,
              outcome.error,
            );
            updateLoading(item.value, {isLoading: false, error: outcome.error});
            return;
          }
          const newData = {
            title: item.display_name,
            Posts: outcome.posts,
            filter: route.params.filter,
            providerValue: item.value,
            value: item.value,
            name: item.display_name,
          };
          if (newData.Posts.length > 0) {
            updateSearchData(newData);
          } else {
            updateEmptyResults(newData);
          }
          updateLoading(item.value, {isLoading: false});
        },
      }),
    [route.params.filter, updateSearchData, updateEmptyResults, updateLoading],
  );

  const retryFailed = useCallback(() => {
    const signal = abortController.current?.signal;
    if (!signal) return;
    const values = new Set(failed.map(i => i.value));
    failed.forEach(i =>
      updateLoading(i.value, {isLoading: true, error: undefined}),
    );
    searchProviders(
      installedProviders.filter(p => values.has(p.value)),
      signal,
    );
  }, [failed, installedProviders, searchProviders, updateLoading]);

  useEffect(() => {
    // Clean up previous controller if exists
    if (abortController.current) {
      abortController.current.abort();
    }

    // Create a new controller for this effect
    abortController.current = new AbortController();
    const signal = abortController.current.signal;

    // Reset states when component mounts or filter changes
    searchDataRef.current = [];
    emptyResultsRef.current = [];
    setSearchData([]);
    setEmptyResults([]);
    setShowEmptyResults(false);
    setLoading(trueLoading);

    searchProviders(installedProviders, signal);

    return () => {
      // Cleanup function: abort any ongoing API requests
      if (abortController.current) {
        abortController.current.abort();
        abortController.current = null;
      }
    };
  }, [route.params.filter, installedProviders]);

  const renderSlider = useCallback(
    (
      item: Pick<SearchPageData, 'name' | 'value'>,
      index: number,
      isEmptyResult: boolean = false,
    ) => {
      const loadingState = loading.find(i => i.value === item.value);
      const posts = isEmptyResult
        ? emptyResults.find(i => i.providerValue === item.value)?.Posts || []
        : searchData.find(i => i.providerValue === item.value)?.Posts || [];

      return (
        <Slider
          isLoading={loadingState?.isLoading || false}
          key={`${item.value}-${isEmptyResult ? 'empty' : 'data'}`}
          title={item.name}
          posts={posts}
          filter={route.params.filter}
          providerValue={item.value}
          isSearch={true}
          error={loadingState?.error}
        />
      );
    },
    [loading, searchData, emptyResults, route.params.filter],
  );

  const searchSliders = useMemo(
    () => searchData.map((item, index) => renderSlider(item, index, false)),
    [searchData, renderSlider],
  );

  const emptySliders = useMemo(
    () => emptyResults.map((item, index) => renderSlider(item, index, true)),
    [emptyResults, renderSlider],
  );

  // Failed rows have no posts, so Slider shows their error instead.
  const failedSliders = useMemo(
    () => failed.map((item, index) => renderSlider(item, index, true)),
    [failed, renderSlider],
  );

  const EmptyResultsButton = isTV ? TVFocusable : Pressable;
  const emptyCount = emptyResults.length + failed.length;

  return (
    <ScreenSafeArea className="h-full w-full bg-m3-background">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mt-6 px-4 flex flex-row items-center gap-x-3">
          {isTV ? (
            <TVFocusable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              hasTVPreferredFocus
              focusScale={1}
              borderRadius={12}
              style={styles.tvBackButton}
              onPress={() => navigation.goBack()}>
              <MaterialCommunityIcons name="arrow-left" size={30} color={colors.primary} />
            </TVFocusable>
          ) : (
            <IconButton
              icon="arrow-left"
              label="Back"
              onPress={() => navigation.goBack()}
            />
          )}
          <AppText
            role="headlineMediumEmphasized"
            className="flex-1 text-m3-on-background"
            numberOfLines={1}>
            <AppText
              role="headlineMediumEmphasized"
              style={{color: colors.primary}}>
              "{route?.params?.filter}"
            </AppText>
          </AppText>
          {!isAllLoaded && (
            <View className="flex justify-center items-center h-12">
              <LoadingIndicator size={28} />
            </View>
          )}
        </View>

        {isTV && (
          <View style={styles.tvEditRow}>
            <View style={[styles.tvEditInputContainer, {
              borderColor: isEditFocused ? colors.primary : colors.outline,
              borderWidth: isEditFocused ? 3 : 1,
            }]}>
              <MaterialCommunityIcons name="magnify" size={26} color={colors.primary} />
              <TextInput
                accessibilityLabel="Edit search query"
                style={[styles.tvEditInput, {color: colors.onSurface}]}
                value={editQuery}
                onChangeText={setEditQuery}
                onFocus={() => setIsEditFocused(true)}
                onBlur={() => setIsEditFocused(false)}
                onSubmitEditing={submitEditedSearch}
                returnKeyType="search"
                placeholder="Edit search"
                placeholderTextColor={colors.onSurfaceVariant}
              />
            </View>
            <TVFocusable
              accessibilityLabel="Search again"
              accessibilityRole="button"
              focusScale={1}
              borderRadius={12}
              style={[styles.tvSearchButton, {backgroundColor: colors.primaryContainer}]}
              onPress={submitEditedSearch}>
              <MaterialCommunityIcons name="magnify" size={26} color={colors.onPrimaryContainer} />
              <AppText role="titleMedium" style={{color: colors.onPrimaryContainer}}>Search</AppText>
            </TVFocusable>
          </View>
        )}

        {isAllLoaded && failed.length > 0 && (
          <View className="px-4 mt-4">
            <Button variant="tonal" compact onPress={retryFailed}>
              {`Retry failed (${failed.length})`}
            </Button>
          </View>
        )}

        <TVFocusGuide autoFocus={false} style={{paddingHorizontal: 16}}>
          {searchSliders}
          {emptyCount > 0 && (
            <EmptyResultsButton accessibilityRole="button"
              accessibilityLabel={showEmptyResults ? 'Hide empty results' : 'Show empty results'}
              accessibilityHint="Providers with no results or search errors"
              accessibilityState={{expanded: showEmptyResults}}
              onPress={() => setShowEmptyResults(previous => !previous)}
              style={{minHeight: 48, padding: 14, marginVertical: 12, borderRadius: 16,
                backgroundColor: colors.surfaceContainer, flexDirection: 'row', alignItems: 'center', gap: 12}}>
              <AppText role="labelLarge" style={{flex: 1, color: colors.primary}}>
                {showEmptyResults ? 'Hide empty results' : 'Show empty results'} ({emptyCount})
              </AppText>
              <MaterialCommunityIcons name={showEmptyResults ? 'chevron-up' : 'chevron-down'}
                size={24} color={colors.primary} />
            </EmptyResultsButton>
          )}
          {showEmptyResults && <>
            {emptySliders}
            {failedSliders}
          </>}
        </TVFocusGuide>

        {isAllLoaded && searchData.every(d => !d.Posts || d.Posts.length === 0) && (
          <View className="items-center justify-center py-20 px-8">
            <AppText
              role="titleLargeEmphasized"
              className="text-center text-m3-on-surface-variant">
              {failed.length > 0 && failed.length === loading.length
                ? 'Could not search for'
                : 'No results found for'}{' '}
              "{route?.params?.filter}"
            </AppText>
            {failed.length > 0 && (
              <AppText
                role="bodyMedium"
                className="mt-2 text-center text-m3-on-surface-variant">
                {failed.length === 1
                  ? '1 source failed to search.'
                  : `${failed.length} sources failed to search.`}
              </AppText>
            )}
          </View>
        )}
        <View style={{height: 64 + floatingTabBarInset}} />
      </ScrollView>
    </ScreenSafeArea>
  );
};

export default SearchResults;

const styles = StyleSheet.create({
  tvBackButton: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  tvEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  tvEditInputContainer: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tvEditInput: {
    flex: 1,
    fontSize: 22,
  },
  tvSearchButton: {
    minWidth: 160,
    height: 64,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
