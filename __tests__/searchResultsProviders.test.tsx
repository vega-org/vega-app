import React from 'react';
import renderer, {act} from 'react-test-renderer';
import SearchResults from '../src/screens/SearchResults';
import {providerManager} from '../src/lib/services/ProviderManager';

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getSearchPosts: jest.fn()},
}));
jest.mock('../src/lib/zustand/contentStore', () => {
  const state = {
    provider: {value: 'c'},
    installedProviders: ['a', 'b', 'c', 'd', 'e'].map(value => ({
      value,
      display_name: value.toUpperCase(),
    })),
  };
  const useStore = (select: any) => select(state);
  useStore.getState = () => state;
  return {__esModule: true, default: useStore};
});
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('../src/components/Slider', () => 'Slider');
jest.mock(
  '../src/components/ui/ScreenSafeArea',
  () => require('react-native').View,
);
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/LoadingIndicator', () => 'LoadingIndicator');
jest.mock('../src/components/ui/IconButton', () => 'IconButton');
jest.mock('../src/components/ui/Button', () => 'Button');
jest.mock('../src/components/tv', () => ({
  TVFocusGuide: require('react-native').View,
  TVFocusable: require('react-native').View,
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

const getSearchPosts = jest.mocked(providerManager.getSearchPosts);
let pending: Record<
  string,
  {resolve: (posts: any[]) => void; reject: (error: Error) => void}
>;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  pending = {};
  getSearchPosts.mockReset();
  getSearchPosts.mockImplementation(
    ({providerValue, signal}) =>
      new Promise((resolve, reject) => {
        pending[providerValue] = {resolve, reject};
        signal.addEventListener('abort', () =>
          reject(new Error('Provider request aborted')),
        );
      }),
  );
});
afterEach(() => jest.restoreAllMocks());

const props: any = {
  route: {params: {filter: 'dune'}},
  navigation: {goBack: jest.fn(), setParams: jest.fn()},
};
const flush = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
const searched = () =>
  getSearchPosts.mock.calls.map(([args]) => args.providerValue);
const text = (tree: renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());

it('searches two providers at a time and reveals failed rows only when expanded', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SearchResults {...props} />);
  });
  expect(searched()).toEqual(['c', 'a']);
  pending.c.reject(new Error('Blocked by captcha'));
  pending.a.resolve([{title: 'Dune', link: 'dune', image: ''}]);
  await flush();
  expect(searched()).toEqual(['c', 'a', 'b', 'd']);
  expect(tree.root.findAllByType('Slider' as any).map(row => row.props.title)).toEqual(['A']);
  const toggle = tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})[0];
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  act(() => toggle.props.onPress());
  const rows = tree.root.findAllByType('Slider' as any);
  expect(rows.map(row => [row.props.title, row.props.error])).toEqual([
    ['A', undefined],
    ['C', 'Blocked by captcha'],
  ]);
  act(() => tree.unmount());
});

it('says how many sources failed and retries only those', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SearchResults {...props} />);
  });
  for (const value of ['c', 'a', 'b', 'd']) {
    pending[value].reject(new Error('Network error'));
    await flush();
  }
  pending.e.resolve([]);
  await flush();
  expect(text(tree)).toContain('4 sources failed to search.');
  const retry = tree.root.findByType('Button' as any);
  expect(retry.props.children).toBe('Retry failed (4)');
  getSearchPosts.mockClear();
  act(() => retry.props.onPress());
  await flush();
  expect(searched()).toEqual(['c', 'a']);
  pending.c.resolve([]);
  pending.a.resolve([]);
  await flush();
  expect(searched()).toEqual(['c', 'a', 'b', 'd']);
  act(() => tree.unmount());
});

it('does not claim no results when every source failed', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SearchResults {...props} />);
  });
  for (const value of ['c', 'a', 'b', 'd', 'e']) {
    pending[value].reject(new Error('Network error'));
    await flush();
  }
  expect(text(tree)).not.toContain('No results found');
  expect(text(tree)).toContain('Could not search for');
  expect(text(tree)).toContain('5 sources failed to search.');
  act(() => tree.unmount());
});

it('toggles empty provider rows and collapses them for a new query', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<SearchResults {...props} />);});
  pending.c.resolve([]);
  pending.a.resolve([{title: 'Dune', link: 'dune', image: ''}]);
  await flush();
  expect(tree.root.findAllByType('Slider' as any).map(row => row.props.title)).toEqual(['A']);
  act(() => tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})[0].props.onPress());
  expect(tree.root.findAllByType('Slider' as any).map(row => row.props.title)).toEqual(['A', 'C']);
  act(() => tree.root.findAllByProps({accessibilityLabel: 'Hide empty results'})[0].props.onPress());
  expect(tree.root.findAllByType('Slider' as any).map(row => row.props.title)).toEqual(['A']);
  act(() => tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})[0].props.onPress());
  await act(async () => {tree.update(<SearchResults {...props} route={{params: {filter: 'Saw'}}} />);});
  pending.c.resolve([]);
  await flush();
  const toggle = tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})[0];
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  expect(tree.root.findAllByType('Slider' as any)).toHaveLength(0);
  act(() => tree.unmount());
});

it('does not show the expander when providers have not returned empty results or errors', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<SearchResults {...props} />);});
  expect(tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})).toHaveLength(0);
  pending.c.resolve([{title: 'Dune', link: 'dune', image: ''}]);
  await flush();
  expect(tree.root.findAllByProps({accessibilityLabel: 'Show empty results'})).toHaveLength(0);
  act(() => tree.unmount());
});
