import {useStagedHomeRows} from '../../lib/hooks/useStagedHomeRows';
import {scheduleWhenIdle} from '../../lib/performance/idleWork';
import {type ProviderExtension} from '../../lib/storage/extensionStorage';
import {
  beginUIInteraction,
  endUIInteraction,
} from '../../lib/performance/idleWork';
import {RefreshControl, ScrollView, View, Modal, Pressable} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import Slider from '../../components/Slider';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import HeroOptimized from '../../components/Hero';
import {mainStorage} from '../../lib/storage';
import useContentStore from '../../lib/zustand/contentStore';
import useHeroStore from '../../lib/zustand/herostore';
import {syncFromSharedFolder} from '../../lib/sync/syncService';
import {
  useHomePageData,
  getRandomHeroPosts,
  clearHeroCache,
} from '../../lib/hooks/useHomePageData';
import ProviderDrawer from '../../components/ProviderDrawer';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {HomeStackParamList} from '../../App';
import {Drawer} from 'react-native-drawer-layout';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {Post} from '../../lib/providers/types';
import Tutorial from '../../components/Touturial';
import {QueryErrorBoundary} from '../../components/ErrorBoundary';
import {StatusBar} from 'expo-status-bar';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import ContinueWatching from '../../components/ContinueWatching';
import StatusBarScrim from '../../components/ui/StatusBarScrim';
import {isTV} from '../../lib/tv/constants';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';

type Props = NativeStackScreenProps<HomeStackParamList, 'Home'>;

type HomeRow = {
  key: string;
  isLoading: boolean;
  title: string;
  filter: string;
  posts: Post[];
  error?: string;
  deferPosts?: boolean;
};

const EMPTY_POSTS: Post[] = [];

const homeRowKey = (row: HomeRow) => row.key;

// Phones share structural recycling types; TV retains its focus/scroll policy.
const homeRowType = (row: HomeRow) =>
  isTV ? row.key : row.isLoading ? 'loading' : 'catalog';

// TV focus can only move to rows that are mounted. Keep about two rows ahead
// ready so fast D-pad presses do not run past the rendered content.
const HOME_DRAW_DISTANCE = isTV ? 800 : 250;

const Home = ({}: Props) => {
  const colors = useM3Colors();
  const isFocused = useIsFocused();
  const [statusBarScrimVisible, setStatusBarScrimVisible] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Keep Home controls/hero paused until the closing slide completes.
  const [drawerSceneActive, setDrawerSceneActive] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const [heroVisible, setHeroVisible] = useState(true);
  const showContinueWatching = useNavigationPreferencesStore(
    state => state.showContinueWatching,
  );

  // Memoize static values
  const disableDrawer = useMemo(
    () => mainStorage.getBool('disableDrawer') || false,
    [],
  );

  const provider = useContentStore(state => state.provider);
  const pendingProvider = React.useRef<ProviderExtension | null>(null);
  const selectProvider = useCallback((item: ProviderExtension) => {
    pendingProvider.current = item;
    setIsDrawerOpen(false);
  }, []);
  const finishDrawerTransition = useCallback((closing: boolean) => {
    endUIInteraction('home-drawer');
    if (closing) {
      setIsDrawerOpen(false);
      setDrawerSceneActive(false);
    }
    if (closing && pendingProvider.current) {
      const selected = pendingProvider.current;
      pendingProvider.current = null;
      useContentStore.getState().setProvider(selected);
    }
  }, []);
  const installedProviders = useContentStore(state => state.installedProviders);
  const setHeroes = useHeroStore(state => state.setHeroes);

  // React Query for home page data with better error handling
  const {
    data: homeData = [],
    isLoading,
    catalog: skeletonCatalog,
    error,
    refetch,
    // isStale,
  } = useHomePageData({
    provider,
    enabled: !!(installedProviders?.length && provider?.value),
  });

  useEffect(
    () => () => {
      [
        'home-scroll',
        'home-momentum',
        'home-drawer',
        'home-drawer-gesture',
      ].forEach(endUIInteraction);
    },
    [],
  );

  // Memoized scroll handler
  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent?.contentOffset?.y ?? 0;
    setStatusBarScrimVisible(offsetY > 12);
    setIsAtTop(offsetY <= 0);
    setHeroVisible(offsetY < 410);
  }, []);

  // Heroes are kept per provider, so a refetch does not pick new ones.
  const heroPosts = useMemo(
    () => getRandomHeroPosts(homeData, provider?.value),
    [homeData, provider?.value],
  );

  React.useEffect(() => {
    setHeroes(heroPosts);
  }, [heroPosts, setHeroes]);

  useFocusEffect(
    useCallback(() => {
      return scheduleWhenIdle(() => syncFromSharedFolder());
    }, []),
  );

  // Optimized refresh handler
  // Promise chain instead of try/finally: React Compiler skips any component
  // that contains a finally clause.
  const handleRefresh = useCallback(() => {
    setManualRefreshing(true);
    const refresh = async () => {
      // Clear hero cache to get a new random hero on refresh
      clearHeroCache(provider?.value);
      await Promise.race([
        Promise.allSettled([
          refetch(),
          syncFromSharedFolder().catch(e =>
            console.warn('[VegaSync] Home refresh sync failed:', e),
          ),
        ]),
        new Promise(resolve => setTimeout(resolve, 10000)),
      ]);
    };
    return refresh()
      .catch(refreshError => {
        console.error('Error refreshing home data:', refreshError);
      })
      .then(() => {
        setTimeout(() => {
          setManualRefreshing(false);
        }, 50);
      });
  }, [refetch, provider.value]);

  // Rows of the vertical list. The list mounts only the rows near the screen,
  // so opening Home no longer builds every catalog row and its posters at once.
  const rows = useMemo<HomeRow[]>(
    () =>
      isLoading
        ? skeletonCatalog.map((item, index) => ({
            key: JSON.stringify([
              provider.source?.author,
              provider.value,
              item.filter,
              index,
            ]),
            isLoading: true,
            title: item.title,
            filter: item.filter,
            posts: EMPTY_POSTS,
          }))
        : homeData.map((item, index) => ({
            key: JSON.stringify([
              provider.source?.author,
              provider.value,
              item.filter,
              index,
            ]),
            isLoading: !!item.isLoading,
            title: item.title,
            filter: item.filter,
            posts: item.Posts,
            error: item.error,
          })),
    [
      isLoading,
      skeletonCatalog,
      homeData,
      provider.value,
      provider.source?.author,
    ],
  );

  const staged = useStagedHomeRows(rows, JSON.stringify([
    provider.source?.author, provider.source?.url, provider.value, provider.version,
  ]), !isTV, isFocused);
  const providerValue = provider?.value;
  const renderRow = useCallback(
    ({item}: {item: HomeRow}) => (
      <Slider
        isLoading={item.isLoading}
        title={item.title}
        posts={item.posts}
        filter={item.filter}
        providerValue={providerValue}
        scrollKey={item.key}
        error={item.error}
        deferPosts={item.deferPosts}
      />
    ),
    [providerValue],
  );

  const openDrawer = useCallback(() => {
    setDrawerSceneActive(true);
    setIsDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const acknowledgeNativeClose = useCallback(() => {
    // The library already animates overlay/gesture closes on the UI thread.
    // Commit controlled state in finishDrawerTransition, after that slide.
  }, []);
  const startDrawerTransition = useCallback(() => beginUIInteraction('home-drawer'), []);
  const startDrawerGesture = useCallback(() => beginUIInteraction('home-drawer-gesture'), []);
  const endDrawerGesture = useCallback(() => endUIInteraction('home-drawer-gesture'), []);

  // Memoized error message - only show if there is no cached data and an error occurred
  const errorComponent = useMemo(() => {
    if (homeData.length > 0 || isLoading || !error) {
      return null;
    }

    return (
      <View className="m-4 min-h-64 flex-1 items-center justify-center rounded-3xl bg-m3-error-container p-4">
        <AppText
          role="titleMediumEmphasized"
          className="text-center text-m3-on-error-container">
          {error?.message || 'Failed to load content'}
        </AppText>
        <AppText
          role="bodyMedium"
          className="mt-1 text-center text-m3-on-error-container">
          Pull to refresh and try again
        </AppText>
      </View>
    );
  }, [error, isLoading, homeData.length]);

  // Early return for no providers
  if (
    !installedProviders ||
    installedProviders.length === 0 ||
    !provider?.value
  ) {
    return <ScrollView contentContainerStyle={{flexGrow: 1, paddingTop: isTV ? 12 : 32}}>
      {showContinueWatching && <ContinueWatching localOnly />}
      <View style={{flex: 1, minHeight: 400}}><Tutorial /></View>
    </ScrollView>;
  }

  return (
    <QueryErrorBoundary>
      <GestureHandlerRootView style={{flex: 1}}>
        <StatusBarScrim visible={statusBarScrimVisible} />
        <View className="flex-1 bg-m3-background">
          <Drawer
            open={!isTV && isDrawerOpen}
            onOpen={openDrawer}
            onClose={acknowledgeNativeClose}
            onTransitionStart={startDrawerTransition}
            onTransitionEnd={finishDrawerTransition}
            onGestureStart={startDrawerGesture}
            onGestureEnd={endDrawerGesture}
            onGestureCancel={endDrawerGesture}
            drawerPosition="left"
            drawerType="front"
            drawerStyle={{width: 200, backgroundColor: 'transparent'}}
            swipeEdgeWidth={disableDrawer ? 0 : 70}
            swipeEnabled={!disableDrawer && !isTV}
            renderDrawerContent={() =>
              !disableDrawer && !isTV ? (
                <ProviderDrawer
                  isOpen={isDrawerOpen}
                  onSelectProvider={selectProvider}
                  onClose={closeDrawer}
                />
              ) : null
            }>
            <StatusBar style="light" />

            <FlashList
              data={staged.rows}
              onViewableItemsChanged={staged.onViewableItemsChanged}
              renderItem={renderRow}
              keyExtractor={homeRowKey}
              getItemType={homeRowType}
              drawDistance={HOME_DRAW_DISTANCE}
              maxItemsInRecyclePool={isTV ? undefined : 4}
              onScrollBeginDrag={() => beginUIInteraction('home-scroll')}
              onScrollEndDrag={() => endUIInteraction('home-scroll')}
              onMomentumScrollBegin={() => beginUIInteraction('home-momentum')}
              onMomentumScrollEnd={() => endUIInteraction('home-momentum')}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              style={{backgroundColor: colors.background}}
              contentContainerStyle={{paddingBottom: isTV ? 120 : 32}}
              refreshControl={
                <RefreshControl
                  colors={[colors.primary]}
                  tintColor={colors.primary}
                  progressBackgroundColor={colors.surfaceContainer}
                  refreshing={manualRefreshing}
                  onRefresh={handleRefresh}
                  enabled={isAtTop || manualRefreshing}
                />
              }
              ListHeaderComponent={
                <>
                  <HeroOptimized
                    isDrawerOpen={isTV ? isDrawerOpen : drawerSceneActive}
                    isVisible={heroVisible}
                    onOpenDrawer={openDrawer}
                  />
                  {showContinueWatching && <ContinueWatching />}
                </>
              }
              ListFooterComponent={
                <View className="pb-8">
                  {errorComponent}
                  <View className="h-8" />
                </View>
              }
            />
          </Drawer>

          {isTV && isDrawerOpen ? (
            <Modal
              transparent
              visible={isDrawerOpen}
              animationType="fade"
              statusBarTranslucent
              onRequestClose={() => setIsDrawerOpen(false)}>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  backgroundColor: 'rgba(0, 0, 0, 0.72)',
                }}>
                <View
                  style={{
                    width: 340,
                    height: '100%',
                    backgroundColor: '#121214',
                  }}>
                  <ProviderDrawer onClose={() => setIsDrawerOpen(false)} />
                </View>
                <Pressable
                  style={{flex: 1}}
                  onPress={() => setIsDrawerOpen(false)}
                  focusable={false}
                />
              </View>
            </Modal>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </QueryErrorBoundary>
  );
};

export default React.memo(Home);
