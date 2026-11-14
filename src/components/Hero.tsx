import {fitArtworkSize} from '../lib/artworkLayout';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useIsFocused, useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useWindowDimensions,
  AppState,
  Image,
  Modal,
  Pressable,
  View,
  findNodeHandle,
  Keyboard,
} from 'react-native';
import {extractImageAccent} from '../lib/imageAccent';
import LinearGradient from 'react-native-linear-gradient';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {HomeStackParamList} from '../App';
import {
  useArtworkShape,
  useHeroMetadata,
  useHeroRotation,
} from '../lib/hooks/useHomePageData';
import useContentStore from '../lib/zustand/contentStore';
import useHeroStore from '../lib/zustand/herostore';
import {useM3Colors} from '../theme/M3PaletteContext';
import {mixHex} from '../theme/seeds';
import {
  fetchIMDbSuggestions,
  type IMDbSuggestion,
} from '../lib/services/imdbSuggestions';
import {sanitizeSearchQuery} from '../lib/utils/helpers';
import SearchSuggestions from './search/SearchSuggestions';
import Button from './ui/Button';
import SearchField, {type SearchFieldRef} from './ui/SearchField';
import AppText from './ui/Text';
import {isTV} from '../lib/tv';
import {TVFocusable, TVFocusGuide} from './tv';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';

interface HeroProps {
  isDrawerOpen: boolean;
  isVisible?: boolean;
  onOpenDrawer: () => void;
}

const IMAGE_COLOR_FALLBACK = '#FFFFFF';

const getReadableContentColor = (backgroundColor: string) => {
  const hex = backgroundColor.replace('#', '').slice(0, 6);
  if (hex.length !== 6) {
    return '#211F1E';
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 145
    ? '#211F1E'
    : '#FFFFFF';
};

// Kept outside the component: React Compiler cannot compile a component whose
// try block contains conditional expressions.
const extractHeroAccentColor = async (
  imageUri: string,
): Promise<string | undefined> => {
  const accent = await extractImageAccent(
    imageUri,
    'shared-image-accent-v3:' + imageUri,
  );
  return accent ? mixHex(accent, '#FFFFFF', 0.72) : undefined;
};

const HERO_HEIGHT = 410;
const HERO_CONTENT_BOTTOM = 22;
const MIN_POSTER_HEIGHT = 110;

const useAppActive = () => {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return active;
};

const HeroTopButton = React.forwardRef<
  View,
  {
    disabled?: boolean;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    iconColor: string;
    label: string;
    onPress: () => void;
    nextFocusDown?: number | null;
    nextFocusLeft?: number | null;
    nextFocusRight?: number | null;
    nextFocusUp?: number | null;
    hasTVPreferredFocus?: boolean;
    onLayout?: (event: any) => void;
  }
>(
  (
    {
      disabled = false,
      icon,
      iconColor,
      label,
      onPress,
      nextFocusDown,
      nextFocusLeft,
      nextFocusRight,
      nextFocusUp,
      hasTVPreferredFocus,
      onLayout,
    },
    ref,
  ) => {
    const focusBorderColor = useTVFocusBorderColor();

    if (isTV) {
      return (
        <TVFocusable
          ref={ref}
          onLayout={onLayout}
          accessibilityLabel={label}
          accessibilityRole="button"
          disabled={disabled}
          hasTVPreferredFocus={hasTVPreferredFocus}
          nextFocusDown={nextFocusDown}
          nextFocusLeft={nextFocusLeft}
          nextFocusRight={nextFocusRight}
          nextFocusUp={nextFocusUp}
          onPress={onPress}
          borderRadius={24}
          focusScale={1.18}
          focusBorderColor={focusBorderColor}
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderRadius: 24,
            borderWidth: 1,
            height: 48,
            justifyContent: 'center',
            opacity: disabled ? 0 : 1,
            width: 48,
          }}>
          {({focused}) => (
            <MaterialCommunityIcons
              name={icon}
              size={28}
              color={focused ? '#FFFFFF' : iconColor}
            />
          )}
        </TVFocusable>
      );
    }

    return (
      <Pressable
        ref={ref as any}
        onLayout={onLayout}
        accessibilityLabel={label}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({pressed}) => ({
          alignItems: 'center',
          height: 48,
          justifyContent: 'center',
          opacity: disabled ? 0 : pressed ? 0.62 : 1,
          width: 48,
        })}>
        <MaterialCommunityIcons name={icon} size={30} color={iconColor} />
      </Pressable>
    );
  },
);

const Hero = memo(
  ({isDrawerOpen, isVisible = true, onOpenDrawer}: HeroProps) => {
    const colors = useM3Colors();
    const insets = useSafeAreaInsets();
    const [logoFailed, setLogoFailed] = useState(false);
    const [searchActive, setSearchActive] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [suggestions, setSuggestions] = useState<IMDbSuggestion[]>([]);
    const [searchButtonColor, setSearchButtonColor] = useState('#FFFFFF');
    const [loadedImageUri, setLoadedImageUri] = useState('');
    const searchFieldRef = useRef<SearchFieldRef>(null);
    const hamburgerRef = useRef<View>(null);
    const searchRef = useRef<View>(null);
    const watchNowRef = useRef<View>(null);

    const [hamburgerNode, setHamburgerNode] = useState<number | null>(null);
    const [searchNode, setSearchNode] = useState<number | null>(null);
    const [watchNowNode, setWatchNowNode] = useState<number | null>(null);

    const updateHamburgerNode = useCallback(() => {
      if (!isTV) return;
      if (hamburgerRef.current) {
        const handle = findNodeHandle(hamburgerRef.current);
        if (handle) setHamburgerNode(handle);
      }
    }, []);

    const updateSearchNode = useCallback(() => {
      if (!isTV) return;
      if (searchRef.current) {
        const handle = findNodeHandle(searchRef.current);
        if (handle) setSearchNode(handle);
      }
    }, []);

    const updateWatchNowNode = useCallback(() => {
      if (!isTV) return;
      if (watchNowRef.current) {
        const handle = findNodeHandle(watchNowRef.current);
        if (handle) setWatchNowNode(handle);
      }
    }, []);

    useEffect(() => {
      if (!isTV) return;
      const t = setTimeout(() => {
        updateHamburgerNode();
        updateSearchNode();
        updateWatchNowNode();
      }, 150);
      return () => clearTimeout(t);
    }, [
      updateHamburgerNode,
      updateSearchNode,
      updateWatchNowNode,
      isDrawerOpen,
    ]);

    const provider = useContentStore(state => state.provider);
    const heroes = useHeroStore(state => state.heroes);
    const isFocused = useIsFocused();
    const appActive = useAppActive();
    const {
      post: hero,
      activeIndex,
      readyLinks,
      step,
    } = useHeroRotation(
      heroes,
      provider.value,
      searchActive || isDrawerOpen || !isVisible || !isFocused || !appActive,
    );
    const navigation =
      useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

    // Horizontal swipe changes the hero. The artwork follows the finger a
    // little, then springs back while the next hero fades in.
    const dragX = useSharedValue(0);
    const canSwipe = !isTV && readyLinks.length > 1;
    const swipeGesture = useMemo(
      () =>
        Gesture.Pan()
          .enabled(canSwipe)
          .activeOffsetX([-15, 15])
          .failOffsetY([-12, 12])
          .onUpdate(event => {
            dragX.set(event.translationX * 0.35);
          })
          .onEnd(event => {
            const passed =
              Math.abs(event.translationX) > 60 ||
              Math.abs(event.velocityX) > 600;
            if (passed) {
              runOnJS(step)(event.translationX < 0 ? 1 : -1);
            }
            dragX.set(withSpring(0, {damping: 20, stiffness: 220}));
          })
          .onFinalize(() => {
            if (dragX.get() !== 0) {
              dragX.set(withSpring(0, {damping: 20, stiffness: 220}));
            }
          }),
      [canSwipe, dragX, step],
    );
    const dragStyle = useAnimatedStyle(() => ({
      opacity: 1 - Math.min(Math.abs(dragX.get()) / 300, 0.35),
      transform: [{translateX: dragX.get()}],
    }));
    const {data: heroData, error} = useHeroMetadata(
      hero?.link || '',
      provider.value,
    );

    const imageSource = useMemo(
      () => ({
        uri:
          heroData?.background ||
          heroData?.image ||
          heroData?.poster ||
          hero?.image ||
          '',
      }),
      [hero?.image, heroData],
    );
    const imageUri = imageSource.uri;
    // Posters and small images are shown blurred instead of stretched sharp.
    // The image is drawn once its size is known, so it never jumps from sharp
    // to blurred.
    const {ready: artworkReady, posterLike, aspectRatio} = useArtworkShape(imageUri);
    const {width: viewportWidth} = useWindowDimensions();
    // The title block waits for the same measurement, so it appears once at
    // its final size instead of shrinking when poster mode kicks in.
    const textReady = !imageUri || artworkReady;
    // The poster fills the space between the top buttons and the title block.
    // It is left out when that space is too small to show it well.
    const [contentHeight, setContentHeight] = useState(0);
    // Poster mode also uses a smaller logo and title to leave it more room.
    const posterTop = insets.top + 8;
    const posterBottom = HERO_CONTENT_BOTTOM + contentHeight + 10;
    const posterSize = fitArtworkSize(aspectRatio ?? 2 / 3, viewportWidth - 48,
      Math.max(0, HERO_HEIGHT - posterTop - posterBottom));
    const showPoster =
      posterLike &&
      contentHeight > 0 &&
      HERO_HEIGHT - posterTop - posterBottom >= MIN_POSTER_HEIGHT;

    useEffect(() => {
      setSearchButtonColor(IMAGE_COLOR_FALLBACK);
    }, [hero?.link]);

    useEffect(() => {
      setLogoFailed(false);
    }, [heroData?.logo]);

    useEffect(() => {
      if (!searchActive) {
        return;
      }
      const frame = requestAnimationFrame(() =>
        searchFieldRef.current?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }, [searchActive]);

    const suppressSuggestionsRef = useRef(false);

    const handleTextChange = useCallback((text: string) => {
      suppressSuggestionsRef.current = false;
      setSearchText(text);
    }, []);

    const submitProviderSearch = useCallback(
      (value: string) => {
        Keyboard.dismiss();
        const query = value.trim();
        if (!query) {
          return;
        }
        setSearchActive(false);
        setSearchText('');
        setSuggestions([]);
        if (/^https?:\/\//i.test(query)) {
          navigation.navigate('Info', {
            link: query,
            provider: provider.value,
          });
          return;
        }
        navigation.navigate('ScrollList', {
          providerValue: provider.value,
          filter: query,
          title: provider.display_name,
          isSearch: true,
        });
      },
      [navigation, provider.display_name, provider.value],
    );

    const handleSelectSuggestion = useCallback(
      (title: string) => {
        const cleanTitle = sanitizeSearchQuery(title);
        Keyboard.dismiss();
        suppressSuggestionsRef.current = true;
        setSuggestions([]);
        setSearchText(cleanTitle);
        submitProviderSearch(cleanTitle);
      },
      [submitProviderSearch],
    );

    // Fill the field for editing; suggestions refresh for the new text.
    const handleFillSuggestion = useCallback((title: string) => {
      setSearchText(sanitizeSearchQuery(title));
    }, []);

    // Debounced IMDb search suggestions for home page search. The timer lives in
    // the effect so the component stays compatible with React Compiler.
    useEffect(() => {
      if (!searchActive || searchText.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      let cancelled = false;
      const timer = setTimeout(async () => {
        if (suppressSuggestionsRef.current) {
          setSuggestions([]);
          return;
        }
        const results = await fetchIMDbSuggestions(searchText.trim());
        if (!cancelled) {
          setSuggestions(results);
        }
      }, 250);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [searchText, searchActive]);

    const updateSearchButtonColor = useCallback(
      () => setLoadedImageUri(imageUri || ''),
      [imageUri],
    );
    useEffect(() => {
      if (
        !isVisible ||
        isDrawerOpen ||
        !isFocused ||
        !appActive ||
        !imageUri ||
        loadedImageUri !== imageUri
      )
        return;
      let cancelled = false;
      extractHeroAccentColor(imageUri).then(accent => {
        if (!cancelled && accent) setSearchButtonColor(accent);
      });
      return () => {
        cancelled = true;
      };
    }, [
      imageUri,
      loadedImageUri,
      isVisible,
      isDrawerOpen,
      isFocused,
      appActive,
    ]);
    const genres = useMemo(
      // Poster mode keeps genres to one short row to leave the poster room.
      () =>
        (heroData?.genre || heroData?.tags || []).slice(0, posterLike ? 2 : 3),
      [heroData, posterLike],
    );
    const openDetails = useCallback(() => {
      if (!hero?.link) {
        return;
      }
      navigation.navigate('Info', {
        link: hero.link,
        provider: provider.value,
        poster: heroData?.poster || heroData?.image || heroData?.background,
      });
    }, [hero, heroData, navigation, provider.value]);

    return (
      <GestureDetector gesture={swipeGesture}>
        <View
          style={{
            backgroundColor: colors.surfaceContainerLow,
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
            height: HERO_HEIGHT,
            overflow: 'hidden',
          }}>
          <Animated.View style={[{position: 'absolute', inset: 0}, dragStyle]}>
            {!imageUri ? (
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surfaceContainerHighest,
                }}
              />
            ) : !artworkReady ? (
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surfaceContainerHighest,
                }}
              />
            ) : (
              <Animated.Image
                key={imageUri}
                entering={FadeIn.duration(450)}
                source={imageSource}
                onLoad={updateSearchButtonColor}
                resizeMode="cover"
                resizeMethod="resize"
                // A tall cover crop otherwise retains full-HD landscape bitmaps.
                // Bound the phone background upload; the foreground stays sharp.
                // Supported by the native Image view; missing from this TV fork's TS props.
                {...{resizeMultiplier: isTV ? 1 : 0.5}}
                blurRadius={posterLike ? (isTV ? 18 : 6) : 0}
                style={{
                  height: '100%',
                  opacity: posterLike ? 0.75 : 1,
                  width: '100%',
                }}
              />
            )}
          </Animated.View>

          <LinearGradient
            colors={[
              'rgba(0,0,0,0.2)',
              'rgba(0,0,0,0.08)',
              'rgba(0,0,0,0.72)',
              colors.background,
            ]}
            locations={[0, 0.28, 0.7, 1]}
            style={{position: 'absolute', inset: 0}}
          />
          {showPoster ? (
            // The sharp poster sits over its blurred copy, between the top
            // buttons and the title block, never behind the text.
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  alignItems: 'center',
                  justifyContent: 'center',
                  bottom: posterBottom,
                  left: 0,
                  position: 'absolute',
                  right: 0,
                  top: posterTop,
                },
                dragStyle,
              ]}>
              <Animated.View
                key={`poster-${imageUri}`}
                entering={FadeIn.duration(450)}
                style={{
                  width: posterSize.width,
                  height: posterSize.height,
                  borderRadius: 12,
                  elevation: 12,
                  overflow: 'hidden',
                }}>
                <Image
                  source={imageSource}
                  resizeMode="contain"
                  resizeMethod="resize"
                  style={{height: '100%', width: '100%'}}
                />
              </Animated.View>
            </Animated.View>
          ) : null}

          <TVFocusGuide
            trapFocusUp={true}
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'space-between',
              left: isTV ? 24 : 16,
              position: 'absolute',
              right: isTV ? 48 : 16,
              top: insets.top + (isTV ? 16 : 6),
              zIndex: 30,
            }}>
            <HeroTopButton
              ref={hamburgerRef}
              onLayout={updateHamburgerNode}
              icon="menu"
              iconColor={searchButtonColor}
              label="Open provider drawer"
              disabled={isDrawerOpen}
              hasTVPreferredFocus={isTV && !isDrawerOpen}
              nextFocusRight={searchNode ?? undefined}
              nextFocusDown={watchNowNode ?? undefined}
              nextFocusUp={hamburgerNode ?? undefined}
              onPress={onOpenDrawer}
            />
            <HeroTopButton
              ref={searchRef}
              onLayout={updateSearchNode}
              icon="magnify"
              iconColor={searchButtonColor}
              label={`Search in ${provider.display_name}`}
              nextFocusLeft={hamburgerNode ?? undefined}
              nextFocusRight={searchNode ?? undefined}
              nextFocusDown={watchNowNode ?? undefined}
              nextFocusUp={searchNode ?? undefined}
              onPress={() => setSearchActive(true)}
            />
          </TVFocusGuide>

          <Animated.View
            entering={FadeInDown.delay(100)
              .springify()
              .damping(18)
              .stiffness(180)}
            onLayout={event =>
              setContentHeight(event.nativeEvent.layout.height)
            }
            style={{
              alignItems: 'center',
              bottom: HERO_CONTENT_BOTTOM,
              left: 20,
              position: 'absolute',
              right: 20,
            }}>
            {textReady ? (
              <Animated.View
                key={hero?.link || 'empty'}
                entering={FadeIn.duration(350)}
                style={{alignItems: 'center', width: '100%'}}>
                {heroData?.logo && !logoFailed ? (
                  <Image
                    source={{uri: heroData.logo}}
                    onError={() => setLogoFailed(true)}
                    resizeMode="contain"
                    resizeMethod="resize"
                    style={
                      posterLike
                        ? {height: 60, width: 210}
                        : {height: 94, width: 280}
                    }
                  />
                ) : heroData?.title || hero?.title ? (
                  <AppText
                    numberOfLines={posterLike ? 1 : 2}
                    role={posterLike ? 'titleLargeEmphasized' : 'headlineLarge'}
                    style={{
                      color: '#FFFFFF',
                      maxWidth: 300,
                      textAlign: 'center',
                    }}>
                    {heroData?.title || hero?.title}
                  </AppText>
                ) : null}

                {genres.length > 0 ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 8,
                      justifyContent: 'center',
                      marginTop: posterLike ? 6 : 10,
                    }}>
                    {genres.map((genre: string) => (
                      <View
                        key={genre}
                        style={{
                          backgroundColor: 'rgba(32, 28, 28, 0.82)',
                          borderColor: 'rgba(255,255,255,0.24)',
                          borderRadius: 12,
                          borderWidth: 1,
                          paddingHorizontal: posterLike ? 8 : 10,
                          paddingVertical: posterLike ? 3 : 6,
                        }}>
                        <AppText
                          role={
                            posterLike
                              ? 'labelSmallEmphasized'
                              : 'labelMediumEmphasized'
                          }
                          style={{color: '#FFFFFF'}}>
                          {genre}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Animated.View>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: posterLike ? 10 : 14,
                width: '100%',
              }}>
              <Button
                ref={watchNowRef}
                onLayout={updateWatchNowNode}
                variant="filled"
                containerColor={searchButtonColor}
                contentColor={getReadableContentColor(searchButtonColor)}
                nextFocusUp={hamburgerNode ?? undefined}
                onPress={openDetails}>
                Watch now
              </Button>
            </View>
            {error && !heroData ? (
              <AppText
                role="bodySmall"
                style={{
                  color: colors.onSurfaceVariant,
                  marginTop: 10,
                  textAlign: 'center',
                }}>
                Some featured details are unavailable
              </AppText>
            ) : null}
          </Animated.View>
          {/* The dots sit below the title block so they never take space from
            the poster. */}
          {readyLinks.length > 1 ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                alignSelf: 'center',
                bottom: 9,
                flexDirection: 'row',
                gap: 6,
                position: 'absolute',
              }}>
              {heroes.map((post, index) =>
                readyLinks.includes(post.link) ? (
                  <View
                    key={post.link}
                    style={{
                      backgroundColor:
                        index === activeIndex
                          ? '#FFFFFF'
                          : 'rgba(255,255,255,0.4)',
                      borderRadius: 3,
                      height: 6,
                      width: index === activeIndex ? 18 : 6,
                    }}
                  />
                ) : null,
              )}
            </View>
          ) : null}

          {/* Full-screen Search Overlay with Auto-completion Suggestions */}
          <Modal
            visible={searchActive}
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => {
              setSearchActive(false);
              setSearchText('');
              setSuggestions([]);
            }}>
            <SafeAreaView
              style={{flex: 1, backgroundColor: colors.background}}
              edges={['top', 'left', 'right']}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingTop: 8,
                  paddingBottom: 10,
                  gap: 8,
                }}>
                {isTV ? (
                  <TVFocusable
                    accessibilityLabel="Close search"
                    accessibilityRole="button"
                    hasTVPreferredFocus={true}
                    borderRadius={22}
                    focusScale={1.1}
                    onPress={() => {
                      setSearchActive(false);
                      setSearchText('');
                      setSuggestions([]);
                    }}
                    style={{
                      alignItems: 'center',
                      borderRadius: 22,
                      height: 44,
                      justifyContent: 'center',
                      width: 44,
                    }}>
                    <MaterialCommunityIcons
                      name="arrow-left"
                      size={26}
                      color={colors.onSurface}
                    />
                  </TVFocusable>
                ) : (
                  <Pressable
                    accessibilityLabel="Close search"
                    accessibilityRole="button"
                    onPress={() => {
                      setSearchActive(false);
                      setSearchText('');
                      setSuggestions([]);
                    }}
                    style={({pressed}) => ({
                      alignItems: 'center',
                      height: 48,
                      justifyContent: 'center',
                      opacity: pressed ? 0.62 : 1,
                      width: 44,
                    })}>
                    <MaterialCommunityIcons
                      name="arrow-left"
                      size={26}
                      color={colors.onSurface}
                    />
                  </Pressable>
                )}

                <View style={{flex: 1}}>
                  <SearchField
                    ref={searchFieldRef}
                    value={searchText}
                    onChangeText={handleTextChange}
                    onSubmit={submitProviderSearch}
                    onClear={() => {
                      suppressSuggestionsRef.current = false;
                      setSearchText('');
                      setSuggestions([]);
                    }}
                    placeholder={`Search in ${provider.display_name}...`}
                  />
                </View>

                {isTV && searchText.length > 0 && (
                  <Pressable
                    accessibilityLabel="Clear search"
                    accessibilityRole="button"
                    onPress={() => {
                      suppressSuggestionsRef.current = false;
                      setSearchText('');
                      setSuggestions([]);
                    }}
                    style={({pressed}) => ({
                      alignItems: 'center',
                      height: 48,
                      justifyContent: 'center',
                      opacity: pressed ? 0.62 : 1,
                      width: 36,
                    })}>
                    <MaterialCommunityIcons
                      name="close"
                      size={22}
                      color={colors.onSurfaceVariant}
                    />
                  </Pressable>
                )}
              </View>

              {/* Real-time Search Suggestions */}
              <View style={{flex: 1}}>
                <SearchSuggestions
                  suggestions={suggestions}
                  onSelectSuggestion={handleSelectSuggestion}
                  onFillSuggestion={handleFillSuggestion}
                />
              </View>
            </SafeAreaView>
          </Modal>
        </View>
      </GestureDetector>
    );
  },
);

Hero.displayName = 'Hero';

export default Hero;
