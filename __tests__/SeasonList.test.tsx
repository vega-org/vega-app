jest.mock('../src/lib/externalApps', () => ({usesExternalApp: () => false, openExternalApp: jest.fn().mockResolvedValue(null)}));
jest.mock('../src/lib/torrentOwnership', () => ({releaseTorrent: jest.fn().mockResolvedValue(undefined)}));
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
const mockCacheMap = new Map<string, string>();
const mockProgressMap = new Map<string, {position: number; duration: number}>();
const mockRefetchEpisodes = jest.fn();

jest.mock('../src/lib/storage', () => ({
  cacheStorage: {
    getString: (key: string) => mockCacheMap.get(key),
    setString: jest.fn((key: string, value: string) => mockCacheMap.set(key, value)),
  },
  mainStorage: {getString: () => undefined, setString: jest.fn()},
  watchProgressStorage: {
    getProgress: (key: string) => mockProgressMap.get(key) ?? null,
    setProgress: jest.fn((key: string, position: number, duration: number) =>
      mockProgressMap.set(key, {position, duration}),
    ),
  },
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
    refetch: mockRefetchEpisodes,
  }),
  useStreamData: () => ({fetchStreams: jest.fn()}),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: (selector: (state: object) => unknown) => selector({downloads: {}}),
}));
const mockMarkContinueWatching = jest.fn();
jest.mock('../src/lib/zustand/continueWatchingStore', () => {
  const store = (selector: (state: object) => unknown) =>
    selector({items: []});
  store.getState = () => ({
    items: [],
    markEpisodesWatched: (...args: unknown[]) =>
      mockMarkContinueWatching(...args),
  });
  return {
    __esModule: true,
    default: store,
  };
});
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({}),
}));
jest.mock('../src/lib/sync/syncService', () => ({
  setSyncedEpisodeProgress: jest.fn(),
}));

import SeasonList, {EpisodeCardRow} from '../src/components/SeasonList';
import Downloader from '../src/components/Downloader';

const props = {
  poster: {},
  type: 'series',
  metaTitle: 'Show',
  providerValue: 'vega',
  refreshing: false,
  routeParams: {link: 'https://example.com/show', provider: 'vega'},
} as any;

describe('SeasonList', () => {
  it.each([
    ['series', undefined, false, 'series'],
    ['movie', undefined, false, 'movie'],
    ['movie', undefined, true, 'movie'],
    ['movie', 'series', false, 'movie'],
    ['series', 'movie', false, 'series'],
  ])('classifies direct downloads for %s with link type %s on TV=%s', async (type, linkType, tv, expected) => {
    mockIsTV = tv;
    let tree: renderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        tree = renderer.create(
          <SeasonList
            {...props}
            type={type}
            LinkList={[{title: 'Season 2', directLinks: [{title: 'S2 E1 · Risky Business', link: 'https://example.com/episode', type: linkType}]}]}
          />,
        );
      });
      const download = tree!.root.findByType(Downloader);
      expect(download.props.mediaType).toBe(expected);
      if (expected === 'series') {
        expect(download.props.fileName).toContain('Risky Business');
      }
    } finally {
      mockIsTV = false;
      await act(async () => tree?.unmount());
    }
  });

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

  it('updates Continue Watching when marking an episode watched from the long-press menu', async () => {
    mockMarkContinueWatching.mockClear();
    let tree: renderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        tree = renderer.create(
          <SeasonList
            {...props}
            LinkList={[{title: 'Season 1', episodesLink: 'https://example.com/s1'}]}
          />,
        );
      });

      const [first] = tree!.root.findAll(
        node =>
          typeof node.type !== 'string' &&
          node.props.accessibilityRole === 'button' &&
          typeof node.props.onLongPress === 'function',
        {deep: false},
      );
      await act(async () => {
        first.props.onLongPress();
      });

      const markWatchedButton = tree!.root.find(
        node =>
          typeof node.props.onPress === 'function' &&
          node.findAll(child => child.children.includes('Mark as watched'))
            .length > 0,
        {deep: false},
      );
      await act(async () => {
        markWatchedButton.props.onPress();
      });

      expect(mockMarkContinueWatching).toHaveBeenCalledTimes(1);
      expect(mockMarkContinueWatching).toHaveBeenCalledWith(
        expect.objectContaining({
          id: props.routeParams.link,
          infoUrl: props.routeParams.link,
          providerValue: props.providerValue,
          watched: true,
          markedEpisodes: [expect.objectContaining({link: mockParts[0].link})],
          seasonEpisodes: [
            expect.objectContaining({link: mockParts[0].link}),
            expect.objectContaining({link: mockParts[1].link}),
          ],
        }),
      );
    } finally {
      await act(async () => tree?.unmount());
    }
  });

  it('uses fresh LinkList season over stale ActiveSeason cache on initial mount', async () => {
    mockCacheMap.clear();
    mockProgressMap.clear();
    const staleSeason = {
      title: 'Season 2 • 2160p',
      directLinks: [
        {title: 'S2 E4 · Live Free and Die', link: 'https://example.com/e4'},
      ],
    };
    const freshSeason = {
      title: 'Season 2 • 2160p',
      directLinks: [
        {title: 'S2 E5 · Panick Attack', link: 'https://example.com/e5'},
        {title: 'S2 E4 · Live Free and Die', link: 'https://example.com/e4'},
      ],
    };
    mockCacheMap.set(
      `ActiveSeason${props.metaTitle + props.providerValue}`,
      JSON.stringify(staleSeason),
    );
    mockProgressMap.set('https://example.com/e4', {position: 100, duration: 100});

    let tree: renderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        tree = renderer.create(
          <SeasonList {...props} LinkList={[freshSeason]} />,
        );
      });

      const downloaders = tree!.root.findAllByType(Downloader);
      expect(downloaders.map(d => d.props.episodeName)).toEqual([
        'S2 E5 · Panick Attack',
        'S2 E4 · Live Free and Die',
      ]);
      expect(downloaders.map(d => d.props.downloadId)).toEqual([
        'Show_SSeason 2 • 2160p_E5',
        'Show_SSeason 2 • 2160p_E4',
      ]);

      const {View} = require('react-native');
      const rows = tree!.root.findAllByType(EpisodeCardRow);
      expect(rows.map(r => r.props.isCompleted)).toEqual([false, true]);
      const rowOpacities = rows.map(
        row =>
          row.find(
            node =>
              node.type === View && typeof node.props.style?.opacity === 'number',
          ).props.style.opacity,
      );
      expect(rowOpacities).toEqual([1, 0.6]);
    } finally {
      mockCacheMap.clear();
      mockProgressMap.clear();
      await act(async () => tree?.unmount());
    }
  });

  it('refetches episodes silently when refreshVersion increments without pull-to-refresh', async () => {
    mockRefetchEpisodes.mockClear();
    let tree: renderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        tree = renderer.create(
          <SeasonList
            {...props}
            refreshVersion={0}
            refreshing={false}
            LinkList={[{title: 'Season 1', episodesLink: 'https://example.com/s1'}]}
          />,
        );
      });
      expect(mockRefetchEpisodes).not.toHaveBeenCalled();

      await act(async () => {
        tree!.update(
          <SeasonList
            {...props}
            refreshVersion={1}
            refreshing={false}
            LinkList={[{title: 'Season 1', episodesLink: 'https://example.com/s1'}]}
          />,
        );
      });
      expect(mockRefetchEpisodes).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => tree?.unmount());
    }
  });
});
