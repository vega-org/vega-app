import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useMemo, useState} from 'react';
import {Image, Linking, View, findNodeHandle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import SkeletonLoader from '../../../components/Skeleton';
import AppText from '../../../components/ui/Text';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {isTV} from '../../../lib/tv';
import useTVNavigationStore from '../../../lib/zustand/tvNavigationStore';

interface ContentOverviewProps {
  backgroundImage?: string;
  /** Sharp poster drawn in the header when the backdrop is a poster. */
  headerPoster?: string;
  genres?: string[];
  inLibrary: boolean;
  isLoading: boolean;
  logo?: string;
  onBack: () => void;
  onOpenMenu?: () => void;
  backButtonRef?: React.RefObject<View | null>;
  onBackButtonLayout?: () => void;
  onOpenStory?: () => void;
  exploreRef?: React.RefObject<View | null>;
  onOpenWeb?: () => void;
  onSearchTitle: () => void;
  onToggleLibrary: () => void;
  onToggleSynopsis: () => void;
  providerName: string;
  rating?: string;
  readMore: boolean;
  runtime?: string;
  synopsis: string;
  synopsisLoading: boolean;
  tags?: string[];
  title?: string;
  trailerUrl?: string;
  year?: string;
}

import {TVFocusable} from '../../../components/tv';

const HeaderIconButton = ({
  icon,
  label,
  onPress,
  focusRef,
  onLayout,
  preferredFocus = true,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  focusRef?: React.RefObject<View | null>;
  onLayout?: () => void;
  preferredFocus?: boolean;
}) => {
  const colors = useM3Colors();

  return (
    <TVFocusable
      ref={focusRef}
      onLayout={onLayout}
      onFocus={() => {
        if (isTV && focusRef?.current) {
          const handle = findNodeHandle(focusRef.current);
          if (handle) useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
        }
      }}
      hasTVPreferredFocus={isTV && preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignItems: 'center',
        height: 44,
        justifyContent: 'center',
        width: 44,
      }}>
      <MaterialCommunityIcons name={icon} size={28} color={colors.primary} />
    </TVFocusable>
  );
};

const InfoAction = ({
  icon,
  label,
  onPress,
  focusRef,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  focusRef?: React.RefObject<View | null>;
}) => {
  const colors = useM3Colors();

  return (
    <TVFocusable
      ref={focusRef}
      onFocus={() => {
        if (isTV && focusRef?.current) {
          const handle = findNodeHandle(focusRef.current);
          if (handle) {
            useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
          }
        }
      }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignItems: 'center',
        flex: 1,
        justifyContent: 'flex-start',
        minHeight: 76,
        paddingHorizontal: 4,
        paddingVertical: 8,
      }}>
      <MaterialCommunityIcons name={icon} size={30} color={colors.primary} />
      <AppText
        role="labelMediumEmphasized"
        numberOfLines={2}
        style={{
          color: colors.onSurfaceVariant,
          marginTop: 9,
          textAlign: 'center',
        }}>
        {label}
      </AppText>
    </TVFocusable>
  );
};

const CompactChip = ({label}: {label: string}) => {
  const colors = useM3Colors();

  return (
    <View
      style={{
        backgroundColor: '#171717',
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}>
      <AppText role="labelMediumEmphasized" style={{color: colors.primary}}>
        {label}
      </AppText>
    </View>
  );
};

const ContentOverview = ({
  headerPoster,
  genres,
  inLibrary,
  isLoading,
  logo,
  onBack,
  onOpenMenu,
  backButtonRef,
  onBackButtonLayout,
  onOpenStory,
  exploreRef,
  onOpenWeb,
  onSearchTitle,
  onToggleLibrary,
  onToggleSynopsis,
  providerName,
  rating,
  readMore,
  runtime,
  synopsis,
  synopsisLoading,
  tags,
  title,
  trailerUrl,
  year,
}: ContentOverviewProps) => {
  const insets = useSafeAreaInsets();
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [logoFailed, setLogoFailed] = useState(false);
  const metadata = useMemo(
    () =>
      [year, runtime, ...(genres ?? []), ...(tags ?? [])]
        .filter(Boolean)
        .map(String)
        .slice(0, 6),
    [genres, runtime, tags, year],
  );
  const synopsisText =
    synopsis.length > 240 && !readMore
      ? `${synopsis.slice(0, 240)}...`
      : synopsis;
  const normalizedRating = rating?.replace(/\s*\/\s*10$/i, '').trim();

  useEffect(() => {
    setLogoFailed(false);
  }, [logo]);

  return (
    <View>
      <View
        style={{
          height: 340,
          overflow: 'hidden',
          width: '100%',
        }}>
        <LinearGradient
          colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0.1)', colors.background]}
          locations={[0, 0.58, 1]}
          style={{
            height: 340,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        />

        {headerPoster ? (
          <View
            pointerEvents="none"
            style={{
              alignItems: 'center',
              bottom: 20,
              left: 0,
              position: 'absolute',
              right: 0,
              top: (isTV ? 42 : insets.top + 12) + 8,
            }}>
            <View
              style={{
                aspectRatio: 2 / 3,
                borderRadius: 12,
                elevation: 12,
                height: '100%',
                overflow: 'hidden',
              }}>
              <Image
                source={{uri: headerPoster}}
                resizeMode="cover"
                resizeMethod="resize"
                style={{height: '100%', width: '100%'}}
              />
            </View>
          </View>
        ) : null}

        {onOpenMenu && (
          <View style={{position: 'absolute', right: 18, top: isTV ? 42 : insets.top + 12, zIndex: 2}}>
            <HeaderIconButton icon="dots-vertical" label="More options" onPress={onOpenMenu} preferredFocus={false} />
          </View>
        )}
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            left: 12,
            position: 'absolute',
            top: isTV ? 42 : insets.top + 12,
          }}>
          <HeaderIconButton
            focusRef={backButtonRef}
            onLayout={onBackButtonLayout}
            icon="arrow-left"
            label="Go back"
            onPress={onBack}
          />
        </View>
      </View>

      <View style={{backgroundColor: colors.background, paddingHorizontal: 20}}>
        <View
          style={{
            alignItems: 'flex-end',
            flexDirection: 'row',
            gap: 16,
            justifyContent: 'space-between',
          }}>
          <View style={{flex: 1, minWidth: 0}}>
            {isLoading ? (
              <SkeletonLoader show height={38} width={190} marginVertical={0} />
            ) : logo && !logoFailed ? (
              <Image
                source={{uri: logo}}
                onError={() => setLogoFailed(true)}
                resizeMode="contain"
                resizeMethod="resize"
                style={{height: 64, width: 220}}
              />
            ) : (
              <AppText
                role="headlineMediumEmphasized"
                numberOfLines={2}
                style={{color: colors.onBackground}}>
                {title || 'Unknown title'}
              </AppText>
            )}
          </View>
          {normalizedRating ? (
            <View
              style={{
                alignItems: 'baseline',
                flexDirection: 'row',
                paddingBottom: 4,
              }}>
              <AppText
                role="headlineMediumEmphasized"
                style={{color: colors.onBackground}}>
                {normalizedRating}
              </AppText>
              <AppText
                role="titleMediumEmphasized"
                style={{color: colors.onSurfaceVariant}}>
                /10
              </AppText>
            </View>
          ) : null}
        </View>

        {metadata.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 7,
              marginTop: 16,
            }}>
            {metadata.map(item => (
              <CompactChip key={item} label={item} />
            ))}
          </View>
        ) : null}

        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 20,
          }}>
          <View style={{alignItems: 'center', flexDirection: 'row', flex: 1}}>
            <AppText
              role="titleLargeEmphasized"
              style={{color: colors.onBackground, marginRight: 12}}>
              Synopsis
            </AppText>
            <AppText
              role="labelLargeEmphasized"
              numberOfLines={1}
              style={{color: colors.primary}}>
              {providerName}
            </AppText>
          </View>
        </View>

        {synopsisLoading ? (
          <View style={{gap: 7, marginTop: 12}}>
            <SkeletonLoader show height={18} width="100%" marginVertical={0} />
            <SkeletonLoader show height={18} width="94%" marginVertical={0} />
            <SkeletonLoader show height={18} width="72%" marginVertical={0} />
          </View>
        ) : (
          <AppText
            role="bodyLarge"
            style={{
              color: colors.onSurfaceVariant,
              lineHeight: 24,
              marginTop: 10,
            }}>
            {synopsisText}
          </AppText>
        )}

          {!synopsisLoading && synopsis.length > 240 ? (
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel={
                readMore ? 'Show less synopsis' : 'Read more synopsis'
              }
              accessibilityState={{expanded: readMore}}
              onPress={onToggleSynopsis}
              borderRadius={8}
              focusBorderColor={focusBorderColor}
              style={{
                minHeight: 44,
                paddingVertical: 8,
                paddingHorizontal: 4,
                justifyContent: 'center',
                alignSelf: 'flex-start',
                flexShrink: 0,
              }}>
              <AppText
                role="labelLargeEmphasized"
                style={{color: colors.primary}}>
                {readMore ? 'Show less' : 'Read more'}
              </AppText>
            </TVFocusable>
          ) : null}
        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: -4,
            marginTop: 18,
          }}>
          <InfoAction icon="magnify" label="Search" onPress={onSearchTitle} />
          {onOpenWeb ? (
            <InfoAction icon="web" label="Web" onPress={onOpenWeb} />
          ) : null}
          {onOpenStory ? (
            <InfoAction
              icon="book-open-page-variant-outline"
              label="Explore"
              focusRef={exploreRef}
              onPress={onOpenStory}
            />
          ) : trailerUrl ? (
            <InfoAction
              icon="movie-play-outline"
              label="Trailer"
              onPress={() => Linking.openURL(trailerUrl)}
            />
          ) : null}
          <InfoAction
            icon={inLibrary ? 'bookmark-check' : 'bookmark-plus-outline'}
            label={inLibrary ? 'Saved' : 'Save'}
            onPress={onToggleLibrary}
          />
        </View>
      </View>
    </View>
  );
};

export default ContentOverview;
