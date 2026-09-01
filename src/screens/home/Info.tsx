import {useNavigation} from '@react-navigation/native';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {StatusBar} from 'expo-status-bar';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, RefreshControl, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {HomeStackParamList, TabStackParamList} from '../../App';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {QueryErrorBoundary} from '../../components/ErrorBoundary';
import SeasonList from '../../components/SeasonList';
import SkeletonLoader from '../../components/Skeleton';
import {useContentDetails} from '../../lib/hooks/useContentInfo';
import {extractImageAccent, getCachedImageAccent} from '../../lib/imageAccent';
import type {Link} from '../../lib/providers/types';
import {settingsStorage, watchListStorage} from '../../lib/storage';
import useContentStore from '../../lib/zustand/contentStore';
import useWatchListStore from '../../lib/zustand/watchListStore';
import {M3PaletteContext, useM3Colors} from '../../theme/M3PaletteContext';
import type {MaterialColors} from '../../theme/colors';
import {mixHex} from '../../theme/seeds';
import ContentOverview from './components/ContentOverview';
import InfoStoryModal from './components/InfoStoryModal';
import InfoSkeleton from './components/InfoSkeleton';
import StatusBarScrim from '../../components/ui/StatusBarScrim';

type Props = NativeStackScreenProps<HomeStackParamList, 'Info'>;

export default function Info({route, navigation}: Props): React.JSX.Element {
  const colors = useM3Colors();
  const searchNavigation =
    useNavigation<NativeStackNavigationProp<TabStackParamList>>();
  const provider = useContentStore(state => state.provider);
  const installedProviders = useContentStore(state => state.installedProviders);
  const addItem = useWatchListStore(state => state.addItem);
  const removeItem = useWatchListStore(state => state.removeItem);
  const providerValue = route.params.provider || provider.value;
  const {
    info,
    meta,
    isLoading,
    isRefetching,
    isSynopsisLoading,
    error,
    refetch,
  } = useContentDetails(route.params.link, providerValue);
  const [inLibrary, setInLibrary] = useState(() =>
    watchListStorage.isInWatchList(route.params.link),
  );
  const [readMore, setReadMore] = useState(false);
  const [storyVisible, setStoryVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const initialPoster = route.params.poster;
  const initialCacheKey = initialPoster
    ? `detail-bg-accent-v1:${initialPoster}`
    : '';
  const cachedInitialAccent = initialCacheKey
    ? getCachedImageAccent(initialCacheKey)
    : undefined;

  const [imageAccent, setImageAccent] = useState<string | undefined>(
    () => cachedInitialAccent,
  );
  const [initialAccentReady, setInitialAccentReady] = useState(
    () =>
      !settingsStorage.isDynamicInfoAccentEnabled() ||
      !route.params.poster ||
      !!cachedInitialAccent,
  );
  const imageAccentRequest = useRef(0);
  const [statusBarScrimVisible, setStatusBarScrimVisible] = useState(false);
  const dynamicInfoAccentEnabled = settingsStorage.isDynamicInfoAccentEnabled();
  const contentProviderName = useMemo(
    () =>
      installedProviders.find(item => item.value === providerValue)
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
  const accentBackground =
    meta?.background || info?.image || route.params.poster;
  const backgroundImage =
    meta?.background ||
    info?.image ||
    'https://placehold.jp/24/363636/ffffff/900x1200.png?text=Vega';

  useEffect(() => {
    if (!dynamicInfoAccentEnabled) {
      imageAccentRequest.current += 1;
      setImageAccent(undefined);
      setInitialAccentReady(true);
      return;
    }
    const bg = accentBackground;
    if (!bg) {
      setInitialAccentReady(true);
      return;
    }
    const request = ++imageAccentRequest.current;
    extractImageAccent(bg, `detail-bg-accent-v1:${bg}`).then(
      extractedColor => {
        if (request !== imageAccentRequest.current) {
          return;
        }
        if (extractedColor) {
          setImageAccent(extractedColor);
        }
        setInitialAccentReady(true);
      },
    );
  }, [accentBackground, dynamicInfoAccentEnabled]);

  const detailColors = useMemo<MaterialColors>(() => {
    if (!imageAccent) {
      return colors;
    }
    const paleAccent = mixHex(imageAccent, '#FFFFFF', 0.72);
    const darkContent = '#171717' as const;
    const tintedSurface = (base: string, amount: number) =>
      mixHex(base, imageAccent, amount);
    return {
      ...colors,
      primary: paleAccent,
      onPrimary: darkContent,
      primaryContainer: paleAccent,
      onPrimaryContainer: darkContent,
      secondary: mixHex(imageAccent, '#FFFFFF', 0.66),
      onSecondary: darkContent,
      secondaryContainer: mixHex(imageAccent, '#FFFFFF', 0.78),
      onSecondaryContainer: darkContent,
      tertiary: mixHex(imageAccent, '#FFFFFF', 0.62),
      onTertiary: darkContent,
      tertiaryContainer: mixHex(imageAccent, '#FFFFFF', 0.8),
      onTertiaryContainer: darkContent,
      surfaceTint: paleAccent,
      background: mixHex(imageAccent, '#000000', 0.96),
      surface: tintedSurface('#171717', 0.08),
      surfaceDim: tintedSurface('#141414', 0.06),
      surfaceContainerLowest: tintedSurface('#101010', 0.05),
      surfaceContainerLow: tintedSurface('#1B1B1B', 0.1),
      surfaceContainer: tintedSurface('#222222', 0.12),
      surfaceContainerHigh: tintedSurface('#2A2A2A', 0.14),
      surfaceContainerHighest: tintedSurface('#343434', 0.16),
      surfaceBright: tintedSurface('#3D3D3D', 0.18),
      surfaceVariant: tintedSurface('#303030', 0.14),
      outline: mixHex(imageAccent, '#FFFFFF', 0.48),
      outlineVariant: tintedSurface('#5A5A5A', 0.18),
    };
  }, [colors, imageAccent]);

  const webUrl = info?.webUrl?.trim();
  const filteredLinkList = useMemo(() => {
    if (!info?.linkList) {
      return [];
    }
    const excludedQualities = settingsStorage.getExcludedQualities();
    const filtered = info.linkList.filter(
      (item: Link) =>
        !item.quality || !excludedQualities.includes(item.quality),
    );
    return filtered.length > 0 ? filtered : info.linkList;
  }, [info?.linkList]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshVersion(version => version + 1);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleScroll = useCallback((event: any) => {
    setStatusBarScrimVisible(event.nativeEvent.contentOffset.y > 12);
  }, []);

  const toggleLibrary = useCallback(() => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    if (inLibrary) {
      removeItem(route.params.link);
      setInLibrary(false);
      return;
    }
    addItem({
      title: displayTitle,
      poster: posterImage,
      link: route.params.link,
      provider: providerValue,
    });
    setInLibrary(true);
  }, [
    addItem,
    displayTitle,
    inLibrary,
    posterImage,
    providerValue,
    removeItem,
    route.params.link,
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
          <StatusBarScrim visible={statusBarScrimVisible} />
          <StatusBar style="light" />
          <FlatList
            data={[]}
            keyExtractor={(_, index) => String(index)}
            renderItem={() => null}
            ListHeaderComponent={
              <>
                <ContentOverview
                  backgroundImage={backgroundImage}
                  genres={meta?.genres}
                  inLibrary={inLibrary}
                  isLoading={isLoading && !info}
                  logo={displayLogo}
                  onBack={navigation.goBack}
                  onOpenStory={
                    info?.tmdbId || info?.imdbId
                      ? () => setStoryVisible(true)
                      : undefined
                  }
                  onOpenWeb={
                    webUrl
                      ? () => navigation.navigate('Webview', {link: webUrl})
                      : undefined
                  }
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
                <View style={{paddingHorizontal: 18, paddingTop: 24}}>
                  {isLoading && !info ? (
                    <View style={{gap: 12}}>
                      <SkeletonLoader show height={28} width={120} />
                      <SkeletonLoader show height={72} width="100%" />
                    </View>
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
            ListFooterComponent={<View style={{height: 110}} />}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                colors={[detailColors.primary]}
                progressBackgroundColor={detailColors.surfaceContainer}
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }
          />
          <InfoStoryModal
            fallbackBackdrop={backgroundImage}
            fallbackOverview={synopsis}
            fallbackTitle={displayTitle}
            imdbId={info?.imdbId}
            onClose={() => setStoryVisible(false)}
            tmdbId={info?.tmdbId}
            type={info?.type}
            visible={storyVisible}
          />
        </View>
      </M3PaletteContext.Provider>
    </QueryErrorBoundary>
  );
}
