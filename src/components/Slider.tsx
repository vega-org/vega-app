import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useWindowDimensions, View} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import React, {
  memo,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
} from 'react';
import type {Post} from '../lib/providers/types';
import {deduplicatePosts} from '../lib/providers/deduplicatePosts';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useNavigation} from '@react-navigation/native';
import {HomeStackParamList} from '../App';
import useContentStore from '../lib/zustand/contentStore';
import SkeletonLoader from './Skeleton';
import MediaPosterCard, {parseAspectRatio} from './MediaPosterCard';
import {useM3Colors} from '../theme/M3PaletteContext';
import {isTV} from '../lib/tv/constants';
import {TVFocusable, TVFocusGuide} from './tv';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';

import AppText from './ui/Text';
import {beginUIInteraction, endUIInteraction} from '../lib/performance/idleWork';

const SKELETON_CARD_SPAN = 136;
const MAX_SKELETON_CARDS = 20;
const rowOffsets = new Map<string, number>();
const saveRowOffset = (key: string, offset: number) => {
  rowOffsets.delete(key);
  rowOffsets.set(key, offset);
  if (rowOffsets.size > 120) rowOffsets.delete(rowOffsets.keys().next().value!);
};

const SliderSeparator = () => <View style={{width: 14}} />;

// One memoized cell per post, so the press handler stays stable and
// MediaPosterCard skips re-rendering when the list re-renders.
const SliderPosterItem = memo(
  ({item, onPressItem}: {item: Post; onPressItem: (item: Post) => void}) => {
    const ratio = parseAspectRatio(item.aspectRatio, 2 / 3);
    const cardWidth = ratio > 1.2 ? 220 : ratio > 0.85 ? 150 : 124;
    const handlePress = useCallback(
      () => onPressItem(item),
      [onPressItem, item],
    );

    return (
      <MediaPosterCard
        title={item.title}
        poster={item.image}
        width={cardWidth}
        aspectRatio={item.aspectRatio}
        borderRadius={item.borderRadius}
        cornerTag={item.cornerTag || item.tag}
        onPress={handlePress}
      />
    );
  },
);

const Slider = ({
  isLoading,
  title,
  posts,
  filter,
  providerValue,
  scrollKey,
  isSearch = false,
  error,
  deferPosts = false,
}: {
  isLoading: boolean;
  title: string;
  posts: Post[];
  filter: string;
  providerValue?: string;
  scrollKey?: string;
  isSearch?: boolean;
  error?: string;
  deferPosts?: boolean;
}): React.ReactElement => {
  // Explicit row providers must not subscribe recycled/offscreen rows to the
  // global selection change before Home supplies their new data.
  const fallbackProviderValue = useContentStore(state =>
    providerValue ? undefined : state.provider?.value,
  );
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [isSelected, setSelected] = React.useState('');
  const listRef = useRef<FlatList<Post>>(null);
  const pendingOffset = useRef<number | undefined>(undefined);
  const interactionKey = `home-row:${scrollKey ?? title}`;
  React.useEffect(() => () => {
    endUIInteraction(interactionKey + ":drag");
    endUIInteraction(interactionKey + ":momentum");
  }, [interactionKey]);
  useLayoutEffect(() => {
    if (isTV || !scrollKey || isLoading) return;
    setSelected('');
    pendingOffset.current = rowOffsets.get(scrollKey) ?? 0;
    listRef.current?.scrollToOffset({
      offset: pendingOffset.current,
      animated: false,
    });
  }, [scrollKey, isLoading]);
  const restoreOffset = useCallback(() => {
    if (pendingOffset.current === undefined) return;
    listRef.current?.scrollToOffset({
      offset: pendingOffset.current,
      animated: false,
    });
    pendingOffset.current = undefined;
  }, []);
  const uniquePosts = useMemo(() => deduplicatePosts(posts), [posts]);
  const {width: windowWidth} = useWindowDimensions();
  // Cards that fit on screen, plus one. The skeleton row clips overflow, so
  // more are never seen; the post row renders this many before measuring.
  const skeletonCount = Math.min(
    MAX_SKELETON_CARDS,
    Math.ceil(windowWidth / SKELETON_CARD_SPAN) + 1,
  );

  const handleMorePress = useCallback(() => {
    navigation.navigate('ScrollList', {
      title: title,
      filter: filter,
      providerValue: providerValue || posts[0]?.provider || fallbackProviderValue,
      isSearch: isSearch,
    });
  }, [
    navigation,
    title,
    filter,
    providerValue,
    posts,
    fallbackProviderValue,
    isSearch,
  ]);

  const handleItemPress = useCallback(
    (item: Post) => {
      setSelected('');
      navigation.navigate('Info', {
        link: item.link,
        provider: item.provider || providerValue || fallbackProviderValue,
        poster: item?.image,
      });
    },
    [navigation, providerValue, fallbackProviderValue],
  );

  const renderItem = useCallback(
    ({item}: {item: Post}) => (
      <SliderPosterItem item={item} onPressItem={handleItemPress} />
    ),
    [handleItemPress],
  );

  const keyExtractor = useCallback(
    (item: Post, index: number) =>
      JSON.stringify([
        item.provider || providerValue || fallbackProviderValue || '',
        item.link || index,
      ]),
    [providerValue, fallbackProviderValue],
  );

  return (
    <TVFocusGuide
      autoFocus={false}
      style={{gap: 14, marginTop: 28, overflow: 'visible'}}>
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
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
            onPress={handleMorePress}
            borderRadius={18}
            focusScale={1.1}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHigh,
              borderRadius: 18,
              flexShrink: 0,
              justifyContent: 'center',
              minHeight: 36,
              // The chevron glyph has ~6dp of empty space on its right, so
              // less right padding makes both sides look even.
              paddingLeft: 14,
              paddingRight: 8,
            }}>
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                height: 24,
                justifyContent: 'center',
              }}>
              <AppText
                role="labelLargeEmphasized"
                numberOfLines={1}
                style={{color: colors.primary, marginRight: 2}}>
                See all
              </AppText>
              <MaterialCommunityIcons
                name="chevron-right"
                color={colors.primary}
                size={18}
              />
            </View>
          </TVFocusable>
        )}
      </View>
      {deferPosts ? (
        // One static placeholder instead of mounting animated skeletons and
        // native text/image cells for every incoming row in the same commit.
        <View accessibilityLabel={title + ' loading'} style={{height: 243, marginHorizontal: 20, borderRadius: 18, backgroundColor: colors.surfaceContainerHigh}} />
      ) : isLoading ? (
        <View className="flex flex-row gap-2 overflow-hidden">
          {Array.from({length: skeletonCount}).map((_, index) => (
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
          key={isTV ? undefined : scrollKey}
          ref={listRef}
          onScrollBeginDrag={() => { restoreOffset(); beginUIInteraction(interactionKey + ":drag"); }}
          onScrollEndDrag={() => endUIInteraction(interactionKey + ":drag")}
          onMomentumScrollBegin={() => beginUIInteraction(interactionKey + ":momentum")}
          onMomentumScrollEnd={() => endUIInteraction(interactionKey + ":momentum")}
          onContentSizeChange={restoreOffset}
          onScroll={
            isTV || !scrollKey
              ? undefined
              : event => {
                  if (pendingOffset.current === undefined)
                    saveRowOffset(scrollKey, event.nativeEvent.contentOffset.x);
                }
          }
          scrollEventThrottle={100}
          showsHorizontalScrollIndicator={false}
          data={uniquePosts}
          extraData={isSelected}
          horizontal
          style={{overflow: 'visible'}}
          contentContainerStyle={{
            paddingVertical: 12,
            paddingHorizontal: 20,
            overflow: 'visible',
          }}
          ItemSeparatorComponent={SliderSeparator}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={skeletonCount}
          maxToRenderPerBatch={isTV ? 8 : 4}
          // Phones keep one screen of posters on each side to bound provider
          // rebinding work. TV keeps two for held D-pad navigation.
          windowSize={isTV ? 5 : 3}
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
            ) : isTV && filter !== 'recent' && posts.length > 0 ? (
              <View
                style={{
                  marginLeft: 14,
                  marginRight: 20,
                  justifyContent: 'center',
                  paddingVertical: 6,
                }}>
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel={`See all ${title}`}
                  onPress={handleMorePress}
                  focusScale={1.05}
                  focusBorderColor={focusBorderColor}
                  borderRadius={18}
                  style={{
                    width: 124,
                    height: 186,
                    borderRadius: 18,
                    backgroundColor: colors.surfaceContainerHigh,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 12,
                  }}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: colors.surfaceContainerHighest,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 10,
                    }}>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      color={colors.primary}
                      size={26}
                    />
                  </View>
                  <AppText
                    role="labelLargeEmphasized"
                    numberOfLines={2}
                    style={{color: colors.primary, textAlign: 'center'}}>
                    See all
                  </AppText>
                </TVFocusable>
              </View>
            ) : null
          }
        />
      )}
    </TVFocusGuide>
  );
};

export default memo(Slider);
