import React from 'react';
import renderer, {act} from 'react-test-renderer';
import ImportedFileDetails from '../src/screens/downloads/components/ImportedFileDetails';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
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
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({background: '#000', onSurface: '#fff'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/components/tv', () => ({
  TVFocusable: 'TVFocusable',
  TVFocusGuide: 'TVFocusGuide',
}));
jest.mock('../src/components/ui/Text', () => 'AppText');
jest.mock(
  '../src/components/local-content/LocalSeasonList',
  () => 'LocalSeasonList',
);
jest.mock(
  '../src/components/metadata/LocalMetadataDialog',
  () => 'LocalMetadataDialog',
);
jest.mock(
  '../src/components/ScreenOverlayHost',
  () =>
    ({children}: any) =>
      children,
);
it('keeps file management in Downloads and opens the imported metadata editor', () => {
  const title = {
    id: 'local',
    name: 'Folder',
    rootUri: 'root',
    folderUri: 'folder',
    useMetadataTitles: false,
    episodes: [{uri: 'content://one', name: 'File', folder: 'Season 1'}],
  };
  useLocalContentStore.setState({titles: [title]});
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ImportedFileDetails id={title.id} onBack={jest.fn()} />,
    );
  });
  expect(tree.root.findByType('LocalSeasonList' as any).props.title).toEqual(
    title,
  );
  act(() =>
    tree.root.findByType('LocalSeasonList' as any).props.onEditMetadata(),
  );
  expect(tree.root.findByType('LocalMetadataDialog' as any).props.visible).toBe(
    true,
  );
  act(() => tree.unmount());
});
