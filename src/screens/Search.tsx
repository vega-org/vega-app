import {View, FlatList, Pressable, Text} from 'react-native';
import React, {useState, useEffect, useCallback, memo, useRef} from 'react';
import {useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SearchStackParamList, TabStackParamList} from '../App';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {MMKV} from '../lib/Mmkv';
import {SafeAreaView} from 'react-native-safe-area-context';
import Animated, {FadeInDown} from 'react-native-reanimated';
import {searchOMDB} from '../lib/services/omdb';
import debounce from 'lodash/debounce';
import {OMDBResult} from '../types/omdb';
import {fetchIMDbSuggestions, type IMDbSuggestion} from '../lib/services/imdbSuggestions';
import SearchSuggestions from '../components/search/SearchSuggestions';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import AppText from '../components/ui/Text';
import SearchField, {type SearchFieldRef} from '../components/ui/SearchField';
import {useM3Colors} from '../theme/M3PaletteContext';

const MAX_VISIBLE_RESULTS = 15; // Limit number of animated items to prevent excessive callbacks
const MAX_HISTORY_ITEMS = 30; // Maximum number of history items to store

// Memoized search result item to prevent unnecessary re-renders
const SearchResultItem = memo(
  ({item, onPress}: {item: OMDBResult; onPress: (title: string) => void}) => {
    const colors = useM3Colors();
    const handlePress = useCallback(() => {
      onPress(item.Title);
    }, [item.Title, onPress]);

    return (
      <View style={{paddingHorizontal: 16, paddingVertical: 5}}>
        <Pressable
          onPress={handlePress}
          style={({pressed}) => ({
            backgroundColor: pressed
              ? colors.surfaceContainerHighest
              : colors.surfaceContainerLow,
            borderRadius: 20,
            padding: 14,
          })}>
          <View style={{alignItems: 'center', flexDirection: 'row'}}>
            <View
              style={{
                alignItems: 'center',
                backgroundColor: colors.secondaryContainer,
                borderRadius: 16,
                height: 44,
                justifyContent: 'center',
                marginRight: 14,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name={item.Type === 'series' ? 'television' : 'movie-open'}
                size={22}
                color={colors.onSecondaryContainer}
              />
            </View>
            <View className="flex-1">
              <AppText
                role="bodyLargeEmphasized"
                style={{color: colors.onSurface}}>
                {item.Title}
              </AppText>
              <AppText
                role="bodySmall"
                style={{color: colors.onSurfaceVariant, marginTop: 2}}>
                {item.Type === 'series' ? 'TV Show' : 'Movie'} • {item.Year}
              </AppText>
            </View>
            <MaterialCommunityIcons
              name="arrow-top-right"
              size={20}
              color={colors.onSurfaceVariant}
            />
          </View>
        </Pressable>
      </View>
    );
  },
);

// Memoized history item component
const HistoryItem = memo(
  ({
    search,
    onPress,
    onRemove,
  }: {
    search: string;
    onPress: (text: string) => void;
    onRemove: (text: string) => void;
  }) => {
    const colors = useM3Colors();
    const handlePress = useCallback(() => {
      onPress(search);
    }, [search, onPress]);

    const handleRemove = useCallback(() => {
      onRemove(search);
    }, [search, onRemove]);

    return (
      <Pressable
        onPress={handlePress}
        className="flex-row items-center rounded-[20px] mb-2 px-4 py-3.5"
        style={({pressed}) => ({
          backgroundColor: colors.surfaceContainerLow,
          opacity: pressed ? 0.72 : 1,
        })}>
        <MaterialCommunityIcons
          name="history"
          size={22}
          color={colors.onSurfaceVariant}
        />
        <Text
          numberOfLines={1}
          className="flex-1 mx-3"
          style={{
            color: colors.onSurface,
            fontSize: 16,
            fontWeight: '500',
          }}>
          {search}
        </Text>
        <Pressable
          onPress={handleRemove}
          hitSlop={8}
          accessibilityLabel={`Remove ${search} from recent searches`}>
          <MaterialCommunityIcons
            name="close"
            size={18}
            color={colors.onSurfaceVariant}
          />
        </Pressable>
      </Pressable>
    );
  },
);

const Search = () => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<SearchStackParamList>>();
  const [searchText, setSearchText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<IMDbSuggestion[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(
    MMKV.getArray<string>('searchHistory') || [],
  );
  const [searchResults, setSearchResults] = useState<OMDBResult[]>([]);
  const searchFieldRef = useRef<SearchFieldRef>(null);
  const focusAfterTabResetRef = useRef(false);
  const suppressSuggestionsRef = useRef(false);

  useEffect(() => {
    const tabNavigation =
      navigation.getParent<BottomTabNavigationProp<TabStackParamList>>();
    if (!tabNavigation) {
      return;
    }

    const unsubscribeTabPress = tabNavigation.addListener('tabPress', event => {
      const state = tabNavigation.getState();
      if (state.routes[state.index]?.name !== 'SearchStack') {
        return;
      }

      if (!navigation.isFocused()) {
        event.preventDefault();
        focusAfterTabResetRef.current = true;
        navigation.popToTop();
        return;
      }

      searchFieldRef.current?.focus();
    });
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (!focusAfterTabResetRef.current) {
        return;
      }
      focusAfterTabResetRef.current = false;
      searchFieldRef.current?.focus();
    });

    return () => {
      unsubscribeTabPress();
      unsubscribeFocus();
    };
  }, [navigation]);

  // Debounced IMDb search suggestions (spelling completer)
  const debouncedFetchSuggestions = useCallback(
    debounce(async (text: string) => {
      const clean = text.trim();
      if (clean.length >= 2 && !suppressSuggestionsRef.current) {
        const results = await fetchIMDbSuggestions(clean);
        setSuggestions(results);
      } else {
        setSuggestions([]);
      }
    }, 250),
    [],
  );

  useEffect(() => {
    debouncedFetchSuggestions(searchText);
    return () => {
      debouncedFetchSuggestions.cancel();
    };
  }, [searchText, debouncedFetchSuggestions]);

  // Debounced OMDB search
  const debouncedSearch = useCallback(
    debounce(async (text: string) => {
      if (text.length >= 2) {
        setSearchResults([]); // Clear previous results
        const results = await searchOMDB(text);
        if (results.length > 0) {
          // Remove duplicates based on imdbID
          const uniqueResults = results.reduce((acc, current) => {
            const x = acc.find(
              (item: OMDBResult) => item.imdbID === current.imdbID,
            );
            if (!x) {
              return acc.concat([current]);
            } else {
              return acc;
            }
          }, [] as OMDBResult[]);

          // Limit the number of results to prevent excessive animations
          setSearchResults(uniqueResults.slice(0, MAX_VISIBLE_RESULTS));
        }
      } else {
        setSearchResults([]);
      }
    }, 300),
    [],
  );

  useEffect(() => {
    debouncedSearch(searchText);
    return () => {
      debouncedSearch.cancel();
    };
  }, [searchText, debouncedSearch]);

  const handleTextChange = useCallback((text: string) => {
    suppressSuggestionsRef.current = false;
    setSearchText(text);
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      suppressSuggestionsRef.current = true;
      setSuggestions([]);
      if (text.trim()) {
        // Save to search history
        const prevSearches = MMKV.getArray<string>('searchHistory') || [];
        if (!prevSearches.includes(text.trim())) {
          const newSearches = [text.trim(), ...prevSearches].slice(
            0,
            MAX_HISTORY_ITEMS,
          );
          MMKV.setArray('searchHistory', newSearches);
          setSearchHistory(newSearches);
        }

        navigation.navigate('SearchResults', {
          filter: text.trim(),
        });
      }
    },
    [navigation],
  );

  const handleSelectSuggestion = useCallback((title: string) => {
    // Auto-fill search bar on click without executing search
    suppressSuggestionsRef.current = true;
    setSuggestions([]);
    setSearchText(title);
    searchFieldRef.current?.focus();
  }, []);

  const removeHistoryItem = useCallback(
    (search: string) => {
      const newSearches = searchHistory.filter(item => item !== search);
      MMKV.setArray('searchHistory', newSearches);
      setSearchHistory(newSearches);
    },
    [searchHistory],
  );

  const clearHistory = useCallback(() => {
    MMKV.setArray('searchHistory', []);
    setSearchHistory([]);
  }, []);

  const handleResultPress = useCallback(
    (title: string) => {
      // Save to search history
      const prevSearches = MMKV.getArray<string>('searchHistory') || [];
      if (!prevSearches.includes(title)) {
        const newSearches = [title, ...prevSearches].slice(
          0,
          MAX_HISTORY_ITEMS,
        );
        MMKV.setArray('searchHistory', newSearches);
        setSearchHistory(newSearches);
      }
      navigation.navigate('SearchResults', {
        filter: title,
      });
    },
    [navigation],
  );

  // Memoized render function for search results
  const renderSearchResult = useCallback(
    ({item}: {item: OMDBResult}) => (
      <SearchResultItem item={item} onPress={handleResultPress} />
    ),
    [handleResultPress],
  );

  // Memoized render function for history items
  const renderHistoryItem = useCallback(
    ({item}: {item: string}) => (
      <HistoryItem
        search={item}
        onPress={handleSearch}
        onRemove={removeHistoryItem}
      />
    ),
    [handleSearch, removeHistoryItem],
  );

  // Memoized key extractors
  const searchResultKeyExtractor = useCallback(
    (item: OMDBResult) => item.imdbID.toString(),
    [],
  );
  const historyKeyExtractor = useCallback(
    (item: string, index: number) => `history-${index}`,
    [],
  );

  const showSuggestions =
    searchText.trim().length >= 2 && suggestions.length > 0;

  // Conditionally render animations based on state
  const AnimatedContainer = Animated.View;

  return (
    <SafeAreaView className="flex-1 bg-m3-background">
      {/* Title Section */}
      <AnimatedContainer
        entering={FadeInDown.duration(300)}
        className="px-4 pt-5">
        <AppText
          role="bodyLarge"
          style={{color: colors.onSurfaceVariant, marginBottom: 18}}>
          Search across all providers
        </AppText>
        <View className="flex-row items-center space-x-3 mb-3">
          <View className="flex-1">
            <SearchField
              ref={searchFieldRef}
              value={searchText}
              onChangeText={handleTextChange}
              onSubmit={handleSearch}
              onFocusChange={setIsFocused}
              placeholder="Search anime..."
            />
          </View>
          {searchText.length > 0 && (
            <IconButton
              icon="close"
              label="Clear search"
              onPress={() => {
                suppressSuggestionsRef.current = false;
                setSearchText('');
                setSuggestions([]);
              }}
              size={18}
            />
          )}
        </View>
      </AnimatedContainer>

      {/* Search Content */}
      <View className="flex-1">
        {showSuggestions ? (
          <SearchSuggestions
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
          />
        ) : searchResults.length > 0 ? (
          <FlatList
            data={searchResults}
            keyExtractor={searchResultKeyExtractor}
            renderItem={renderSearchResult}
            contentContainerStyle={{paddingTop: 4}}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={10}
            initialNumToRender={10}
            keyboardShouldPersistTaps="handled"
          />
        ) : searchHistory.length > 0 ? (
          <AnimatedContainer
            entering={FadeInDown.duration(250)}
            className="px-4 flex-1 pt-4">
            <View className="flex-row items-center justify-between mb-3">
              <AppText
                role="titleMediumEmphasized"
                className="text-m3-on-surface">
                Recent Searches
              </AppText>
              <Button compact variant="text" onPress={clearHistory}>
                Clear all
              </Button>
            </View>

            <FlatList
              data={searchHistory}
              keyExtractor={historyKeyExtractor}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{paddingBottom: 20}}
              renderItem={renderHistoryItem}
              removeClippedSubviews={false}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              windowSize={10}
              initialNumToRender={10}
              keyboardShouldPersistTaps="handled"
            />
          </AnimatedContainer>
        ) : (
          // Empty State - Only show when no history and no results
          <AnimatedContainer
            entering={FadeInDown.duration(300)}
            className="items-center justify-center flex-1 px-8">
            <View className="mb-5 rounded-[28px] bg-m3-secondary-container p-7">
              <MaterialCommunityIcons
                name="magnify"
                size={32}
                color={colors.onSecondaryContainer}
              />
            </View>
            <AppText
              role="bodyLarge"
              className="text-center text-m3-on-surface">
              Your next watch starts here
            </AppText>
            <AppText
              role="bodyMedium"
              className="mt-1 text-center text-m3-on-surface-variant">
              Search by title, then browse every provider in one place
            </AppText>
          </AnimatedContainer>
        )}
      </View>
    </SafeAreaView>
  );
};

export default Search;
