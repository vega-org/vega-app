import React, {memo, useEffect, useState} from 'react';
import {Pressable, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SearchStackParamList} from '../../App';
import useContentStore from '../../lib/zustand/contentStore';
import {providerManager} from '../../lib/services/ProviderManager';
import {Catalog} from '../../lib/providers/types';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';

// Genres of the selected provider, each one opens its list.
const GenreChips = () => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<SearchStackParamList>>();
  const provider = useContentStore(state => state.provider);
  const [genres, setGenres] = useState<Catalog[]>([]);

  useEffect(() => {
    if (!provider?.value) {
      setGenres([]);
      return;
    }
    let cancelled = false;
    providerManager
      .getGenres({providerValue: provider.value})
      .then(list => {
        if (!cancelled) {
          setGenres(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGenres([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider?.value]);

  if (genres.length === 0) {
    return null;
  }

  return (
    <>
      <AppText
        role="titleMediumEmphasized"
        className="text-m3-on-surface px-4 mb-2">
        Genres in {provider.display_name}
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{gap: 8, paddingHorizontal: 16}}>
        {genres.map(genre => (
          <Pressable
            key={genre.title + genre.filter}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('ScrollList', {
                filter: genre.filter,
                title: genre.title,
                providerValue: provider.value,
                isSearch: false,
              })
            }
            style={{
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              borderRadius: 12,
              borderWidth: 1,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}>
            <AppText
              role="labelLargeEmphasized"
              style={{color: colors.onSurface}}>
              {genre.title}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
};

export default memo(GenreChips);
