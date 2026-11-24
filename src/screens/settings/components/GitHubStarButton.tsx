import React, {useState} from 'react';
import {Linking, Pressable, Text, View, findNodeHandle} from 'react-native';
import {AntDesign, Feather, MaterialCommunityIcons} from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {socialLinks} from '../../../lib/constants';
import {settingsStorage} from '../../../lib/storage';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {isTV} from '../../../lib/tv';

const sparklePositions = [
  {top: 3, left: 18},
  {top: 11, left: 47},
  {top: 39, left: 30},
  {top: 34, left: 62},
];

interface GitHubStarButtonProps {
  primary: string;
}

const GitHubStarButton = ({primary}: GitHubStarButtonProps) => {
  const focusBorderColor = useTVFocusBorderColor(primary);
  const [celebrating, setCelebrating] = useState(false);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));

  const openGitHub = async () => {
    if (celebrating) {
      return;
    }

    setCelebrating(true);
    scale.value = withSequence(
      withTiming(0.96, {duration: 80}),
      withSpring(1.04),
      withSpring(1),
    );

    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('impactMedium', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }

    await new Promise(resolve => setTimeout(resolve, 520));
    await Linking.openURL(socialLinks.github);
    setCelebrating(false);
  };

  const [isFocused, setIsFocused] = useState(false);
  const buttonRef = React.useRef<View>(null);
  const [buttonHandle, setButtonHandle] = useState<number | null>(null);

  return (
    <Pressable
      ref={isTV ? (buttonRef as any) : undefined}
      onLayout={isTV ? () => setButtonHandle(findNodeHandle(buttonRef.current)) : undefined}
      nextFocusDown={isTV ? buttonHandle ?? undefined : undefined}
      accessibilityRole="button"
      accessibilityLabel="Star Vega on GitHub"
      focusable={isTV ? true : undefined}
      isTVSelectable={isTV ? true : undefined}
      onFocus={isTV ? () => setIsFocused(true) : undefined}
      onBlur={isTV ? () => setIsFocused(false) : undefined}
      onPress={openGitHub}
      style={({pressed}) => ({
        borderColor: isTV && isFocused ? focusBorderColor : 'transparent',
        borderWidth: isTV && isFocused ? 2 : 0,
        borderRadius: 16,
        transform: [{scale: isTV && isFocused ? 1.03 : pressed ? 0.96 : 1}],
      })}>
      <Animated.View
        className="flex-row items-center justify-between p-4"
        style={animatedStyle}>
        <View className="flex-row items-center">
          <View className="relative items-center justify-center w-7 h-7">
            <AntDesign name="github" size={22} color={primary} />
            {celebrating &&
              sparklePositions.map((position, index) => (
                <Animated.View
                  key={index}
                  entering={ZoomIn.delay(index * 55).springify()}
                  exiting={FadeOut.duration(140)}
                  style={{position: 'absolute', ...position}}>
                  <MaterialCommunityIcons
                    name="star-four-points"
                    size={index % 2 === 0 ? 10 : 7}
                    color={index % 2 === 0 ? '#FFD54A' : primary}
                  />
                </Animated.View>
              ))}
          </View>
          {celebrating ? (
            <Animated.Text
              key="thanks"
              entering={FadeIn.duration(180)}
              className="text-white ml-3 text-base font-medium">
              You are a star!
            </Animated.Text>
          ) : (
            <Text className="text-white ml-3 text-base font-medium">
              Star Vega on GitHub
            </Text>
          )}
        </View>
        <Feather name="external-link" size={20} color="gray" />
      </Animated.View>
    </Pressable>
  );
};

export default GitHubStarButton;
