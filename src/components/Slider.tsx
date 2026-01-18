import {Image, Pressable, Text, TouchableOpacity, View} from 'react-native';
import React from 'react';
import type {Post} from '../lib/providers/types';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useNavigation} from '@react-navigation/native';
import {HomeStackParamList} from '../App';
import useContentStore from '../lib/zustand/contentStore';
import {FlashList} from '@shopify/flash-list';
import SkeletonLoader from './Skeleton';

// import useWatchHistoryStore from '../lib/zustand/watchHistrory';
import useThemeStore from '../lib/zustand/themeStore';

export default function Slider({
  isLoading,
  title,
  posts,
  filter,
  providerValue,
  isSearch = false,
}: {
  isLoading: boolean;
  title: string;
  posts: Post[];
  filter: string;
  providerValue?: string;
  isSearch?: boolean;
}): JSX.Element {
  const {provider} = useContentStore(state => state);
  const {primary} = useThemeStore(state => state);
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [isSelected, setSelected] = React.useState('');
  // const {removeItem} = useWatchHistoryStore(state => state);

  return (
    <Pressable onPress={() => setSelected('')} className="gap-3 mt-3 px-2">
      <View className="flex flex-row items-center justify-between">
        <Text
          className="text-2xl font-semibold flex-1"
          numberOfLines={1}
          style={{color: primary}}>
          {title}
        </Text>
        {filter !== 'recent' && (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('ScrollList', {
                title: title,
                filter: filter,
                providerValue: providerValue,
                isSearch: isSearch,
              })
            }>
            <Text className="text-white text-sm">more</Text>
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <View className="flex flex-row gap-2 overflow-hidden">
          {Array.from({length: 20}).map((_, index) => (
            <View
              className="mx-3 gap-0 flex mb-3 justify-center items-center"
              key={index}>
              <SkeletonLoader height={150} width={100} />
              <SkeletonLoader height={12} width={97} />
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          estimatedItemSize={30}
          showsHorizontalScrollIndicator={false}
          data={posts}
          extraData={isSelected}
          horizontal
          contentContainerStyle={{paddingHorizontal: 3, paddingTop: 7}}
          renderItem={({item}) => (
            <View className="flex flex-col mx-2">
              <TouchableOpacity
                onLongPress={e => {
                  e.stopPropagation();
                  // if (filter === 'recent') {
                  //   console.log('long press', filter);
                  //   ReactNativeHapticFeedback.trigger('effectClick', {
                  //     enableVibrateFallback: true,
                  //     ignoreAndroidSystemSettings: false,
                  //   });
                  //   setSelected(item.link);
                  // }
                }}
                onPress={e => {
                  e.stopPropagation();
                  setSelected('');
                  navigation.navigate('Info', {
                    link: item.link,
                    provider: item.provider || providerValue || provider?.value,
                    poster: item?.image,
                  });
                }}>
                <Image
                  className="rounded-md"
                  source={{
                    uri:
                      item?.image ||
                      'https://placehold.jp/24/363636/ffffff/100x150.png?text=vega',
                  }}
                  style={{width: 100, height: 150}}
                />
                {/* {isSelected === item.link && (
                  <View className="absolute top-0 left-0 w-full h-full bg-black/50 flex justify-center items-center z-50">
                    <AntDesign
                      name="delete"
                      size={24}
                      color="white"
                      onPress={() => {
                        console.log('remove', item);
                        setSelected('');
                        removeItem(item);
                      }}
                    />
                  </View>
                )} */}
              </TouchableOpacity>
              <Text className="text-white text-center truncate w-24 text-xs">
                {item.title.length > 24
                  ? `${item.title.slice(0, 24)}...`
                  : item.title}
              </Text>
            </View>
          )}
          ListFooterComponent={
            !isLoading && posts.length === 0 ? (
              <View className="flex flex-row w-96 justify-center h-10 items-center">
                <Text className="text-whiter text-center text-white">
                  No content found
                </Text>
              </View>
            ) : null
          }
          keyExtractor={item => item.link}
        />
      )}
    </Pressable>
  );
}
