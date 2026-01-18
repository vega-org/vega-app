import {
  Image,
  Text,
  View,
  StatusBar,
  RefreshControl,
  FlatList,
  Linking,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {HomeStackParamList, TabStackParamList} from '../../App';
import LinearGradient from 'react-native-linear-gradient';
import SeasonList from '../../components/SeasonList';
import Ionicons from '@expo/vector-icons/Ionicons';
import {settingsStorage, watchListStorage} from '../../lib/storage';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import useContentStore from '../../lib/zustand/contentStore';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import useThemeStore from '../../lib/zustand/themeStore';
import {useNavigation} from '@react-navigation/native';
import useWatchListStore from '../../lib/zustand/watchListStore';
import {useContentDetails} from '../../lib/hooks/useContentInfo';
import {QueryErrorBoundary} from '../../components/ErrorBoundary';
import SkeletonLoader from '../../components/Skeleton';
// import {BlurView} from 'expo-blur';

type Props = NativeStackScreenProps<HomeStackParamList, 'Info'>;
export default function Info({route, navigation}: Props): React.JSX.Element {
  const searchNavigation =
    useNavigation<NativeStackNavigationProp<TabStackParamList>>();
  const {primary} = useThemeStore(state => state);
  const {addItem, removeItem} = useWatchListStore(state => state);
  const {provider} = useContentStore(state => state);

  // React Query for optimized data fetching
  const {
    info,
    meta,
    isLoading: infoLoading,
    error,
    refetch,
  } = useContentDetails(
    route.params.link,
    route.params.provider || provider.value,
  );

  // UI state
  const [threeDotsMenuOpen, setThreeDotsMenuOpen] = useState(false);
  const [readMore, setReadMore] = useState(false);
  const [menuPosition, setMenuPosition] = useState({top: -1000, right: 0});
  const [backgroundColor, setBackgroundColor] = useState('transparent');
  const [logoError, setLogoError] = useState(false);

  const threeDotsRef = useRef<any | null>(null);

  // Memoized values
  const [inLibrary, setInLibrary] = useState(() =>
    watchListStorage.isInWatchList(route.params.link),
  );

  // Memoized handlers
  const openThreeDotsMenu = useCallback(() => {
    if (threeDotsRef.current) {
      threeDotsRef.current.measure(
        (
          x: number,
          y: number,
          width: number,
          height: number,
          pageX: number,
          pageY: number,
        ) => {
          setMenuPosition({top: pageY - 35, right: 35});
          setThreeDotsMenuOpen(true);
        },
      );
    }
  }, []);

  const handleScroll = useCallback((event: any) => {
    setBackgroundColor(
      event.nativeEvent.contentOffset.y > 150 ? 'black' : 'transparent',
    );
  }, []);
  // Optimized library management
  const addLibrary = useCallback(() => {
    ReactNativeHapticFeedback.trigger('effectClick', {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
    addItem({
      title: meta?.name || info?.title,
      poster: meta?.poster || route.params.poster || info?.image,
      link: route.params.link,
      provider: route.params.provider || provider.value,
    });
    setInLibrary(true);
  }, [meta, info, route.params, provider.value, addItem]);

  const removeLibrary = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    removeItem(route.params.link);
    setInLibrary(false);
  }, [route.params.link, removeItem]);

  // Memoized computed values
  const synopsis = useMemo(() => {
    return meta?.description || info?.synopsis || 'No synopsis available';
  }, [meta?.description, info?.synopsis]);

  const displayTitle = useMemo(() => {
    return meta?.name || info?.title;
  }, [meta?.name, info?.title]);

  const posterImage = useMemo(() => {
    return (
      meta?.poster ||
      route.params.poster ||
      info?.image ||
      'https://placehold.jp/24/363636/ffffff/500x500.png?text=Vega'
    );
  }, [meta?.poster, route.params.poster, info?.image]);

  const backgroundImage = useMemo(() => {
    return (
      meta?.background ||
      info?.image ||
      'https://placehold.jp/24/363636/ffffff/500x500.png?text=Vega'
    );
  }, [meta?.background, info?.image]);
  const filteredLinkList = useMemo(() => {
    if (!info?.linkList) {
      return [];
    }

    const excludedQualities = settingsStorage.getExcludedQualities();
    const filtered = info.linkList.filter(
      (item: any) =>
        !item.quality || !excludedQualities.includes(item.quality as string),
    );

    return filtered.length > 0 ? filtered : info.linkList;
  }, [info?.linkList]);

  // Optimized refresh handler
  const handleRefresh = useCallback(async () => {
    try {
      await refetch();
    } catch (refreshError) {
      console.error('Error refreshing content:', refreshError);
      // Could show a toast or alert here if needed
    }
  }, [refetch]);

  // Error handling - show error UI instead of throwing
  if (error) {
    return (
      <View className="h-full w-full bg-black justify-center items-center p-4">
        <StatusBar
          showHideTransition={'slide'}
          animated={true}
          translucent={true}
          backgroundColor="black"
        />
        <Text className="text-red-400 text-lg font-bold mb-4 text-center">
          Failed to load content
        </Text>
        <Text className="text-gray-400 text-sm mb-6 text-center">
          {error.message ||
            'An unexpected error occurred while loading the content'}
        </Text>
        <TouchableOpacity
          onPress={handleRefresh}
          className="bg-red-600 px-6 py-3 rounded-lg mb-4">
          <Text className="text-white font-semibold">Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="bg-gray-600 px-6 py-3 rounded-lg">
          <Text className="text-white font-semibold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <QueryErrorBoundary>
      <View className="h-full w-full">
        <StatusBar
          showHideTransition={'slide'}
          animated={true}
          translucent={true}
          backgroundColor={backgroundColor}
        />
        <View>
          <View className="absolute w-full h-[256px]">
            <SkeletonLoader show={infoLoading} height={256} width={'100%'}>
              <Image
                source={{uri: backgroundImage}}
                className=" h-[256] w-full"
                onError={e => {
                  console.warn('Background image failed to load:', e);
                }}
              />
            </SkeletonLoader>
          </View>

          {
            // manifest[route.params.provider || provider.value].blurImage && (
            //   <BlurView
            //     intensity={4}
            //     blurReductionFactor={1}
            //     experimentalBlurMethod="dimezisBlurView"
            //     tint="default"
            //     style={{
            //       position: 'absolute',
            //       top: 0,
            //       left: 0,
            //       right: 0,
            //       bottom: 0,
            //       height: 256,
            //       width: '100%',
            //     }}
            //   />
            // )
          }
          <FlatList
            data={[]}
            keyExtractor={(_, i) => i.toString()}
            renderItem={() => <View />}
            ListHeaderComponent={
              <>
                <View className="relative w-full h-[256px]">
                  <LinearGradient
                    colors={['transparent', 'black']}
                    className="absolute h-full w-full"
                  />
                  <View className="absolute bottom-0 right-0 w-screen flex-row justify-between items-baseline px-2">
                    {(meta?.logo && !logoError) || infoLoading ? (
                      <Image
                        onError={() => setLogoError(true)}
                        source={{uri: meta?.logo}}
                        style={{width: 200, height: 100, resizeMode: 'contain'}}
                      />
                    ) : (
                      <Text className="text-white text-2xl mt-3 capitalize font-semibold w-3/4 truncate">
                        {displayTitle}
                      </Text>
                    )}
                    {/* rating */}
                    {(meta?.imdbRating || info?.rating) && (
                      <Text className="text-white text-2xl font-semibold">
                        {meta?.imdbRating || info?.rating}
                        <Text className="text-white text-lg">/10</Text>
                      </Text>
                    )}
                  </View>
                </View>
                <View className="p-4 bg-black">
                  <View className="flex-row gap-x-3 gap-y-1 flex-wrap items-center mb-4">
                    {/* badges */}
                    {meta?.year && (
                      <Text className="text-white text-lg bg-tertiary px-2 rounded-md">
                        {meta?.year}
                      </Text>
                    )}
                    {meta?.runtime && (
                      <Text className="text-white text-lg bg-tertiary px-2 rounded-md">
                        {meta?.runtime}
                      </Text>
                    )}
                    {meta?.genres?.slice(0, 2).map((genre: string) => (
                      <Text
                        key={genre}
                        className="text-white text-lg bg-tertiary px-2 rounded-md">
                        {genre}
                      </Text>
                    ))}
                    {info?.tags?.slice(0, 3)?.map((tag: string) => (
                      <Text
                        key={tag}
                        className="text-white text-lg bg-tertiary px-2 rounded-md">
                        {tag}
                      </Text>
                    ))}
                  </View>
                  {/* Awards */}
                  {meta?.awards && (
                    <View className="mb-2 w-full flex-row items-baseline gap-2">
                      <Text className="text-white text- font-semibold">
                        Awards:
                      </Text>
                      <Text className="text-white text-xs px-1 bg-tertiary rounded-sm">
                        {meta?.awards?.length > 50
                          ? meta?.awards.slice(0, 50) + '...'
                          : meta?.awards}
                      </Text>
                    </View>
                  )}
                  {/* cast  */}
                  {(meta?.cast?.length! > 0 || info?.cast?.length! > 0) && (
                    <View className="mb-2 w-full flex-row items-start gap-2">
                      <Text className="text-white text-lg font-semibold pt-[0.9px]">
                        Cast
                      </Text>
                      <View className="flex-row gap-1 flex-wrap">
                        {meta?.cast
                          ?.slice(0, 3)
                          .map((actor: string, index: number) => (
                            <Text
                              key={actor}
                              numberOfLines={1}
                              className={`text-xs bg-tertiary p-1 px-2 rounded-md ${
                                index % 3 === 0
                                  ? 'text-red-500'
                                  : index % 3 === 1
                                    ? 'text-blue-500'
                                    : 'text-green-500'
                              }`}>
                              {actor}
                            </Text>
                          ))}
                        {info?.cast
                          ?.slice(0, 3)
                          .map((actor: string, index: number) => (
                            <Text
                              key={actor}
                              className={`text-xs bg-tertiary p-1 px-2 rounded-md ${
                                index % 3 === 0
                                  ? 'text-red-500'
                                  : index % 3 === 1
                                    ? 'text-blue-500'
                                    : 'text-green-500'
                              }`}>
                              {actor}
                            </Text>
                          ))}
                      </View>
                    </View>
                  )}
                  {/* synopsis */}
                  <View className="mb-2 w-full flex-row items-center justify-between">
                    <SkeletonLoader show={infoLoading} height={25} width={180}>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-white text-lg font-semibold">
                          Synopsis
                        </Text>
                        <Text className="text-white text-xs bg-tertiary p-1 px-2 rounded-md">
                          {route.params.provider || provider.value}
                        </Text>
                      </View>
                    </SkeletonLoader>
                    <View className="flex-row items-center gap-4 mb-1">
                      {meta?.trailers && meta?.trailers.length > 0 && (
                        <MaterialCommunityIcons
                          name="movie-open"
                          size={25}
                          color="rgb(156 163 175)"
                          onPress={() =>
                            Linking.openURL(
                              'https://www.youtube.com/watch?v=' +
                                meta?.trailers?.[0]?.source,
                            )
                          }
                        />
                      )}
                      {inLibrary ? (
                        <Ionicons
                          name="bookmark"
                          size={30}
                          color={primary}
                          onPress={() => removeLibrary()}
                        />
                      ) : (
                        <Ionicons
                          name="bookmark-outline"
                          size={30}
                          color={primary}
                          onPress={() => addLibrary()}
                        />
                      )}
                      <TouchableOpacity
                        onPress={() => openThreeDotsMenu()}
                        ref={threeDotsRef}>
                        <MaterialCommunityIcons
                          name="dots-vertical"
                          size={25}
                          color="rgb(156 163 175)"
                        />
                      </TouchableOpacity>
                      {
                        <Modal
                          animationType="none"
                          transparent={true}
                          visible={threeDotsMenuOpen}
                          onRequestClose={() => {
                            setThreeDotsMenuOpen(false);
                          }}>
                          <Pressable
                            onPress={() => setThreeDotsMenuOpen(false)}
                            className="flex-1 bg-opacity-50">
                            <View
                              className="rounded-md p-2 w-48 bg-quaternary absolute right-10 top-[330px]"
                              style={{
                                top: menuPosition.top,
                                right: menuPosition.right,
                              }}>
                              {/* open in web  */}
                              <TouchableOpacity
                                className="flex-row items-center gap-2"
                                onPress={async () => {
                                  setThreeDotsMenuOpen(false);
                                  navigation.navigate('Webview', {
                                    link: route.params.link,
                                  });
                                }}>
                                <MaterialCommunityIcons
                                  name="web"
                                  size={21}
                                  color="rgb(156 163 175)"
                                />
                                <Text className="text-white text-base">
                                  Open in Web
                                </Text>
                              </TouchableOpacity>
                              {/* search */}
                              <TouchableOpacity
                                className="flex-row items-center gap-2 mt-1"
                                onPress={async () => {
                                  setThreeDotsMenuOpen(false);
                                  //@ts-ignore
                                  searchNavigation.navigate('SearchStack', {
                                    screen: 'SearchResults',
                                    params: {
                                      filter: displayTitle,
                                    },
                                  });
                                }}>
                                <Ionicons
                                  name="search"
                                  size={21}
                                  color="rgb(156 163 175)"
                                />
                                <Text className="text-white text-base">
                                  Search Title
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </Pressable>
                        </Modal>
                      }
                    </View>
                  </View>
                  <SkeletonLoader show={infoLoading} height={85} width={'100%'}>
                    <Text className="text-gray-200 text-sm px-2 py-1 bg-tertiary rounded-md">
                      {synopsis.length > 180 && !readMore
                        ? synopsis.slice(0, 180) + '... '
                        : synopsis}
                      {synopsis.length > 180 && !readMore && (
                        <Text
                          onPress={() => setReadMore(!readMore)}
                          className="text-white font-extrabold text-xs px-2 bg-tertiary rounded-md">
                          read more
                        </Text>
                      )}
                    </Text>
                  </SkeletonLoader>
                  {/* cast */}
                </View>
                <View className="p-4 bg-black">
                  {infoLoading ? (
                    <View className="gap-y-3 items-start mb-4 p-3">
                      <SkeletonLoader show={true} height={30} width={80} />
                      {[...Array(1)].map((_, i) => (
                        <View
                          className="bg-tertiary p-1 rounded-md gap-3 mt-3"
                          key={i}>
                          <SkeletonLoader
                            show={true}
                            height={20}
                            width={'100%'}
                          />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <SeasonList
                      refreshing={false}
                      providerValue={route.params.provider || provider.value}
                      LinkList={filteredLinkList}
                      poster={{
                        logo: meta?.logo,
                        poster: posterImage,
                        background: backgroundImage,
                      }}
                      type={info?.type || 'series'}
                      metaTitle={displayTitle}
                      routeParams={route.params}
                    />
                  )}
                </View>
              </>
            }
            ListFooterComponent={<View className="h-16" />}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16} // Optimize scroll performance
            refreshControl={
              <RefreshControl
                colors={[primary]}
                tintColor={primary}
                progressBackgroundColor={'black'}
                refreshing={false}
                onRefresh={handleRefresh}
              />
            }
          />
        </View>
      </View>
    </QueryErrorBoundary>
  );
}
