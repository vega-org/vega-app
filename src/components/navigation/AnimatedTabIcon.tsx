import React, {useEffect, useRef} from 'react';
import Svg, {G} from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {FilledTabIcon, OutlineTabIcon} from './AnimatedTabIconParts';

const AnimatedG = Animated.createAnimatedComponent(G);

export type AnimatedTabIconName =
  | 'home'
  | 'search'
  | 'watchlist'
  | 'download'
  | 'settings';

type AnimatedTabIconProps = {
  name: AnimatedTabIconName;
  active: boolean;
  color: string;
  size?: number;
};

export const AnimatedTabIcon = React.memo(function AnimatedTabIcon({
  name,
  active,
  color,
  size = 24,
}: AnimatedTabIconProps) {
  // Start fully drawn so initial focus never depends on an animation callback.
  const progress = useSharedValue(1);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: 650,
        easing: Easing.inOut(Easing.cubic),
      });
    } else {
      progress.value = 1;
    }
    wasActive.current = active;
    return () => cancelAnimation(progress);
  }, [active, progress]);

  const fallbackProps = useAnimatedProps(() => ({
    // Keep a visible glyph while the first outline segments are being drawn.
    opacity: 1 - Math.min(progress.value * 2, 1),
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {active ? (
        <>
          <AnimatedG animatedProps={fallbackProps}>
            <FilledTabIcon name={name} color={color} />
          </AnimatedG>
          <OutlineTabIcon name={name} color={color} progress={progress} />
        </>
      ) : (
        <FilledTabIcon name={name} color={color} />
      )}
    </Svg>
  );
});
