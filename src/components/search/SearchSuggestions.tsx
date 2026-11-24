import React, {memo, useCallback, useState, useRef, useEffect} from 'react';
import {View, ScrollView, Pressable, findNodeHandle} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import type {IMDbSuggestion} from '../../lib/services/imdbSuggestions';
import {isTV} from '../../lib/tv/constants';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import {useFloatingTabBarInset} from '../navigation/FloatingTabBarInsetContext';

interface SearchSuggestionsProps {
  suggestions: IMDbSuggestion[];
  onSelectSuggestion: (title: string) => void;
  /** Puts the title in the search field without searching, for editing. */
  onFillSuggestion?: (title: string) => void;
  searchFieldNodeHandle?: number | null;
  onFirstItemNodeHandle?: (node: number | null) => void;
}

interface SuggestionItemProps {
  item: IMDbSuggestion;
  index: number;
  onPress: (title: string) => void;
  onFill?: (title: string) => void;
  onItemFocus: (index: number) => void;
  focusBorderColor: string;
  nextFocusUp?: number | null;
  nextFocusDown?: number | null;
  itemRef?: (el: View | null) => void;
}

const SuggestionItem = memo(
  ({
    item,
    index,
    onPress,
    onFill,
    onItemFocus,
    focusBorderColor,
    nextFocusUp,
    nextFocusDown,
    itemRef,
  }: SuggestionItemProps) => {
    const colors = useM3Colors();
    const [isFocused, setIsFocused] = useState(false);

    const handlePress = useCallback(() => {
      onPress(item.title);
    }, [item.title, onPress]);

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onItemFocus(index);
    }, [onItemFocus, index]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
    }, []);

    return (
      <Pressable
        ref={itemRef as any}
        focusable={true}
        isTVSelectable={true}
        nextFocusUp={nextFocusUp ?? undefined}
        nextFocusDown={nextFocusDown ?? undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPress={handlePress}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Search suggestion: ${item.title}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 20,
          marginBottom: 8,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: isFocused
            ? colors.surfaceContainerHigh
            : colors.surfaceContainerLow,
          borderWidth: 2.5,
          borderColor: isFocused ? focusBorderColor : 'transparent',
        }}>
        <MaterialCommunityIcons
          name={item.type === 'tv' ? 'television' : 'filmstrip'}
          size={22}
          color={isFocused ? colors.primary : colors.onSurfaceVariant}
        />
        <AppText
          role="bodyLarge"
          numberOfLines={1}
          style={{
            flex: 1,
            marginLeft: 12,
            color: colors.onSurface,
            fontWeight: isFocused ? '700' : '400',
          }}>
          {item.title}
        </AppText>
        {onFill && (
          <Pressable
            onPress={() => onFill(item.title)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Edit search with ${item.title}`}
            style={({pressed}) => ({
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              marginVertical: -8,
              marginRight: -8,
              borderRadius: 18,
              backgroundColor: pressed
                ? colors.surfaceContainerHighest
                : 'transparent',
            })}>
            <MaterialCommunityIcons
              name="arrow-top-left"
              size={20}
              color={colors.onSurfaceVariant}
            />
          </Pressable>
        )}
      </Pressable>
    );
  },
);

const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  suggestions,
  onSelectSuggestion,
  onFillSuggestion,
  searchFieldNodeHandle,
  onFirstItemNodeHandle,
}) => {
  const focusBorderColor = useTVFocusBorderColor();
  const floatingTabBarInset = useFloatingTabBarInset();
  const scrollViewRef = useRef<ScrollView>(null);
  const itemRefs = useRef<(View | null)[]>([]);
  const [nodeHandles, setNodeHandles] = useState<(number | null)[]>([]);

  const visibleSuggestions = isTV ? suggestions.slice(0, 7) : suggestions;

  useEffect(() => {
    if (!isTV) return;
    const handles = visibleSuggestions.map((_, i) =>
      itemRefs.current[i] ? findNodeHandle(itemRefs.current[i]) : null,
    );
    setNodeHandles(handles);
    if (handles[0] && onFirstItemNodeHandle) {
      onFirstItemNodeHandle(handles[0]);
    }
  }, [visibleSuggestions, onFirstItemNodeHandle]);

  const handleSelect = useCallback(
    (title: string) => {
      onSelectSuggestion(title);
    },
    [onSelectSuggestion],
  );

  const handleItemFocus = useCallback((index: number) => {
    scrollViewRef.current?.scrollTo({
      y: index * 60,
      animated: true,
    });
  }, []);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <View style={{flex: 1, paddingHorizontal: 16, paddingTop: 8}}>
      {isTV ? (
        <View style={{paddingBottom: 20}}>
          {visibleSuggestions.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === visibleSuggestions.length - 1;
            const nextUp = isFirst
              ? searchFieldNodeHandle
              : nodeHandles[index - 1];
            const nextDown = isLast
              ? nodeHandles[index]
              : nodeHandles[index + 1];

            return (
              <SuggestionItem
                key={`${item.title}-${index}`}
                item={item}
                index={index}
                itemRef={el => {
                  itemRefs.current[index] = el;
                }}
                nextFocusUp={nextUp}
                nextFocusDown={nextDown}
                onPress={handleSelect}
                onItemFocus={handleItemFocus}
                focusBorderColor={focusBorderColor}
              />
            );
          })}
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{paddingBottom: 20 + floatingTabBarInset}}>
          {visibleSuggestions.map((item, index) => (
            <SuggestionItem
              key={`${item.title}-${index}`}
              item={item}
              index={index}
              onPress={handleSelect}
              onFill={onFillSuggestion}
              onItemFocus={handleItemFocus}
              focusBorderColor={focusBorderColor}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export default memo(SearchSuggestions);


