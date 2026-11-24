import React from 'react';
import renderer, {act} from 'react-test-renderer';
import ProviderDrawer from '../src/components/ProviderDrawer';
import {
  FloatingTabBarInsetContext,
  getGlassTabBarClearance,
} from '../src/components/navigation/FloatingTabBarInsetContext';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 24, bottom: 28}),
}));
jest.mock('react-native-gesture-handler', () => ({ScrollView: 'DrawerScrollView'}));
jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: (select: (state: object) => unknown) =>
    select({provider: {value: ''}, installedProviders: []}),
}));
jest.mock('@expo/vector-icons', () => ({MaterialIcons: 'MaterialIcons'}));
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({primary: '#fff'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/components/tv', () => ({TVFocusGuide: 'TVFocusGuide'}));
jest.mock('../src/components/ProviderIcon', () => 'ProviderIcon');
jest.mock('../src/components/ReorderableProviderList', () => 'ReorderableProviderList');

it.each([true, false])(
  'lets the last provider scroll above the glass bar when labels are %s',
  showLabels => {
    const inset = getGlassTabBarClearance(28, showLabels);
    let tree!: renderer.ReactTestRenderer;

    const renderDrawer = (value: number) => (
      <FloatingTabBarInsetContext.Provider value={value}>
        <ProviderDrawer onClose={jest.fn()} />
      </FloatingTabBarInsetContext.Provider>
    );
    const padding = () =>
      tree.root.findByType('DrawerScrollView').props.contentContainerStyle.paddingBottom;

    act(() => {tree = renderer.create(renderDrawer(inset));});
    expect(padding()).toBe(inset);

    act(() => tree.update(renderDrawer(0)));
    expect(padding()).toBe(64);
    act(() => tree.unmount());
  },
);
