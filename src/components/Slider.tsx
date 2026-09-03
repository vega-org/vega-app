import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {Pressable, View} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import React, {memo, useCallback} from 'react';
import type {Post} from '../lib/providers/types';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useNavigation} from '@react-navigation/native';
import {HomeStackParamList} from '../App';
import useContentStore from '../lib/zustand/contentStore';
import SkeletonLoader from './Skeleton';
import MediaPosterCard, {parseAspectRatio} from './MediaPosterCard';
import {useM3Colors} from '../theme/M3PaletteContext';

import AppText from './ui/Text';

const Slider = ({
  isLoading,
  title,
  posts,
  filter,
  providerValue,
  isSearch = false,
  error,
}: {
  isLoading: boolean;
  title: string;
  posts: Post[];
  filter: string;
  providerValue?: string;
  isSearch?: boolean;
  error?: string;
}): React.ReactElement => {
  const provider = useContentStore(state => state.provider);
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [isSelected, setSelected] = React.useState('');

  const handleMorePress = useCallback(() => {
    navigation.navigate('ScrollList', {
      title: title,
      filter: filter,
      providerValue: providerValue,
      isSearch: isSearch,
    });
  }, [navigation, title, filter, providerValue, isSearch]);

  const handleItemPress = useCallback(
    (item: Post) => {
      setSelected('');
      navigation.navigate('Info', {
        link: item.link,
        provider: item.provider || providerValue || provider?.value,
        poster: item?.image,
      });
    },
    [navigation, providerValue, provider?.value],
  );

  const renderItem = useCallback(
    ({item}: {item: Post}) => {
      const ratio = parseAspectRatio(item.aspectRatio, 2 / 3);
      const cardWidth = ratio > 1.2 ? 220 : ratio > 0.85 ? 150 : 124;

      return (
        <MediaPosterCard
          title={item.title}
          poster={item.image}
          width={cardWidth}
          aspectRatio={item.aspectRatio}
          borderRadius={item.borderRadius}
          cornerTag={item.cornerTag || item.tag}
          onPress={() => handleItemPress(item)}
        />
      );
    },
    [handleItemPress],
  );

  const keyExtractor = useCallback((item: Post) => item.link, []);

  return (
    <Pressable onPress={() => setSelected('')} style={{gap: 14, marginTop: 28}}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
        }}>
        <AppText
          role="titleLargeEmphasized"
          style={{
            color: colors.onBackground,
            flex: 1,
            marginRight: 12,
            minWidth: 0,
          }}
          numberOfLines={1}>
          {title}
        </AppText>
        {filter !== 'recent' && (
          <Pressable
            accessibilityRole="button"
            onPress={handleMorePress}
            style={({pressed}) => ({
              alignItems: 'center',
              backgroundColor: pressed
                ? colors.surfaceContainerHighest
                : colors.surfaceContainerHigh,
              borderRadius: 18,
              flexShrink: 0,
              justifyContent: 'center',
              minHeight: 36,
              width: 92,
            })}>
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                height: 36,
                justifyContent: 'center',
                width: 72,
              }}>
              <AppText
                role="labelLargeEmphasized"
                numberOfLines={1}
                style={{color: colors.primary, width: 50}}>
                See all
              </AppText>
              <MaterialCommunityIcons
                name="chevron-right"
                color={colors.primary}
                size={18}
                style={{height: 18, width: 18}}
              />
            </View>
          </Pressable>
        )}
      </View>
      {isLoading ? (
        <View className="flex flex-row gap-2 overflow-hidden">
          {Array.from({length: 20}).map((_, index) => (
            <View
              className="gap-2 flex mb-3 justify-center"
              style={{marginLeft: index === 0 ? 18 : 0, marginRight: 12}}
              key={index}>
              <SkeletonLoader height={186} width={124} />
              <SkeletonLoader height={14} width={110} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          showsHorizontalScrollIndicator={false}
          data={posts}
          extraData={isSelected}
          horizontal
          contentContainerStyle={{
            paddingBottom: 4,
            paddingHorizontal: 20,
            alignItems: 'flex-end',
          }}
          ItemSeparatorComponent={() => <View style={{width: 14}} />}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={false}
          ListFooterComponent={
            !isLoading && error ? (
              <View className="flex flex-row w-96 justify-center h-10 items-center">
                <AppText
                  role="bodyMedium"
                  className="text-center text-m3-error">
                  {error}
                </AppText>
              </View>
            ) : !isLoading && posts.length === 0 ? (
              <View className="flex flex-row w-96 justify-center h-10 items-center">
                <AppText
                  role="bodyMedium"
                  className="text-center text-m3-on-surface-variant">
                  No content found
                </AppText>
              </View>
            ) : null
          }
        />
      )}
    </Pressable>
  );
};

export default memo(Slider);
