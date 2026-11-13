import React from 'react';
import renderer, {act} from 'react-test-renderer';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
import LocalMetadataDialog from '../src/components/metadata/LocalMetadataDialog';
jest.mock('../src/lib/storage/StorageService', () => ({
  createZustandStorage: () => ({
    getItem: () => null,
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0}),
}));
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({background: '#000', onSurface: '#fff'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/components/tv', () => ({
  TVFocusable: 'TVFocusable',
  TVFocusGuide: 'TVFocusGuide',
}));
jest.mock('../src/components/ui/Text', () => 'AppText');
jest.mock('../src/components/metadata/MetadataPicker', () => ({
  MetadataPicker: 'MetadataPicker',
}));
jest.mock(
  '../src/components/metadata/MetadataEpisodeSwitch',
  () => 'MetadataEpisodeSwitch',
);
const title = {
  id: 'local',
  name: 'Folder',
  rootUri: 'root',
  folderUri: 'folder',
  useMetadataTitles: true,
  inLibrary: false,
  collections: ['saved'],
  episodes: [{uri: 'content://one', name: 'Episode 1', folder: 'Season 1'}],
  metadata: {imdbId: 'tt1', title: 'Old match', type: 'series' as const},
};
let tree: renderer.ReactTestRenderer;
const close = jest.fn();
const rescan = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  useLocalContentStore.setState({titles: [title]});
  act(() => {
    tree = renderer.create(
      <LocalMetadataDialog visible onClose={close} title={title} onRescan={rescan} />,
    );
  });
});
afterEach(() => act(() => tree.unmount()));
const press = (label: string) =>
  act(() =>
    tree.root
      .findAllByType('TVFocusable' as any)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onPress(),
  );
it('opens the imported metadata picker and preserves files, library state, and newer playback', () => {
  press('Edit metadata');
  useLocalContentStore
    .getState()
    .savePlayback(title.id, 'content://one', 12, 100);
  act(() =>
    tree.root
      .findByType('MetadataPicker' as any)
      .props.onChoose({imdbId: 'tt2', title: 'New match', type: 'series'}),
  );
  expect(useLocalContentStore.getState().titles[0]).toMatchObject({
    metadata: {imdbId: 'tt2'},
    inLibrary: false,
    collections: ['saved'],
    playback: {position: 12},
  });
  expect(useLocalContentStore.getState().titles[0].episodes).toEqual(
    title.episodes,
  );
  expect(close).toHaveBeenCalled();
});
it('can restore folder/file names without removing the imported title', () => {
  press('Use folder and file names');
  expect(useLocalContentStore.getState().titles[0]).toMatchObject({
    id: title.id,
    useMetadataTitles: false,
    episodes: title.episodes,
  });
  expect(useLocalContentStore.getState().titles[0].metadata).toBeUndefined();
});

it('offers Rescan folder in the three-dot menu and closes before scanning', () => {
  press('Rescan folder');
  expect(close).toHaveBeenCalledTimes(1);
  expect(rescan).toHaveBeenCalledTimes(1);
});
it('disables rescan while a scan is already active', () => {
  act(() => tree.update(<LocalMetadataDialog visible onClose={close} title={title} onRescan={rescan} rescanning />));
  const button = tree.root.findAllByType('TVFocusable' as any).find(node => node.props.accessibilityLabel === 'Rescan folder')!;
  expect(button.props.disabled).toBe(true);
  press('Rescan folder');
  expect(rescan).not.toHaveBeenCalled();
});
