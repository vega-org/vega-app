import {NavigationRouteContext} from '@react-navigation/native';
import React, {createContext, useCallback, useContext, useRef} from 'react';
import {ScrollView, View} from 'react-native';
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

function HighlightedSetting({reveal, children}: {
  reveal: (row: View) => void;
  children: React.ReactNode;
}) {
  const colors = useM3Colors();
  const row = useRef<View>(null);

  return (
    <View
      ref={row}
      collapsable={false}
      onLayout={() => {
        requestAnimationFrame(() => {
          if (row.current) reveal(row.current);
        });
      }}
      style={{backgroundColor: colors.secondaryContainer, borderRadius: 12}}>
      {children}
    </View>
  );
}
