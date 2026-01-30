import {
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Text,
  View,
} from 'react-native';
import Slider from '../components/Slider';
import React, {useEffect, useState, useRef, useCallback, useMemo, memo} from 'react';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SearchStackParamList} from '../App';
import useThemeStore from '../lib/zustand/themeStore';
import {providerManager} from '../lib/services/ProviderManager';
import useContentStore from '../lib/zustand/contentStore';

type Props = NativeStackScreenProps<SearchStackParamList, 'SearchResults'>;

interface SearchPageData {
  title: string;
  Posts: any[];
  filter: string;
  providerValue: string;
  value: string;
  name: string;
}

const SearchResults = ({route}: Props): React.ReactElement => {
  const {primary} = useThemeStore(state => state);
  const {installedProviders} = useContentStore(state => state);
  const [searchData, setSearchData] = useState<SearchPageData[]>([]);
  const [emptyResults, setEmptyResults] = useState<SearchPageData[]>([]);

  const trueLoading = useMemo(
    () =>
      installedProviders.map(item => ({
        name: item.display_name,
        value: item.value,
        isLoading: true,
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
    (value: string, updates: Partial<{isLoading: boolean; error: boolean}>) => {
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
    setLoading(trueLoading);

    const fetchPromises: Promise<void>[] = [];

    const getSearchResults = () => {
      installedProviders.forEach(item => {
        const fetchPromise = (async () => {
          try {
            const data = await providerManager.getSearchPosts({
              searchQuery: route.params.filter,
              page: 1,
              providerValue: item.value,
              signal: signal,
            });

            // Skip updating state if request was aborted
            if (signal.aborted) return;

            if (data && data.length > 0) {
              const newData = {
                title: item.display_name,
                Posts: data,
                filter: route.params.filter,
                providerValue: item.value,
                value: item.value,
                name: item.display_name,
              };
              updateSearchData(newData);
            } else {
              const newData = {
                title: item.display_name,
                Posts: data || [],
                filter: route.params.filter,
                providerValue: item.value,
                value: item.value,
                name: item.display_name,
              };
              updateEmptyResults(newData);
            }

            updateLoading(item.value, {isLoading: false});
          } catch (error) {
            if (signal.aborted) return;

            console.error(
              `Error fetching data for ${item.display_name}:`,
              error,
            );
            updateLoading(item.value, {isLoading: false, error: true});
          }
        })();

        fetchPromises.push(fetchPromise);
      });

      // Use Promise.allSettled to handle all promises regardless of their outcome
      return Promise.allSettled(fetchPromises);
    };

    getSearchResults();

    return () => {
      // Cleanup function: abort any ongoing API requests
      if (abortController.current) {
        abortController.current.abort();
        abortController.current = null;
      }
    };
  }, [
    route.params.filter,
    installedProviders,
  ]);

  const renderSlider = useCallback(
    (item: SearchPageData, index: number, isEmptyResult: boolean = false) => {
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

  return (
    <SafeAreaView className="bg-black h-full w-full">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mt-14 px-4 flex flex-row justify-between items-center gap-x-3">
          <Text className="text-white text-2xl font-semibold ">
            {isAllLoaded ? 'Searched for' : 'Searching for'}{' '}
            <Text style={{color: primary}}>"{route?.params?.filter}"</Text>
          </Text>
          {!isAllLoaded && (
            <View className="flex justify-center items-center h-20">
              <ActivityIndicator
                size="small"
                color={primary}
                animating={true}
              />
            </View>
          )}
        </View>

        <View className="px-4">
          {searchSliders}
          {emptySliders}
        </View>
        <View className="h-16" />
      </ScrollView>
    </SafeAreaView>
  );
};

export default SearchResults;
