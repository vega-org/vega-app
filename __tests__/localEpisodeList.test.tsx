jest.mock('../src/lib/externalApps', () => ({openExternalApp: jest.fn().mockResolvedValue(null)}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';
const mockNavigate = jest.fn();
const mockMark = jest.fn();
const mockExternal = jest.fn().mockResolvedValue({});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (...args: any[]) => mockExternal(...args),
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({primary: '#fff', onSurface: '#fff'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/components/season/SeasonSearchSortBar', () => ({
  SeasonSearchSortBar: 'SeasonSearchSortBar',
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {isAlwaysCastMode: () => false},
}));
jest.mock('../src/lib/localContent/progress', () => ({
  markLocalEpisodesWatched: (...args: any[]) => mockMark(...args),
  readLocalProgress: () => ({position: 0, duration: 0}),
}));
jest.mock('../src/components/SeasonList', () => ({
  EpisodeCardRow: 'EpisodeCardRow',
}));
jest.mock('../src/components/tv', () => ({TVFocusable: 'TVFocusable'}));
jest.mock('../src/components/ui/DropdownField', () => 'DropdownField');
jest.mock('../src/components/ui/Text', () => 'AppText');
jest.mock('../src/components/ui/MaterialDialogSurface', () => {
  const React = require('react');
  return (props: any) =>
    props.visible ? React.createElement('Dialog', props, props.children) : null;
});
jest.mock(
  '../src/components/local-content/LocalVideoThumbnail',
  () => 'LocalVideoThumbnail',
);
jest.mock(
  '../src/components/local-content/LocalResumeCard',
  () => 'LocalResumeCard',
);
import LocalEpisodeList from '../src/components/local-content/LocalEpisodeList';
const title = {
  id: 'show',
  name: 'Show',
  rootUri: 'root',
  folderUri: 'folder',
  useMetadataTitles: false,
  episodes: [1, 2, 3].map(index => ({
    uri: `content://episode/${index}`,
    name: `Episode ${index}`,
    folder: 'Season 1',
  })),
};
let tree: renderer.ReactTestRenderer;
const row = (index: number) =>
  tree.root.findAllByType('EpisodeCardRow' as any)[index];
const press = (label: string) =>
  act(() =>
    tree.root
      .findAllByType('TVFocusable' as any)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onPress(),
  );
beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    tree = renderer.create(<LocalEpisodeList title={title} />);
  });
});
afterEach(() => act(() => tree.unmount()));
it('uses provider episode cards and opens the imported video with local playback params', () => {
  expect(tree.root.findAllByType('EpisodeCardRow' as any)).toHaveLength(3);
  act(() => row(1).props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith(
    'Player',
    expect.objectContaining({
      localContent: true,
      providerValue: 'local',
      linkIndex: 1,
    }),
  );
  expect(
    tree.root.findAllByProps({accessibilityLabel: 'Delete Episode 1'}),
  ).toHaveLength(0);
});
it('offers watched actions in episode order even when the display is reversed', () => {
  act(() =>
    tree.root.findByType('SeasonSearchSortBar' as any).props.toggleSortOrder(),
  );
  act(() => row(0).props.onLongPress());
  press('Mark previous as watched');
  expect(mockMark).toHaveBeenCalledWith(
    title,
    title.episodes.map(episode => episode.uri),
    true,
  );
});
it('marks only selected episodes and exposes cast without invoking provider extraction', () => {
  act(() => row(0).props.onLongPress());
  press('Select episodes');
  act(() => row(2).props.onPress());
  press('Mark selected as watched');
  expect(mockMark).toHaveBeenCalledWith(
    title,
    [title.episodes[0].uri, title.episodes[2].uri],
    true,
  );
  act(() => row(1).props.onLongPress());
  press('Cast');
  expect(mockNavigate).toHaveBeenCalledWith(
    'Player',
    expect.objectContaining({
      localContent: true,
      alwaysCast: true,
      linkIndex: 1,
    }),
  );
});
