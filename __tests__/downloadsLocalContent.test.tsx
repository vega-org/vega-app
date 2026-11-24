jest.mock('../src/lib/localContent/delete', () => ({deleteLocalEpisodes: jest.fn(async () => undefined)}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), getParent: jest.fn()};
let mockDownloads: any[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0}),
}));
jest.mock('expo-status-bar', () => ({StatusBar: () => null}));
jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: {trigger: jest.fn()},
  HapticFeedbackTypes: {},
}));
jest.mock(
  '@expo/vector-icons/MaterialCommunityIcons',
  () => 'MaterialCommunityIcons',
);
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({background: '#000', primary: '#abc'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/components/tv', () => {
  const ReactMock = require('react');
  return {
    TVFocusable: ReactMock.forwardRef((props: any, ref: any) =>
      ReactMock.createElement('TVFocusable', {...props, ref}),
    ),
    TVFocusGuide: (props: any) =>
      ReactMock.createElement('TVFocusGuide', props),
  };
});
jest.mock('../src/components/MediaPosterCard', () => {
  const ReactMock = require('react');
  return {
    __esModule: true,
    default: ReactMock.forwardRef((props: any, ref: any) =>
      ReactMock.createElement('MediaPosterCard', {...props, ref}),
    ),
  };
});
jest.mock(
  '../src/screens/downloads/components/DownloadsEmptyState',
  () => 'DownloadsEmptyState',
);
jest.mock(
  '../src/screens/downloads/components/DownloadsSelectionBottomBar',
  () => () => null,
);
jest.mock(
  '../src/screens/downloads/components/DownloadsSelectionHeader',
  () => () => null,
);
jest.mock(
  '../src/screens/settings/components/CurrentDownloadsSection',
  () => () => null,
);
jest.mock(
  '../src/screens/settings/components/MissingDownloadsSection',
  () => () => null,
);
jest.mock('../src/screens/downloads/utils/deleteDownloadGroups', () => ({
  deleteDownloadedMediaGroups: jest.fn(),
}));
jest.mock('../src/lib/hooks/useDownloadsMaintenance', () => ({
  useDownloadsMaintenance: jest.fn(),
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {isHapticFeedbackEnabled: () => false},
}));
jest.mock('../src/lib/storage/StorageService', () => ({
  createZustandStorage: () => ({
    getItem: () => null,
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }),
}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({
  __esModule: true,
  default: (selector: any) => selector(mockDownloads),
  selectCompletedDownloads: (items: any[]) => items,
  selectCurrentDownloads: () => [],
}));

import Downloads from '../src/screens/downloads/Downloads';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
import {localContentLink} from '../src/lib/localContent/library';

const localTitle = (id: string, name: string, extra = {}) => ({
  id,
  rootUri: id,
  folderUri: id,
  name,
  episodes: [{uri: `${id}/movie.mkv`, name: 'movie.mkv', folder: 'Default'}],
  useMetadataTitles: true,
  ...extra,
});

let tree: renderer.ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = renderer.create(<Downloads />);
  });
};
const cardTitles = () =>
  tree.root
    .findAllByType('MediaPosterCard' as any)
    .map(card => card.props.title);
const emptyStates = () => tree.root.findAllByType('DownloadsEmptyState' as any);

beforeEach(() => {
  jest.clearAllMocks();
  mockDownloads = [];
  useLocalContentStore.setState({titles: []});
});
afterEach(() => {
  act(() => tree.unmount());
});

it('lists imported local content when nothing has been downloaded', async () => {
  useLocalContentStore.setState({
    titles: [
      localTitle('content://movie', 'movie.folder', {
        metadata: {
          imdbId: 'tt1',
          type: 'movie',
          title: 'Matched movie',
          poster: 'https://poster',
        },
      }),
      localTitle('content://show', 'Show folder'),
      localTitle('content://hidden', 'Removed from library', {
        inLibrary: false,
      }),
    ],
  });
  await render();

  expect(cardTitles()).toEqual(['Matched movie', 'Show folder']);
  expect(emptyStates()).toHaveLength(0);

  act(() => {
    tree.root.findAllByType('MediaPosterCard' as any)[0].props.onPress();
  });
  expect(mockNavigation.navigate).toHaveBeenCalledWith('DownloadedDetails', {
    localTitleId: 'content://movie',
  });
});

it('shows local content after downloaded titles', async () => {
  mockDownloads = [
    {
      id: 'download-1',
      title: 'Downloaded movie',
      status: 'completed',
      type: 'movie',
    },
  ];
  useLocalContentStore.setState({
    titles: [localTitle('content://show', 'Show folder')],
  });
  await render();

  expect(cardTitles()).toEqual(['Downloaded movie', 'Show folder']);
  expect(emptyStates()).toHaveLength(0);
});

it('shows the empty state only without downloads or local content', async () => {
  await render();

  expect(cardTitles()).toEqual([]);
  expect(emptyStates()).toHaveLength(1);
});
