import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import React from 'react';
import type {View} from 'react-native';
import StreamingTabBar from './StreamingTabBar';

export interface TabBarOverlayStore {
  getSnapshot: () => BottomTabBarProps | null;
  subscribe: (listener: () => void) => () => void;
  set: (next: BottomTabBarProps) => void;
}

function sameTabBarProps(
  a: BottomTabBarProps | null,
  b: BottomTabBarProps,
): boolean {
  if (!a) return false;
  return (
    a.state === b.state &&
    a.descriptors === b.descriptors &&
    a.navigation === b.navigation &&
    a.insets.top === b.insets.top &&
    a.insets.right === b.insets.right &&
    a.insets.bottom === b.insets.bottom &&
    a.insets.left === b.insets.left
  );
}

export function createTabBarOverlayStore(): TabBarOverlayStore {
  let snapshot: BottomTabBarProps | null = null;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: next => {
      if (sameTabBarProps(snapshot, next)) {
        return;
      }
      snapshot = next;
      listeners.forEach(listener => listener());
    },
  };
}

export function TabBarOverlayPublisher({
  store,
  tabBarProps,
}: {
  store: TabBarOverlayStore;
  tabBarProps: BottomTabBarProps;
}) {
  React.useLayoutEffect(() => {
    store.set(tabBarProps);
  });

  return null;
}

export function TabBarOverlayOutlet({
  store,
  blurTarget,
}: {
  store: TabBarOverlayStore;
  blurTarget?: View;
}) {
  const snapshot = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  if (!snapshot) {
    return null;
  }

  return <StreamingTabBar {...snapshot} blurTarget={blurTarget} />;
}
