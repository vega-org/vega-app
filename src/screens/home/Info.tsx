import {useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {StatusBar} from 'expo-status-bar';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  ToastAndroid,
  UIManager,
  View,
  findNodeHandle,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {HomeStackParamList, TabStackParamList} from '../../App';
import {isSafeExternalUrl} from '../../lib/sandbox/urlGuard';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {QueryErrorBoundary} from '../../components/ErrorBoundary';
import SeasonList from '../../components/SeasonList';
import ScreenOverlayHost from '../../components/ScreenOverlayHost';
import LocalEpisodeList from '../../components/local-content/LocalEpisodeList';
import SkeletonLoader from '../../components/Skeleton';
import {useContentDetails} from '../../lib/hooks/useContentInfo';
import {useArtworkShape} from '../../lib/hooks/useHomePageData';
import {useInfoAccent} from '../../lib/hooks/useInfoAccent';
import type {Link} from '../../lib/providers/types';
import {settingsStorage} from '../../lib/storage';
import useContentStore from '../../lib/zustand/contentStore';
import useWatchListStore from '../../lib/zustand/watchListStore';
import {M3PaletteContext, useM3Colors} from '../../theme/M3PaletteContext';
import type {MaterialColors} from '../../theme/colors';
import {buildDetailPalette} from '../../theme/detailPalette';
import ContentOverview from './components/ContentOverview';
import InfoStoryModal from './components/InfoStoryModal';
import LibraryCollectionDialog from '../../components/library/LibraryCollectionDialog';
import ProviderMetadataDialog from '../../components/metadata/ProviderMetadataDialog';
import LocalMetadataDialog from '../../components/metadata/LocalMetadataDialog';
import InfoSkeleton from './components/InfoSkeleton';
import StatusBarScrim from '../../components/ui/StatusBarScrim';
import {TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import useTVNavigationStore from '../../lib/zustand/tvNavigationStore';

type Props = NativeStackScreenProps<HomeStackParamList, 'Info'>;

export default function Info({route, navigation}: Props): React.JSX.Element {
  const colors = useM3Colors();
  const searchNavigation =
    useNavigation<NativeStackNavigationProp<TabStackParamList>>();
  const provider = useContentStore(state => state.provider);
  const installedProviders = useContentStore(state => state.installedProviders);
  const setItemCollections = useWatchListStore(
    state => state.setItemCollections,
  );
  const removeItem = useWatchListStore(state => state.removeItem);
  // Id of the only category, or undefined when there are none or several.
  const onlyCollectionId = useWatchListStore(state =>
    state.collections.length === 1 ? state.collections[0].id : undefined,
  );
  const providerValue = route.params.provider || provider.value;
  const {
    info,
    meta,
    isLoading,
    isMetaLoading,
    isSynopsisLoading,
    error,
    refetch,
    localTitle,
  } = useContentDetails(route.params.link, providerValue);
  const remoteInLibrary = useWatchListStore(state =>
    state.watchList.some(item => item.link === route.params.link),
  );
  const inLibrary = localTitle ? localTitle.inLibrary !== false : remoteInLibrary;
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [metadataMenuVisible, setMetadataMenuVisible] = useState(false);
  const [readMore, setReadMore] = useState(false);
  const [storyVisible, setStoryVisible] = useState(false);
  const screenFocused = useIsFocused();
  const backButtonRef = useRef<View>(null);
  const registerBackFocus = useCallback(() => {
    if (!isTV || !screenFocused) return;
    const handle = findNodeHandle(backButtonRef.current);
    if (handle) useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
  }, [screenFocused]);

  useFocusEffect(useCallback(() => {
    if (!isTV) return;
    // The back button takes first focus through hasTVPreferredFocus. On return
    // from Player, the focused episode restores itself, so do not move focus.
    return () => {
      const handle = findNodeHandle(backButtonRef.current);
      const store = useTVNavigationStore.getState();
      if (handle && store.activeScreenFocusHandle === handle) {
        store.setActiveScreenFocusHandle(null);
      }
    };
  }, []));
  const exploreRef = useRef<View>(null);
  const closeStory = useCallback(() => {
    setStoryVisible(false);
    if (isTV) {
      setTimeout(() => {
        const handle = findNodeHandle(exploreRef.current);
        if (handle) {
          UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
        }
      }, 100);
    }
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isAtTop, setIsAtTop] = useState(true);
  const [statusBarScrimVisible, setStatusBarScrimVisible] = useState(false);
  const dynamicInfoAccentEnabled = settingsStorage.isDynamicInfoAccentEnabled();
  const {accent: imageAccent, ready: initialAccentReady} = useInfoAccent({
    poster: route.params.poster,
    background: isMetaLoading ? undefined : meta?.background || info?.image,
    pageKey: JSON.stringify([providerValue, route.params.link]),
    enabled: dynamicInfoAccentEnabled,
  });
  const contentProviderName = useMemo(
    () =>
      providerValue === 'local' ? 'Local content' : installedProviders.find(item => item.value === providerValue)
        ?.display_name || providerValue,
    [installedProviders, providerValue],
  );

  const displayTitle = meta?.name || info?.title;
  const displayLogo = meta?.logo || info?.logo;
  const synopsis =
    meta?.description || info?.synopsis || 'No synopsis available';
  const posterImage =
    info?.poster ||
    meta?.poster ||
    route.params.poster ||
    info?.image ||
    'https://placehold.jp/24/363636/ffffff/500x750.png?text=Vega';
  const backgroundImage =
    meta?.background ||
    info?.image ||
    'https://placehold.jp/24/363636/ffffff/900x1200.png?text=Vega';
  // Posters and small images are blurred behind the page, with the sharp
  // poster shown in the header instead of stretched across it.
  const {ready: backdropReady, posterLike: backdropPosterLike} =
    useArtworkShape(backgroundImage);

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        navigation.goBack();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [navigation]),
  );

  const detailColors = useMemo<MaterialColors>(
    () => (imageAccent ? buildDetailPalette(colors, imageAccent) : colors),
    [colors, imageAccent],
  );

  const webUrl = info?.webUrl?.trim();
  const linkList = info?.linkList;
  const filteredLinkList = useMemo(() => {
    if (!linkList) {
      return [];
    }
    const excludedQualities = settingsStorage.getExcludedQualities();
    const filtered = linkList.filter(
      (item: Link) =>
        !item.quality || !excludedQualities.includes(item.quality),
    );
    return filtered.length > 0 ? filtered : linkList;
  }, [linkList]);

  // Promise chain instead of try/finally: React Compiler skips any component
  // that contains a finally clause.
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshVersion(version => version + 1);
    return Promise.race([
      refetch(),
      new Promise(resolve => setTimeout(resolve, 10000)),
    ]).catch(cause => {
      ToastAndroid.show(cause instanceof Error ? cause.message : 'Unable to refresh this title', ToastAndroid.LONG);
    }).finally(() => {
      setTimeout(() => {
        setRefreshing(false);
      }, 50);
    });
  }, [refetch]);

  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent?.contentOffset?.y ?? 0;
    setStatusBarScrimVisible(offsetY > 12);
    setIsAtTop(offsetY <= 0);
  }, []);

  const toggleLibrary = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    // With one category, save to it or remove directly. With none or several,
    // ask where to save.
    if (localTitle || !onlyCollectionId) {
      setCollectionPickerVisible(true);
      return;
    }
    if (inLibrary) {
      removeItem(route.params.link);
      return;
    }
    setItemCollections(
      {
        title: displayTitle,
        poster: posterImage,
        link: route.params.link,
        provider: providerValue,
      },
      [onlyCollectionId],
    );
  }, [
    displayTitle,
    localTitle,
    inLibrary,
    onlyCollectionId,
    posterImage,
    providerValue,
    removeItem,
    route.params.link,
    setItemCollections,
  ]);

  const searchTitle = useCallback(() => {
    if (!displayTitle) {
      return;
    }
    searchNavigation.navigate('SearchStack', {
      screen: 'SearchResults',
      params: {filter: displayTitle},
    } as never);
  }, [displayTitle, searchNavigation]);

  const handleOpenWeb = useCallback(() => {
    if (!webUrl) {
      return;
    }
    if (settingsStorage.isSkipInAppWebview()) {
      if (!isSafeExternalUrl(webUrl)) {
        ToastAndroid.show('Unsupported link', ToastAndroid.SHORT);
        return;
      }
      Linking.openURL(webUrl).catch(() => {
        ToastAndroid.show('Failed to open browser', ToastAndroid.SHORT);
      });
    } else {
      navigation.navigate('Webview', {link: webUrl});
    }
  }, [navigation, webUrl]);

  if (error && !info) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: 'center',
          padding: 24,
        }}>
        <StatusBar style="light" />
        <AppText
          role="headlineSmallEmphasized"
          style={{color: colors.error, textAlign: 'center'}}>
          Failed to load content
        </AppText>
        <AppText
          role="bodyMedium"
          style={{
            color: colors.onSurfaceVariant,
            marginTop: 8,
            textAlign: 'center',
          }}>
          {error.message || 'An unexpected error occurred'}
        </AppText>
        <View style={{flexDirection: 'row', gap: 10, marginTop: 22}}>
          <Button variant="destructive" onPress={handleRefresh}>
            Try again
          </Button>
          <Button variant="tonal" onPress={navigation.goBack}>
            Go back
          </Button>
        </View>
      </View>
    );
  }

  const isContentLoading =
    !info || (dynamicInfoAccentEnabled && !initialAccentReady);
  if (isContentLoading) {
    return (
      <View style={{backgroundColor: '#000000', flex: 1}}>
        <StatusBar style="light" />
        <InfoSkeleton onBack={navigation.goBack} />
      </View>
    );
  }

  return (
    <QueryErrorBoundary>
      <M3PaletteContext.Provider value={detailColors}>
        <View style={{backgroundColor: detailColors.background, flex: 1}}>
          <View
            pointerEvents="none"
            style={{
              height: 340,
              left: 0,
              position: 'absolute',
              right: 0,
              top: 0,
            }}>
            {backdropReady ? (
              <Image
                source={{uri: backgroundImage}}
                resizeMode="cover"
                resizeMethod="resize"
                blurRadius={backdropPosterLike ? 18 : 0}
                style={{
                  height: 340,
                  opacity: backdropPosterLike ? 0.75 : 1,
                  width: '100%',
                }}
              />
            ) : null}
          </View>
          <StatusBarScrim visible={statusBarScrimVisible} />
          <StatusBar style="light" />
          <TVFocusGuide autoFocus={true} trapFocusDown={true} trapFocusRight={true} style={{flex: 1}}>
          <ScreenOverlayHost>
          <FlatList
            style={{backgroundColor: 'transparent'}}
            data={[]}
            keyExtractor={(_, index) => String(index)}
            renderItem={() => null}
            ListHeaderComponent={
              <>
                <ContentOverview
                  backgroundImage={backgroundImage}
                  headerPoster={backdropPosterLike ? backgroundImage : undefined}
                  genres={meta?.genres}
                  inLibrary={inLibrary}
                  isLoading={isLoading && !info}
                  logo={displayLogo}
                  onBack={navigation.goBack}
                  onOpenMenu={() => setMetadataMenuVisible(true)}
                  backButtonRef={backButtonRef}
                  onBackButtonLayout={registerBackFocus}
                  onOpenStory={
                    info?.tmdbId || info?.imdbId
                      ? () => setStoryVisible(true)
                      : undefined
                  }
                  exploreRef={exploreRef}
                  onOpenWeb={webUrl ? handleOpenWeb : undefined}
                  onSearchTitle={searchTitle}
                  onToggleLibrary={toggleLibrary}
                  onToggleSynopsis={() => setReadMore(value => !value)}
                  providerName={contentProviderName}
                  rating={meta?.imdbRating || info?.rating}
                  readMore={readMore}
                  runtime={meta?.runtime}
                  synopsis={synopsis}
                  synopsisLoading={isSynopsisLoading}
                  tags={info?.tags}
                  title={displayTitle}
                  trailerUrl={info?.trailerUrl?.trim()}
                  year={meta?.year}
                />
                <View
                  style={{
                    backgroundColor: detailColors.background,
                    paddingHorizontal: 18,
                    paddingTop: 24,
                  }}>
                  {isLoading && !info ? (
                    <View style={{gap: 12}}>
                      <SkeletonLoader show height={28} width={120} />
                      <SkeletonLoader show height={72} width="100%" />
                    </View>
                  ) : localTitle ? (
                    <LocalEpisodeList title={localTitle} />
                  ) : (
                    <SeasonList
                      refreshing={refreshing}
                      refreshVersion={refreshVersion}
                      providerValue={providerValue}
                      LinkList={filteredLinkList}
                      poster={{
                        logo: displayLogo,
                        poster: posterImage,
                        background: backgroundImage,
                      }}
                      type={info?.type || 'series'}
                      metaTitle={displayTitle}
                      imdbId={info?.imdbId}
                      synopsis={synopsis}
                      routeParams={route.params}
                      quickDownload={info?.quickDownload}
                    />
                  )}
                </View>
              </>
            }
            ListFooterComponent={
              <View
                style={{
                  backgroundColor: detailColors.background,
                  height: 110,
                }}
              />
            }
            onScroll={handleScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                colors={[detailColors.primary]}
                progressBackgroundColor={detailColors.surfaceContainer}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                enabled={isAtTop || refreshing}
              />
            }
          />
          </ScreenOverlayHost>
          </TVFocusGuide>
          <InfoStoryModal
            fallbackBackdrop={backgroundImage}
            fallbackOverview={synopsis}
            fallbackTitle={displayTitle}
            imdbId={info?.imdbId}
            onClose={closeStory}
            tmdbId={info?.tmdbId}
            type={info?.type}
            visible={storyVisible}
          />
          <LibraryCollectionDialog
            visible={collectionPickerVisible}
            onClose={() => setCollectionPickerVisible(false)}
            item={{
              title: displayTitle,
              poster: posterImage,
              link: route.params.link,
              provider: providerValue,
            }}
          />
          {localTitle && <LocalMetadataDialog
            visible={metadataMenuVisible}
            onClose={() => setMetadataMenuVisible(false)}
            title={localTitle}
          />}
          {info && !localTitle && <ProviderMetadataDialog
            visible={metadataMenuVisible}
            onClose={() => setMetadataMenuVisible(false)}
            info={info}
            provider={providerValue}
            link={route.params.link}
          />}
        </View>
      </M3PaletteContext.Provider>
    </QueryErrorBoundary>
  );
}
