import {NavigationContext} from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Image, Pressable, TouchableOpacity, View} from 'react-native';
import Animated from 'react-native-reanimated';
import {BlurView} from 'expo-blur';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {isTV} from '../lib/tv/constants';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import {useTVRemote} from '../lib/tv/useTVRemote';
import {
  useSafeIsNavFocused,
  useTVNavFocusMemory,
} from '../lib/tv/useTVNavFocusMemory';

export const parseAspectRatio = (
  ratio?: number | string,
  fallback: number = 2 / 3,
): number => {
  if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) {
    return ratio;
  }
  if (typeof ratio === 'string') {
    const trimmed = ratio.trim();
    if (trimmed.includes(':')) {
      const [w, h] = trimmed.split(':').map(Number);
      if (w > 0 && h > 0) return w / h;
    }
    if (trimmed.includes('/')) {
      const [w, h] = trimmed.split('/').map(Number);
      if (w > 0 && h > 0) return w / h;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
};

export const getResponsiveCardWidth = (
  _windowWidth?: number,
  aspectRatio?: number | string,
): number => {
  const ratio = parseAspectRatio(aspectRatio, 2 / 3);
  if (ratio > 1.2) return 220;
  if (ratio > 0.85) return 150;
  return 124;
};

interface MediaPosterCardProps {
  title: string;
  poster?: string;
  width: number;
  subtitle?: string;
  badge?: number | string;
  aspectRatio?: number | string;
  borderRadius?: number;
  tag?: string;
  cornerTag?: string;
  selected?: boolean;
  selectionMode?: boolean;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number | null;
  nextFocusDown?: number | null;
  nextFocusLeft?: number | null;
  nextFocusRight?: number | null;
  onPress: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onLayout?: (event: any) => void;
}

// TV boxes have little GPU headroom, and a row of cards entering at once
// competes with D-pad focus animations. Cards appear without a transition there.

// Native opacity feedback avoids rerendering poster contents on every phone press.
const MobilePosterTouchable = React.forwardRef<
  View,
  React.ComponentProps<typeof Pressable>
>(({style, children, delayLongPress, ...props}, ref) => (
  <TouchableOpacity
    {...(props as React.ComponentProps<typeof TouchableOpacity>)}
    delayLongPress={delayLongPress ?? undefined}
    ref={ref as any}
    activeOpacity={0.65}
    style={typeof style === 'function' ? style({pressed: false, focused: false}) : style}>
    {typeof children === 'function' ? children({pressed: false, focused: false}) : children}
  </TouchableOpacity>
));
const PosterTouchable = isTV ? Pressable : MobilePosterTouchable;

const MediaPosterCardBase = React.forwardRef<View, MediaPosterCardProps>(
  (
    {
      title,
      poster,
      width,
      subtitle,
      badge,
      aspectRatio,
      borderRadius,
      tag,
      cornerTag,
      selected = false,
      selectionMode = false,
      hasTVPreferredFocus = false,
      nextFocusUp,
      nextFocusDown,
      nextFocusLeft,
      nextFocusRight,
      onPress,
      onLongPress,
      onFocus,
      onLayout,
    },
    ref,
  ) => {
    const colors = useM3Colors();

    const navigation = React.useContext(NavigationContext);
    const isNavFocused = useSafeIsNavFocused();
    const isCurrentlyFocusable = isNavFocused;
    const pressableRef = React.useRef<View>(null);
    React.useImperativeHandle(ref, () => pressableRef.current as View);
    const {
      preferredFocus,
      onFocus: rememberFocus,
      onBlur: forgetFocus,
    } = useTVNavFocusMemory({
      ref: pressableRef,
      isNavFocused,
      hasTVPreferredFocus,
    });
    const [isFocused, setIsFocused] = React.useState(false);
    const activeAspectRatio = parseAspectRatio(aspectRatio, 2 / 3);
    const activeBorderRadius =
      typeof borderRadius === 'number' && borderRadius >= 0 ? borderRadius : 18;
    const activeTag = cornerTag || tag;
    const focusBorderColor = useTVFocusBorderColor();

    React.useEffect(() => {
      if (!isNavFocused && isFocused) {
        setIsFocused(false);
      }
    }, [isNavFocused, isFocused]);

    const lastPressTime = React.useRef<number>(0);
    const handlePress = React.useCallback(() => {
      if (!isCurrentlyFocusable || navigation?.isFocused() === false) return;
      const now = Date.now();
      if (now - lastPressTime.current < 300) return;
      lastPressTime.current = now;
      onPress();
    }, [isCurrentlyFocusable, onPress, navigation]);

    // A long select can reach both Pressable.onLongPress and the remote
    // listener. Run once, or selection toggles on and straight back off.
    const lastLongPressTime = React.useRef<number>(0);
    const handleLongPress = React.useCallback(() => {
      if (!onLongPress || !isCurrentlyFocusable || navigation?.isFocused() === false) return;
      const now = Date.now();
      if (now - lastLongPressTime.current < 800) return;
      lastLongPressTime.current = now;
      onLongPress();
    }, [onLongPress, isCurrentlyFocusable, navigation]);

    useTVRemote(
      evt => {
        if (!isFocused || !isCurrentlyFocusable) return;
        if (
          (evt.eventType === 'longSelect' || evt.eventType === 'menu') &&
          onLongPress &&
          (evt.eventKeyAction === undefined || evt.eventKeyAction === 1)
        ) {
          handleLongPress();
        }
      },
      isTV && isFocused && isCurrentlyFocusable,
    );

    return (
      <Animated.View
        style={{
          width,
          paddingVertical: 6,
          overflow: 'visible',
          zIndex: isFocused ? 999 : 1,
        }}>
        <PosterTouchable
          ref={pressableRef as any}
          onLayout={onLayout}
          focusable={isCurrentlyFocusable}
          isTVSelectable={isCurrentlyFocusable}
          hasTVPreferredFocus={preferredFocus}
          nextFocusUp={nextFocusUp ?? undefined}
          nextFocusDown={nextFocusDown ?? undefined}
          nextFocusLeft={nextFocusLeft ?? undefined}
          nextFocusRight={nextFocusRight ?? undefined}
          onFocus={() => {
            if (isCurrentlyFocusable) {
              setIsFocused(true);
              rememberFocus();
              onFocus?.();
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            forgetFocus();
          }}
          onPress={isCurrentlyFocusable ? handlePress : undefined}
          onLongPress={
            isCurrentlyFocusable && onLongPress ? handleLongPress : undefined
          }
          delayLongPress={350}
          style={({pressed, focused}: any) => {
            const activeFocused = isTV ? isFocused : focused || isFocused;
            return {
              opacity: pressed ? 0.86 : 1,
              transform: [
                {
                  scale: pressed
                    ? 0.96
                    : activeFocused
                      ? isTV
                        ? 1.05
                        : 1.04
                      : 1,
                },
              ],
              borderRadius: activeBorderRadius + 4,
              backgroundColor: selected
                ? colors.primaryContainer
                : 'transparent',
              padding: selected ? 4 : 0,
              paddingBottom: selected ? 8 : 0,
              overflow: selected && !isTV ? 'hidden' : 'visible',
              zIndex: activeFocused ? 999 : 1,
            };
          }}>
          {({focused}: any) => {
            const activeFocused = isTV ? isFocused : focused || isFocused;
            return (
              <>
                <View
                  style={{
                    backgroundColor: colors.surfaceContainerHigh,
                    borderRadius: activeBorderRadius,
                    overflow: 'hidden',
                    width: selected ? width - 8 : width,
                    position: 'relative',
                    borderWidth: selected ? 2 : 0,
                    borderColor: selected ? colors.primary : 'transparent',
                  }}>
                  {badge != null ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        backgroundColor: colors.primaryContainer,
                        borderRadius: Math.min(8, activeBorderRadius),
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        zIndex: 5,
                        borderWidth: 1,
                        borderColor: colors.outlineVariant,
                      }}>
                      <AppText
                        role="labelSmallEmphasized"
                        style={{
                          color: colors.onPrimaryContainer,
                          fontWeight: '800',
                          fontSize: 11,
                        }}>
                        {badge}
                      </AppText>
                    </View>
                  ) : activeTag != null && activeTag.trim().length > 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        borderRadius: Math.min(8, activeBorderRadius),
                        overflow: 'hidden',
                        zIndex: 5,
                        shadowColor: '#000',
                        shadowOffset: {width: 0, height: 2},
                        shadowOpacity: 0.35,
                        shadowRadius: 4,
                        elevation: 4,
                      }}>
                      <BlurView
                        intensity={45}
                        tint="systemMaterialDark"
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.20)',
                          paddingHorizontal: 7,
                          paddingVertical: 2.5,
                        }}>
                        <AppText
                          role="labelSmallEmphasized"
                          style={{
                            color: '#FFFFFF',
                            fontWeight: '800',
                            fontSize: 10,
                            letterSpacing: 0.6,
                            textShadowColor: 'rgba(0, 0, 0, 0.85)',
                            textShadowOffset: {width: 0, height: 1},
                            textShadowRadius: 3,
                          }}>
                          {activeTag.trim().toUpperCase()}
                        </AppText>
                      </BlurView>
                    </View>
                  ) : null}

                  {selectionMode ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        backgroundColor: selected
                          ? colors.primary
                          : 'rgba(0,0,0,0.55)',
                        borderRadius: 12,
                        width: 22,
                        height: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 5,
                        borderWidth: 1,
                        borderColor: selected
                          ? colors.primary
                          : 'rgba(255,255,255,0.6)',
                      }}>
                      {selected ? (
                        <MaterialCommunityIcons
                          name="check"
                          size={14}
                          color={colors.onPrimary}
                        />
                      ) : null}
                    </View>
                  ) : null}

                  {poster ? (
                    <Image
                      source={{uri: poster}}
                      resizeMode="cover"
                      // Decode at card size. Android otherwise decodes remote
                      // images at full resolution, which wastes memory and
                      // causes jank while scrolling on low-end phones and TVs.
                      resizeMethod="resize"
                      style={{
                        aspectRatio: activeAspectRatio,
                        width: '100%',
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        alignItems: 'center',
                        aspectRatio: activeAspectRatio,
                        backgroundColor: colors.surfaceContainerHighest,
                        justifyContent: 'center',
                        width: selected ? width - 8 : width,
                      }}>
                      <AppText
                        role="headlineMediumEmphasized"
                        style={{color: colors.onSurfaceVariant}}>
                        {title.slice(0, 1).toUpperCase()}
                      </AppText>
                    </View>
                  )}
                  {activeFocused ? (
                    // Drawn over the poster, so focus does not resize the card.
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        borderRadius: activeBorderRadius,
                        borderWidth: 2.5,
                        borderColor: focusBorderColor,
                        zIndex: 10,
                      }}
                    />
                  ) : null}
                </View>
                <AppText
                  role="labelMediumEmphasized"
                  ellipsizeMode="tail"
                  numberOfLines={1}
                  style={{
                    color: selected
                      ? colors.onPrimaryContainer
                      : colors.onSurface,
                    marginTop: selected ? 4 : 7,
                    marginHorizontal: selected ? 4 : 0,
                  }}>
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText
                    role="labelSmall"
                    ellipsizeMode="tail"
                    numberOfLines={1}
                    style={{
                      color: selected
                        ? colors.onPrimaryContainer
                        : colors.onSurfaceVariant,
                      marginTop: 1,
                      marginHorizontal: selected ? 4 : 0,
                    }}>
                    {subtitle}
                  </AppText>
                ) : null}
              </>
            );
          }}
        </PosterTouchable>
      </Animated.View>
    );
  },
);

const MediaPosterCard = React.memo(MediaPosterCardBase);

export default MediaPosterCard;
