import {View, Text, FlatList} from 'react-native';
import React, {useState, useEffect, useCallback, useMemo, memo} from 'react';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SearchStackParamList} from '../App';
import {MaterialIcons, Ionicons, Feather} from '@expo/vector-icons';
import {TextInput} from 'react-native';
import {TouchableOpacity} from 'react-native';
import useThemeStore from '../lib/zustand/themeStore';
import {MMKV} from '../lib/Mmkv';
import {SafeAreaView} from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  SlideInRight,
  Layout,
} from 'react-native-reanimated';
import {searchOMDB} from '../lib/services/omdb';
import debounce from 'lodash/debounce';
import {OMDBResult} from '../types/omdb';

const MAX_VISIBLE_RESULTS = 15; // Limit number of animated items to prevent excessive callbacks
const MAX_HISTORY_ITEMS = 30; // Maximum number of history items to store

// Memoized search result item to prevent unnecessary re-renders
const SearchResultItem = memo(
  ({item, onPress}: {item: OMDBResult; onPress: (title: string) => void}) => {
    const handlePress = useCallback(() => {
      onPress(item.Title);
    }, [item.Title, onPress]);

    return (
      <View className="px-4">
        <TouchableOpacity
          className="py-3 border-b border-white/10"
          onPress={handlePress}>
          <View className="flex-row items-center">
            <MaterialIcons
              name="search"
              size={20}
              color="#666"
              style={{marginRight: 12}}
            />
            <View>
              <Text className="text-white text-base">{item.Title}</Text>
              <Text className="text-white/50 text-xs">
                {item.Type === 'series' ? 'TV Show' : 'Movie'} • {item.Year}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
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
    primary,
  }: {
    search: string;
    onPress: (text: string) => void;
    onRemove: (text: string) => void;
    primary: string;
  }) => {
    const handlePress = useCallback(() => {
      onPress(search);
    }, [search, onPress]);

    const handleRemove = useCallback(() => {
      onRemove(search);
    }, [search, onRemove]);

    return (
      <View className="bg-[#141414] rounded-lg p-3 mb-2 flex-row justify-between items-center border border-white/5">
        <TouchableOpacity
          onPress={handlePress}
          className="flex-row flex-1 items-center space-x-2">
          <View className="bg-white/10 rounded-full p-1.5">
            <Ionicons name="time-outline" size={16} color={primary} />
          </View>
          <Text className="text-white text-sm ml-2">{search}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleRemove}
          className="bg-white/5 rounded-full p-1.5">
          <Feather name="x" size={14} color="#999" />
        </TouchableOpacity>
      </View>
    );
  },
);

const Search = () => {
  const {primary} = useThemeStore(state => state);
  const navigation =
    useNavigation<NativeStackNavigationProp<SearchStackParamList>>();
  const [searchText, setSearchText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(
    MMKV.getArray<string>('searchHistory') || [],
  );
  const [searchResults, setSearchResults] = useState<OMDBResult[]>([]);

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
    }, 300), // Reduced debounce time for better responsiveness
    [],
  );

  useEffect(() => {
    debouncedSearch(searchText);
    return () => {
      debouncedSearch.cancel();
    };
  }, [searchText, debouncedSearch]);

  const handleSearch = useCallback(
    (text: string) => {
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
        primary={primary}
      />
    ),
    [handleSearch, removeHistoryItem, primary],
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

  // Conditionally render animations based on state
  const AnimatedContainer = Animated.View;

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Title Section */}
      <AnimatedContainer
        entering={FadeInDown.springify()}
        layout={Layout.springify()}
        className="px-4 pt-4">
        <Text className="text-white text-xl font-bold mb-3">Search</Text>
        <View className="flex-row items-center space-x-3 mb-2">
          <View className="flex-1">
            <View className="overflow-hidden rounded-xl bg-[#141414] shadow-lg shadow-black/50">
              <View className="px-3 py-3">
                <View className="flex-row items-center">
                  <MaterialIcons
                    name="search"
                    size={24}
                    color={isFocused ? primary : '#666'}
                  />
                  <TextInput
                    className="flex-1 text-white text-base ml-3"
                    placeholder="Search anime..."
                    placeholderTextColor="#666"
                    value={searchText}
                    onChangeText={setSearchText}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onSubmitEditing={e => handleSearch(e.nativeEvent.text)}
                    returnKeyType="search"
                  />
                  {searchText.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setSearchText('')}
                      className="bg-gray-800/50 rounded-full p-2">
                      <Feather name="x" size={18} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          </View>
        </View>
      </AnimatedContainer>

      {/* Search Results */}
      <AnimatedContainer
        layout={Layout.springify()}
        className="flex-1"
        key={
          searchResults.length > 0
            ? 'results'
            : searchHistory.length > 0
              ? 'history'
              : 'empty'
        }>
        {searchResults.length > 0 ? (
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
          />
        ) : searchHistory.length > 0 ? (
          <AnimatedContainer
            entering={SlideInRight.springify()}
            layout={Layout.springify()}
            className="px-4 flex-1">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-white/90 text-base font-semibold">
                Recent Searches
              </Text>
              <TouchableOpacity
                onPress={clearHistory}
                className="bg-red-500/10 rounded-full px-2 py-0.5">
                <Text className="text-red-500 text-xs">Clear All</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={searchHistory}
              keyExtractor={historyKeyExtractor}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{paddingBottom: 20}}
              renderItem={renderHistoryItem}
              removeClippedSubviews={true}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              windowSize={10}
              initialNumToRender={10}
            />
          </AnimatedContainer>
        ) : (
          // Empty State - Only show when no history and no results
          <AnimatedContainer
            layout={Layout.springify()}
            className="items-center justify-center flex-1">
            <View className="bg-white/5 rounded-full p-6 mb-4">
              <Ionicons name="search" size={32} color={primary} />
            </View>
            <Text className="text-white/70 text-base text-center">
              Search for your favorite anime
            </Text>
            <Text className="text-white/40 text-sm text-center mt-1">
              Your recent searches will appear here
            </Text>
          </AnimatedContainer>
        )}
      </AnimatedContainer>
    </SafeAreaView>
  );
};

export default Search;
