jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {getArray: () => [], getString: () => undefined, getObject: () => undefined, getBool: () => false, getNumber: () => undefined},
  createZustandStorage: () => ({getItem: () => null, setItem: jest.fn(), removeItem: jest.fn()}),
}));
jest.mock('../src/lib/storage/WatchListStorage', () => ({...jest.requireActual('../src/lib/storage/WatchListStorage') as object, watchListStorage: {
  getWatchList: () => [{title: 'Remote', link: 'https://remote/show', poster: '', provider: 'p'}],
  getCollections: () => [{id: 'watchlist', name: 'Watchlist'}],
  setItemCollections: jest.fn(), addToWatchList: jest.fn(), removeFromWatchList: jest.fn(),
}}));

import useWatchListStore from '../src/lib/zustand/watchListStore';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
import {localLibraryItem} from '../src/lib/localContent/library';
import {watchListStorage} from '../src/lib/storage/WatchListStorage';

const title = {id: 'content://folder', rootUri: 'content://folder', folderUri: 'content://folder', name: 'Local show',
  episodes: [], useMetadataTitles: true, collections: ['watchlist']};
beforeEach(() => {jest.clearAllMocks(); useLocalContentStore.setState({titles: [title]});});

it('routes library category changes to local storage while keeping the synced watchlist unchanged', () => {
  useWatchListStore.getState().setItemCollections(localLibraryItem(title), ['movies']);
  expect(useLocalContentStore.getState().titles[0].collections).toEqual(['movies']);
  expect(useWatchListStore.getState().watchList.map(item => item.link)).toEqual(['https://remote/show']);
  expect(watchListStorage.setItemCollections).not.toHaveBeenCalled();
});

it('removes a local title from Library without deleting its file index or affecting remote titles', () => {
  useWatchListStore.getState().removeItem(localLibraryItem(title).link);
  expect(useLocalContentStore.getState().titles[0].inLibrary).toBe(false);
  expect(useLocalContentStore.getState().titles[0].folderUri).toBe(title.folderUri);
  expect(useWatchListStore.getState().watchList).toHaveLength(1);
  expect(watchListStorage.removeFromWatchList).not.toHaveBeenCalled();
});
