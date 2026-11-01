import React, {useState} from 'react';
import {Image, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {isTV} from '../../../lib/tv';
import {TVFocusable} from '../../../components/tv';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';

export interface DetailsHeroProps {
  title: string;
  backgroundImage: string;
  posterLike: boolean;
  backdropReady: boolean;
  hasArtwork: boolean;
  synopsis?: string;
  subtitleRow?: React.ReactNode;
  onBack: () => void;
  onTitleLayout?: (height: number) => void;
}

export default function DetailsHero({
  title,
  backgroundImage,
  posterLike,
  backdropReady,
  hasArtwork,
  synopsis,
  subtitleRow,
  onBack,
  onTitleLayout,
}: DetailsHeroProps) {
  const insets = useSafeAreaInsets();
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [readMore, setReadMore] = useState(false);
  const [titleHeight, setTitleHeight] = useState(0);

  const posterTop = isTV ? 24 : insets.top + 12;
  const posterBottom = 12 + titleHeight + 12;
  const showPoster =
    posterLike &&
    !!backgroundImage &&
    titleHeight > 0 &&
    340 - posterTop - posterBottom >= 110;

  return (
    <>
      <View className="absolute h-[340px] w-full">
        {(backdropReady || !hasArtwork) && !!backgroundImage ? (
          <Image
            source={{uri: backgroundImage}}
            className="h-[340px] w-full"
            resizeMode="cover"
            resizeMethod="resize"
            blurRadius={posterLike ? 18 : 0}
            style={{opacity: posterLike ? 0.75 : 1}}
          />
        ) : null}
      </View>
      <View className="relative h-[340px] w-full">
        <LinearGradient
          colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.18)', '#000000']}
          locations={[0, 0.55, 1]}
          className="absolute h-full w-full"
        />
        {showPoster ? (
          <View
            pointerEvents="none"
            style={{
              alignItems: 'center',
              bottom: posterBottom,
              left: 0,
              position: 'absolute',
              right: 0,
              top: posterTop,
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
                source={{uri: backgroundImage}}
                resizeMode="cover"
                resizeMethod="resize"
                style={{height: '100%', width: '100%'}}
              />
            </View>
          </View>
        ) : null}
        <TVFocusable
          hasTVPreferredFocus={isTV}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          borderRadius={18}
          focusScale={1.1}
          focusBorderColor={focusBorderColor}
          onPress={onBack}
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(23,23,23,0.88)',
            borderRadius: 18,
            height: 48,
            justifyContent: 'center',
            marginLeft: isTV ? 24 : 20,
            marginTop: isTV ? 24 : insets.top + 12,
            width: 48,
          }}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={26}
            color={colors.onSurface}
          />
        </TVFocusable>
        <View
          className="absolute bottom-3 right-0 w-full px-5"
          onLayout={event => {
            const height = event.nativeEvent.layout.height;
            setTitleHeight(height);
            onTitleLayout?.(height);
          }}>
          <Text
            className="text-3xl font-bold capitalize"
            style={{color: colors.onBackground}}>
            {title}
          </Text>
          {subtitleRow}
        </View>
      </View>

      {synopsis ? (
        <View className="bg-black px-5 pt-3">
          <View className="mb-7">
            <Text
              className="mb-2 text-xl font-bold"
              style={{color: colors.onBackground}}>
              Synopsis
            </Text>
            <Text
              className="text-base leading-6"
              style={{color: colors.onSurfaceVariant}}>
              {synopsis.length > 240 && !readMore
                ? `${synopsis.slice(0, 240)}...`
                : synopsis}
            </Text>
            {synopsis.length > 240 ? (
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel={
                  readMore ? 'Show less synopsis' : 'Read more synopsis'
                }
                onPress={() => setReadMore(value => !value)}
                borderRadius={8}
                focusScale={1.05}
                focusBorderColor={focusBorderColor}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 4,
                  alignSelf: 'flex-start',
                }}>
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 14,
                    fontWeight: '700',
                  }}>
                  {readMore ? 'Show less' : 'Read more'}
                </Text>
              </TVFocusable>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  );
}
