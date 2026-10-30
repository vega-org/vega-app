jest.mock('../src/lib/storage/StorageService', () => ({createZustandStorage: () => ({getItem: () => null, setItem: jest.fn(), removeItem: jest.fn()})}));
import React from 'react';
jest.mock('../src/lib/quickDownload', () => ({queueQuickDownload: jest.fn()}));
jest.mock('../src/lib/downloadLocation', () => ({ensureDownloadLocationAccess: jest.fn()}));
import renderer, {act} from 'react-test-renderer';

jest.mock('react-native-reanimated', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: {View},
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({value}),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    cancelAnimation: jest.fn(),
  };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
  useFocusEffect: jest.fn(),
}));
let mockIsTV = false;
const mockParts = [
  {title: 'Part 1', link: 'https://example.com/1'},
  {title: 'Part 2', link: 'https://example.com/2'},
];
jest.mock('../src/lib/tv', () => ({
  get isTV() {
    return mockIsTV;
  },
}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#FFFFFF',
}));
jest.mock('../src/components/tv', () => {
  const {View} = require('react-native');
  return {TVFocusable: View, TVFocusGuide: View};
});
jest.mock('../src/components/season/SeasonSearchSortBar', () => () => null);
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('expo-intent-launcher', () => ({}));
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ({data, renderItem}: any) => (
      <View>
        {data.map((item: unknown, index: number) => renderItem({item, index}))}
      </View>
    ),
  };
});
jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));
jest.mock('../src/components/Downloader', () => () => null);
jest.mock('../src/components/Skeleton', () => () => null);
jest.mock('../src/components/ui/DropdownField', () => () => null);
jest.mock(
  '../src/components/ui/MaterialDialogSurface',
  () =>
    ({visible, children}: {visible: boolean; children: React.ReactNode}) =>
      visible ? children : null,
);
jest.mock('../src/components/ui/LoadingIndicator', () => () => null);
jest.mock('../src/components/EpisodeRowContent', () => ({
  __esModule: true,
  default: () => null,
  getValidImageUri: () => undefined,
}));
jest.mock('../src/components/ui/Text', () => {
  const {Text} = require('react-native');
  return {__esModule: true, default: Text};
});
jest.mock('../src/lib/storage', () => ({
  cacheStorage: {getString: () => undefined, setString: jest.fn()},
  mainStorage: {getString: () => undefined, setString: jest.fn()},
  settingsStorage: {
    isHapticFeedbackEnabled: () => false,
    getExcludedQualities: () => [],
  },
}));
jest.mock('../src/lib/file/ifExists', () => ({ifExists: jest.fn()}));
jest.mock('../src/lib/hooks/useEpisodes', () => ({
  useEpisodes: (link?: string) => ({
    data: link ? mockParts : [],
    isLoading: false,
    refetch: jest.fn(),
  }),
  useStreamData: () => ({fetchStreams: jest.fn()}),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: (selector: (state: object) => unknown) => selector({downloads: {}}),
}));
jest.mock('../src/lib/zustand/continueWatchingStore', () => ({
  __esModule: true,
  default: (selector: (state: object) => unknown) => selector({items: []}),
}));
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({}),
}));
jest.mock('../src/lib/sync/syncService', () => ({
  setSyncedEpisodeProgress: jest.fn(),
}));

import SeasonList from '../src/components/SeasonList';

const props = {
  poster: {},
  type: 'series',
  metaTitle: 'Show',
  providerValue: 'vega',
  refreshing: false,
  routeParams: {link: 'https://example.com/show', provider: 'vega'},
} as any;

describe('SeasonList', () => {
  it('renders seasons after an empty list is refreshed', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<SeasonList {...props} LinkList={[]} />);
    });

    await act(async () => {
      tree!.update(
        <SeasonList
          {...props}
          LinkList={[
            {title: 'Season 1', episodesLink: 'https://example.com/s1'},
          ]}
        />,
      );
    });

    expect(JSON.stringify(tree!.toJSON())).not.toContain(
      'No Streams Available',
    );
  });

  describe.each([
    ['phone', 'episode', false, {episodesLink: 'https://example.com/s1'}],
    ['phone', 'direct link', false, {directLinks: mockParts}],
    ['TV', 'episode', true, {episodesLink: 'https://example.com/s1'}],
    ['TV', 'direct link', true, {directLinks: mockParts}],
  ])('select mode on %s %s rows', (_layout, _rows, tv, season) => {
    afterEach(() => {
      mockIsTV = false;
    });

    const findRows = (tree: renderer.ReactTestRenderer) =>
      tree.root.findAll(
        node =>
          typeof node.type !== 'string' &&
          node.props.accessibilityRole === 'button' &&
          typeof node.props.onLongPress === 'function',
        {deep: false},
      );

    it('labels rows with the selection action and state', async () => {
      mockIsTV = tv;
      let tree: renderer.ReactTestRenderer | undefined;
      await act(async () => {
        tree = renderer.create(
          <SeasonList {...props} LinkList={[{title: 'Season 1', ...season}]} />,
        );
      });

      const [first] = findRows(tree!);
      if (tv) {
        expect(first.props.accessibilityLabel).toBe('Play Part 1');
      }
      expect(first.props.accessibilityState).toBeUndefined();

      await act(async () => {
        first.props.onLongPress();
      });
      const selectButton = tree!.root.find(
        node =>
          typeof node.props.onPress === 'function' &&
          node.findAll(child => child.children.includes('Select episodes'))
            .length > 0,
        {deep: false},
      );
      await act(async () => {
        selectButton.props.onPress();
      });

      let rows = findRows(tree!);
      expect(rows.map(row => row.props.accessibilityLabel)).toEqual([
        'Deselect Part 1',
        'Select Part 2',
      ]);
      expect(rows.map(row => row.props.accessibilityState)).toEqual([
        {selected: true},
        {selected: false},
      ]);

      await act(async () => {
        rows[1].props.onPress();
      });
      rows = findRows(tree!);
      expect(rows[1].props.accessibilityLabel).toBe('Deselect Part 2');
      expect(rows[1].props.accessibilityState).toEqual({selected: true});
    });
  });
});
