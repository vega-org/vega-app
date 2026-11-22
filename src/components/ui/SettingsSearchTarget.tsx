import {NavigationRouteContext} from '@react-navigation/native';
import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Animated, ScrollView, StyleSheet, View} from 'react-native';
import {useM3Colors} from '../../theme/M3PaletteContext';

export type SettingsSearchParams = {setting?: string} | undefined;

export function useSettingsSearchTarget() {
  const route = useContext(NavigationRouteContext);
  return (route?.params as SettingsSearchParams)?.setting;
}

const TargetContext = createContext<{
  setting: string;
  reveal: (row: View) => void;
} | null>(null);

type ScrollProps = React.ComponentProps<typeof ScrollView> & {
  searchFallback?: Readonly<Record<string, string>>;
};

export function SettingsSearchScrollView({children, searchFallback, ...props}: ScrollProps) {
  const requested = useSettingsSearchTarget();
  const setting = requested && (searchFallback?.[requested] ?? requested);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const reveal = useCallback((row: View) => {
    const container = content.current;
    if (!container) return;
    row.measureLayout(container, (_x, y) => {
      scroll.current?.scrollTo({y: Math.max(0, y - 16), animated: true});
    }, () => {});
  }, []);

  return (
    <ScrollView {...props} ref={scroll}>
      {setting ? (
        <TargetContext.Provider value={{setting, reveal}}>
          <View ref={content} collapsable={false}>{children}</View>
        </TargetContext.Provider>
      ) : children}
    </ScrollView>
  );
}

export function SettingsSearchAnchor({label, children}: {
  label: string;
  children: React.ReactNode;
}) {
  const target = useContext(TargetContext);
  if (target?.setting.toLowerCase() !== label.toLowerCase()) return <>{children}</>;
  return <HighlightedSetting key={target.setting} reveal={target.reveal}>{children}</HighlightedSetting>;
}

// Matches the scroll animation so the flash starts once the row is in view.
const FLASH_DELAY_MS = 300;

function HighlightedSetting({reveal, children}: {
  reveal: (row: View) => void;
  children: React.ReactNode;
}) {
  const colors = useM3Colors();
  const row = useRef<View>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const flashed = useRef(false);
  const [flashing, setFlashing] = useState(true);
  useEffect(() => () => opacity.stopAnimation(), [opacity]);

  const flashOnce = () => {
    if (flashed.current) return;
    flashed.current = true;
    Animated.sequence([
      Animated.delay(FLASH_DELAY_MS),
      Animated.timing(opacity, {toValue: 1, duration: 200, useNativeDriver: true}),
      Animated.delay(250),
      Animated.timing(opacity, {toValue: 0, duration: 550, useNativeDriver: true}),
    ]).start(({finished}) => {
      if (finished) setFlashing(false);
    });
  };

  return (
    <View
      ref={row}
      collapsable={false}
      onLayout={() => {
        requestAnimationFrame(() => {
          if (!row.current) return;
          reveal(row.current);
          flashOnce();
        });
      }}>
      {flashing && (
        <Animated.View
          pointerEvents="none"
          testID="settings-search-flash"
          style={[
            StyleSheet.absoluteFill,
            {backgroundColor: colors.secondaryContainer, borderRadius: 12, opacity},
          ]}
        />
      )}
      {children}
    </View>
  );
}
