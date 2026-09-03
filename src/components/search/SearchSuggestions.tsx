import React, {memo, useCallback} from 'react';
import {Pressable, FlatList} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Animated, {FadeInDown, FadeOut} from 'react-native-reanimated';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import type {IMDbSuggestion} from '../../lib/services/imdbSuggestions';

interface SearchSuggestionsProps {
  suggestions: IMDbSuggestion[];
  onSelectSuggestion: (title: string) => void;
}

const SuggestionItem = memo(
  ({
    item,
    onPress,
  }: {
    item: IMDbSuggestion;
    onPress: (title: string) => void;
  }) => {
    const colors = useM3Colors();
    const handlePress = useCallback(() => {
      onPress(item.title);
    }, [item.title, onPress]);

    return (
      <Pressable
        onPress={handlePress}
        className="flex-row items-center rounded-[20px] mb-2 px-4 py-3.5"
        style={({pressed}) => ({
          backgroundColor: colors.surfaceContainerLow,
          opacity: pressed ? 0.72 : 1,
        })}>
        <MaterialCommunityIcons
          name={item.type === 'tv' ? 'television' : 'filmstrip'}
          size={22}
          color={colors.onSurfaceVariant}
        />
        <AppText
          role="bodyLarge"
          numberOfLines={1}
          className="flex-1 ml-3 text-m3-on-surface">
          {item.title}
        </AppText>
      </Pressable>
    );
  },
);

const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  suggestions,
  onSelectSuggestion,
}) => {
  const keyExtractor = useCallback(
    (item: IMDbSuggestion, index: number) => `${item.title}-${index}`,
    [],
  );

  const renderItem = useCallback(
    ({item}: {item: IMDbSuggestion}) => (
      <SuggestionItem item={item} onPress={onSelectSuggestion} />
    ),
    [onSelectSuggestion],
  );

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(150)}
      className="px-4 flex-1 pt-2">
      <FlatList
        data={suggestions}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 20}}
      />
    </Animated.View>
  );
};

export default memo(SearchSuggestions);
