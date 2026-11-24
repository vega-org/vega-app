import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import React, {useState} from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  View,
  findNodeHandle,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {settingsStorage} from '../../lib/storage';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';
import {useTabVisibilityStore} from '../../lib/zustand/tabVisibilityStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {AnimatedTabIcon, type AnimatedTabIconName} from './AnimatedTabIcon';
import {isTabRouteOnSubpage} from './FloatingTabBarInsetContext';
import {GlassTabBar, type GlassTabItem} from './GlassTabBar';
import {isTV} from '../../lib/tv/constants';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';

const TAB_ICONS: Record<string, AnimatedTabIconName> = {
  HomeStack: 'home',
  SearchStack: 'search',
  WatchListStack: 'watchlist',
  DownloadsStack: 'download',
  SettingsStack: 'settings',
};

interface TabButtonProps {
  routeKey: string;
  routeName: string;
  isFocused: boolean;
  label: string;
  icon: AnimatedTabIconName;
  accessibilityLabel?: string;
  isNavigationRail: boolean;
  showLabels: boolean;
  colors: any;
  onPress: () => void;
  onLongPress: () => void;
}

import {TVFocusable} from '../tv';

import useTVNavigationStore, {
  selectRailFocusHandle,
} from '../../lib/zustand/tvNavigationStore';

const useRailFocusHandle = isTV
  ? () => useTVNavigationStore(selectRailFocusHandle)
  : () => null;

const StreamingTabButton = ({
  routeKey,
  isFocused,
  label,
  icon,
  accessibilityLabel,
  isNavigationRail,
  showLabels,
  colors,
  onPress,
  onLongPress,
}: TabButtonProps) => {
  const focusBorderColor = useTVFocusBorderColor();
  const railFocusHandle = useRailFocusHandle();
  const tabRef = React.useRef<View>(null);
  const [tabHandle, setTabHandle] = useState<number | null>(null);

  if (isTV) {
    return (
      <TVFocusable
        ref={tabRef}
        registerScreenFocus={false}
        onLayout={() => {
          if (tabRef.current) {
            setTabHandle(findNodeHandle(tabRef.current));
          }
        }}
        nextFocusLeft={tabHandle}
        nextFocusRight={railFocusHandle ?? undefined}
        key={routeKey}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        onPress={onPress}
        onLongPress={onLongPress}
        focusScale={1.08}
        showFocusBorder={false}
        style={{
          alignItems: 'center',
          height: showLabels ? 72 : 56,
          justifyContent: 'center',
          minWidth: 48,
          width: 88,
          marginVertical: 4,
        }}>
        {({focused}) => (
          <>
            <View
              pointerEvents="none"
              style={{
                alignItems: 'center',
                backgroundColor: isFocused
                  ? colors.secondaryContainer
                  : focused
                    ? colors.surfaceContainerHighest
                    : 'transparent',
                borderColor: focused ? focusBorderColor : 'transparent',
                borderWidth: focused ? 2.5 : 0,
                borderRadius: 16,
                height: 34,
                justifyContent: 'center',
                overflow: 'hidden',
                width: 58,
              }}>
              <AnimatedTabIcon
                name={icon}
                active={isFocused || focused}
                color={
                  isFocused
                    ? colors.onSecondaryContainer
                    : focused
                      ? colors.onSurface
                      : colors.onSurfaceVariant
                }
                size={24}
              />
            </View>
            {showLabels ? (
              <AppText
                role={
                  isFocused || focused ? 'labelMediumEmphasized' : 'labelMedium'
                }
                numberOfLines={1}
                style={{
                  color:
                    isFocused || focused
                      ? colors.onSurface
                      : colors.onSurfaceVariant,
                  marginTop: 4,
                  textAlign: 'center',
                  fontWeight: focused ? '700' : isFocused ? '600' : '400',
                }}>
                {label}
              </AppText>
            ) : null}
          </>
        )}
      </TVFocusable>
    );
  }

  return (
    <TouchableOpacity
      key={routeKey}
      accessibilityRole="button"
      accessibilityState={isFocused ? {selected: true} : {}}
      accessibilityLabel={accessibilityLabel || label}
      activeOpacity={0.85}
      onLongPress={onLongPress}
      onPress={onPress}
      style={{
        alignItems: 'center',
        flex: isNavigationRail ? undefined : 1,
        height: isNavigationRail
          ? showLabels
            ? 72
            : 56
          : showLabels
            ? 58
            : 42,
        justifyContent: 'center',
        minWidth: 48,
        width: isNavigationRail ? 88 : undefined,
      }}>
      <View
        pointerEvents="none"
        style={{
          alignItems: 'center',
          backgroundColor: isFocused ? colors.secondaryContainer : 'transparent',
          borderRadius: 16,
          height: 34,
          justifyContent: 'center',
          overflow: 'hidden',
          width: 58,
        }}>
        <AnimatedTabIcon
          name={icon}
          active={isFocused}
          color={
            isFocused ? colors.onSecondaryContainer : colors.onSurfaceVariant
          }
          size={24}
        />
      </View>
      {showLabels ? (
        <AppText
          role={isFocused ? 'labelMediumEmphasized' : 'labelMedium'}
          numberOfLines={1}
          style={{
            color: isFocused ? colors.onSurface : colors.onSurfaceVariant,
            marginTop: 4,
            textAlign: 'center',
            fontWeight: isFocused ? '600' : '400',
          }}>
          {label}
        </AppText>
      ) : null}
    </TouchableOpacity>
  );
};

const StreamingTabBar = ({
  state,
  descriptors,
  navigation,
  blurTarget,
}: BottomTabBarProps & {blurTarget?: View}) => {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const isNavigationRail = isTV || Math.min(windowWidth, windowHeight) >= 600;
  const glassEnabled = useNavigationPreferencesStore(
    state => state.glassTabBar,
  );
  const hideGlassTabBarInSubpages = useNavigationPreferencesStore(
    state => state.hideGlassTabBarInSubpages,
  );
  const glass = glassEnabled && !isNavigationRail;
  const showLabels = settingsStorage.showTabBarLabels();
  const bottomBarPadding = Math.max(insets.bottom, 8);
  const activeTabKey = state.routes[state.index]?.key ?? null;
  const activeSubpage = useTabVisibilityStore(s => activeTabKey ? s.subpages[activeTabKey] : undefined);

  React.useLayoutEffect(() => {
    if (isTV) useTVNavigationStore.getState().setActiveTabKey(activeTabKey);
  }, [activeTabKey]);

  const activateTab = (index: number, options?: {skipHaptic?: boolean}) => {
    const route = state.routes[index];
    if (!route) return false;

    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (event.defaultPrevented) return false;

    if (index !== state.index) {
      if (!options?.skipHaptic && settingsStorage.isHapticFeedbackEnabled()) {
        ReactNativeHapticFeedback.trigger('effectTick', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
      navigation.navigate(route.name, route.params);
    }
    return true;
  };

  const getTabLabel = (routeKey: string, routeName: string) => {
    const descriptor = descriptors[routeKey];
    return typeof descriptor?.options.tabBarLabel === 'string'
      ? descriptor.options.tabBarLabel
      : typeof descriptor?.options.title === 'string'
        ? descriptor.options.title
        : routeName;
  };

  if (glass) {
    const activeRoute = state.routes[state.index];
    const hiddenOnSubpage =
      hideGlassTabBarInSubpages && (activeSubpage ?? isTabRouteOnSubpage(activeRoute));
    const glassItems: GlassTabItem[] = state.routes.map(route => {
      const descriptor = descriptors[route.key];
      return {
        key: route.key,
        label: getTabLabel(route.key, route.name),
        icon: TAB_ICONS[route.name] ?? 'home',
        accessibilityLabel: descriptor?.options.tabBarAccessibilityLabel,
      };
    });
    const hideOnKeyboard = Boolean(
      activeRoute
        ? descriptors[activeRoute.key]?.options.tabBarHideOnKeyboard
        : false,
    );

    return (
      <GlassTabBar
        blurTarget={blurTarget}
        items={glassItems}
        selectedIndex={state.index}
        showLabels={showLabels}
        hideOnKeyboard={hideOnKeyboard}
        hidden={hiddenOnSubpage}
        onSelect={activateTab}
      />
    );
  }

  const tabs = state.routes.map((route, index) => {
    const descriptor = descriptors[route.key];
    return (
      <StreamingTabButton
        key={route.key}
        routeKey={route.key}
        routeName={route.name}
        isFocused={state.index === index}
        label={getTabLabel(route.key, route.name)}
        icon={TAB_ICONS[route.name] ?? 'home'}
        accessibilityLabel={descriptor.options.tabBarAccessibilityLabel}
        isNavigationRail={isNavigationRail}
        showLabels={showLabels}
        colors={colors}
        onPress={() => activateTab(index)}
        onLongPress={() =>
          navigation.emit({type: 'tabLongPress', target: route.key})
        }
      />
    );
  });

  return (
    <View
      style={{
        backgroundColor: colors.surfaceContainerHigh,
        borderRightColor: isNavigationRail ? colors.outlineVariant : undefined,
        borderRightWidth: isNavigationRail ? StyleSheet.hairlineWidth : 0,
        height: isNavigationRail ? '100%' : undefined,
        paddingBottom: isNavigationRail
          ? Math.max(insets.bottom, 12)
          : bottomBarPadding,
        paddingLeft: isNavigationRail ? insets.left : 4,
        paddingRight: 4,
        paddingTop: isNavigationRail ? Math.max(insets.top, 16) : 6,
        width: isNavigationRail ? 96 + insets.left : undefined,
      }}>
      <View
        style={{
          alignItems: isNavigationRail ? 'center' : undefined,
          flex: isNavigationRail ? 1 : undefined,
          flexDirection: isNavigationRail ? 'column' : 'row',
          gap: isNavigationRail ? 8 : undefined,
          height: isNavigationRail ? undefined : showLabels ? 58 : 42,
        }}>
        {tabs}
      </View>
    </View>
  );
};

export default StreamingTabBar;
