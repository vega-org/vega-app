import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import AppText from '../ui/Text';
import {AnimatedTabIcon, type AnimatedTabIconName} from './AnimatedTabIcon';
import {GLASS_BAR_PADDING} from './FloatingTabBarInsetContext';

export interface GlassTabItem {
  key: string;
  label: string;
  icon: AnimatedTabIconName;
  accessibilityLabel?: string;
}

interface GlassTabBarItemProps {
  item: GlassTabItem;
  index: number;
  isFocused: boolean;
  showLabels: boolean;
  compactText: boolean;
  position: SharedValue<number>;
  onSelect: (index: number, options?: {skipHaptic?: boolean}) => boolean;
}

export const GlassTabBarItem = React.memo(function GlassTabBarItem({
  item,
  index,
  isFocused,
  showLabels,
  compactText,
  position,
  onSelect,
}: GlassTabBarItemProps) {
  const contentOpacityStyle = useAnimatedStyle(() => {
    const focus = Math.max(0, 1 - Math.abs(position.get() - index));
    return {
      opacity: 0.56 + 0.44 * focus,
    };
  });

  const handleAccessibilityActivate = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  return (
    <View
      accessible
      accessibilityRole="tab"
      accessibilityState={isFocused ? {selected: true} : {}}
      accessibilityLabel={item.accessibilityLabel || item.label}
      accessibilityActions={[{name: 'activate'}]}
      onAccessibilityAction={handleAccessibilityActivate}
      style={[styles.tabItem, showLabels && styles.tabItemWithLabel]}>
      <Animated.View style={[styles.itemContent, contentOpacityStyle]}>
        <AnimatedTabIcon
          name={item.icon}
          active={isFocused}
          color="#FFFFFF"
          size={22}
        />
        {showLabels ? (
          <AppText
            role={isFocused ? 'labelMediumEmphasized' : 'labelMedium'}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.15}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{
              color: '#FFFFFF',
              fontSize: compactText ? 10.5 : 11.5,
              lineHeight: compactText ? 13 : 14,
              letterSpacing: compactText ? 0.1 : 0.15,
              fontWeight: isFocused ? '600' : '500',
              marginTop: 2,
              textAlign: 'center',
              alignSelf: 'stretch',
            }}>
            {item.label}
          </AppText>
        ) : null}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: GLASS_BAR_PADDING,
  },
  tabItemWithLabel: {
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  itemContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
