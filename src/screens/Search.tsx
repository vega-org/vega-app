import {View, FlatList, Text, Keyboard} from 'react-native';
import React, {useState, useEffect, useCallback, memo, useRef} from 'react';
import {useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SearchStackParamList, TabStackParamList} from '../App';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {MMKV} from '../lib/Mmkv';
import ScreenSafeArea from '../components/ui/ScreenSafeArea';
import Animated, {FadeInDown} from 'react-native-reanimated';
import {searchOMDB} from '../lib/services/omdb';
import {OMDBResult} from '../types/omdb';
import {fetchIMDbSuggestions, type IMDbSuggestion} from '../lib/services/imdbSuggestions';
import {sanitizeSearchQuery} from '../lib/utils/helpers';
import SearchSuggestions from '../components/search/SearchSuggestions';
import SearchHistory from '../components/search/SearchHistory';
import GenreChips from '../components/search/GenreChips';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import AppText from '../components/ui/Text';
import SearchField, {type SearchFieldRef} from '../components/ui/SearchField';
import {useM3Colors} from '../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../components/tv';
import {isTV} from '../lib/tv';


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
        <TVFocusable
          onPress={handlePress}
          borderRadius={20}
          focusScale={1}
          showFocusBorder={true}
          focusedStyle={{
            backgroundColor: colors.surfaceContainerHigh,
          }}
          accessibilityRole="button"
          accessibilityLabel={`Search result: ${item.Title}`}
          style={{
            backgroundColor: colors.surfaceContainerLow,
            borderRadius: 20,
            padding: 14,
          }}>
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
            <View style={{flex: 1}}>
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
        </TVFocusable>
      </View>
    );
  },
);



const HeaderContainer = isTV ? View : Animated.View;
const AnimatedContainer = Animated.View;

const Search = () => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<SearchStackParamList>>();
  const [searchText, setSearchText] = useState('');
  const [searchFieldNode, setSearchFieldNode] = useState<number | null>(null);
  const [clearBtnNode, setClearBtnNode] = useState<number | null>(null);
  const [firstItemNode, setFirstItemNode] = useState<number | null>(null);
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

      if (!isTV) {
        searchFieldRef.current?.focus();
      }
    });
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (!focusAfterTabResetRef.current) {
        return;
      }
      focusAfterTabResetRef.current = false;
      if (!isTV) {
        searchFieldRef.current?.focus();
      }
    });

    return () => {
      unsubscribeTabPress();
      unsubscribeFocus();
    };
  }, [navigation]);

  // Debounced IMDb search suggestions (spelling completer). The timers live
  // in effects so the screen stays compatible with React Compiler.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const clean = searchText.trim();
      if (clean.length >= 2 && !suppressSuggestionsRef.current) {
        const results = await fetchIMDbSuggestions(clean);
        if (!cancelled) {
          setSuggestions(results);
        }
      } else {
        setSuggestions([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText]);

  // Debounced OMDB search
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (searchText.length >= 2) {
        setSearchResults([]); // Clear previous results
        const results = await searchOMDB(searchText);
        if (cancelled) {
          return;
        }
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
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText]);

  const handleTextChange = useCallback((text: string) => {
    suppressSuggestionsRef.current = false;
    setSearchText(text);
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      Keyboard.dismiss();
      suppressSuggestionsRef.current = true;
      setSuggestions([]);
      const trimmed = text.trim();
      if (trimmed) {
        // Save to search history
        const prevSearches = MMKV.getArray<string>('searchHistory') || [];
        if (!prevSearches.includes(trimmed)) {
          const newSearches = [trimmed, ...prevSearches].slice(
            0,
            MAX_HISTORY_ITEMS,
          );
          MMKV.setArray('searchHistory', newSearches);
          setSearchHistory(newSearches);
        }

        navigation.navigate('SearchResults', {
          filter: trimmed,
        });
      }
    },
    [navigation],
  );

  const handleSelectSuggestion = useCallback(
    (title: string) => {
      const cleanTitle = sanitizeSearchQuery(title);
      Keyboard.dismiss();
      suppressSuggestionsRef.current = true;
      setSuggestions([]);
      setSearchText(cleanTitle);
      handleSearch(cleanTitle);
    },
    [handleSearch],
  );

  const handleEditSearch = useCallback((text: string) => {
    suppressSuggestionsRef.current = true;
    setSuggestions([]);
    setSearchText(text);
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

  const searchResultKeyExtractor = useCallback(
    (item: OMDBResult) => item.imdbID.toString(),
    [],
  );

  const showSuggestions =
    searchText.trim().length >= 2 && suggestions.length > 0;

  return (
    <ScreenSafeArea className="flex-1 bg-m3-background">
      {/* Title Section */}
      <HeaderContainer
        {...(!isTV ? {entering: FadeInDown.duration(300)} : {})}
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
              placeholder="Search anime..."
              nextFocusDown={firstItemNode}
              nextFocusRight={searchText.length > 0 ? clearBtnNode : undefined}
              onNodeHandle={setSearchFieldNode}
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
              nextFocusLeft={searchFieldNode}
              nextFocusDown={firstItemNode}
              onNodeHandle={setClearBtnNode}
            />
          )}
        </View>
      </HeaderContainer>

      {/* Search Content */}
      <View className="flex-1">
        {!showSuggestions && searchResults.length === 0 && (
          <View className="pt-2">
            <GenreChips />
          </View>
        )}
        <View className="flex-1">
          {showSuggestions ? (
            <View style={{flex: 1}}>
              <SearchSuggestions
                suggestions={suggestions}
                onSelectSuggestion={handleSelectSuggestion}
                searchFieldNodeHandle={searchFieldNode}
                onFirstItemNodeHandle={setFirstItemNode}
              />
            </View>
          ) : searchResults.length > 0 ? (
            <TVFocusGuide trapFocusLeft={true} trapFocusRight={true} autoFocus={false} style={{flex: 1}}>
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
            </TVFocusGuide>
          ) : searchHistory.length > 0 ? (
            <View style={{flex: 1}}>
              <SearchHistory
                history={searchHistory}
                onSelectSearch={handleSearch}
                onEditSearch={handleEditSearch}
                onRemoveSearch={removeHistoryItem}
                onClearHistory={clearHistory}
                searchFieldNodeHandle={searchFieldNode}
                onFirstItemNodeHandle={setFirstItemNode}
              />
            </View>
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
      </View>
    </ScreenSafeArea>
  );
};

export default Search;
