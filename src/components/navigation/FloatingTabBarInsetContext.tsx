import React from 'react';

export const GLASS_BAR_HEIGHT_WITH_LABELS = 64;
export const GLASS_BAR_HEIGHT_COMPACT = 52;
export const GLASS_BAR_BOTTOM_MARGIN = 6;
export const GLASS_BAR_MIN_BOTTOM_INSET = 10;
export const GLASS_BAR_PADDING = 4;

export function getGlassTabBarClearance(
  bottomInset: number,
  showLabels = true,
): number {
  const barHeight = showLabels
    ? GLASS_BAR_HEIGHT_WITH_LABELS
    : GLASS_BAR_HEIGHT_COMPACT;
  return (
    barHeight +
    Math.max(bottomInset, GLASS_BAR_MIN_BOTTOM_INSET) +
    GLASS_BAR_BOTTOM_MARGIN +
    12
  );
}

export const FloatingTabBarInsetContext = React.createContext<number>(0);

export const useFloatingTabBarInset = (): number =>
  React.useContext(FloatingTabBarInsetContext);

export const TAB_ROOT_SCREENS: Readonly<Record<string, string>> = {
  HomeStack: 'Home',
  SearchStack: 'Search',
  WatchListStack: 'WatchList',
  DownloadsStack: 'Downloads',
  SettingsStack: 'Settings',
};

export type RouteWithNestedState = {
  name?: string;
  state?: {
    index?: number;
    routes?: ReadonlyArray<RouteWithNestedState>;
  };
};

export function isTabRouteOnSubpage(
  route: RouteWithNestedState | undefined,
): boolean {
  const nested = route?.state;
  if (!nested) {
    return false;
  }
  const activeIndex = typeof nested.index === 'number' ? nested.index : 0;
  const activeChild = nested.routes?.[activeIndex];
  const expectedRoot =
    typeof route?.name === 'string' ? TAB_ROOT_SCREENS[route.name] : undefined;
  if (expectedRoot && typeof activeChild?.name === 'string') {
    if (activeChild.name !== expectedRoot) {
      return true;
    }
    return isTabRouteOnSubpage(activeChild);
  }
  let current: RouteWithNestedState['state'] | undefined = nested;
  while (current) {
    if (typeof current.index === 'number' && current.index > 0) {
      return true;
    }
    const index: number = typeof current.index === 'number' ? current.index : 0;
    current = current.routes?.[index]?.state;
  }
  return false;
}
