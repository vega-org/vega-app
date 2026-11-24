import {listLocalFolder} from '../src/lib/localContent/files';
jest.mock('../src/lib/zustand/metadataOverrideStore', () => ({__esModule: true, default: (selector: any) => selector({overrides: {}}), metadataOverrideKey: (provider: string, link: string) => JSON.stringify([provider, link]), applyMetadataOverride: (info: any) => info}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const mockGetMetaData = jest.fn();
jest.mock('../src/lib/services/ProviderManager', () => ({providerManager: {getMetaData: (...args: unknown[]) => mockGetMetaData(...args)}}));
jest.mock('../src/lib/storage', () => ({cacheStorage: {getString: () => undefined, setString: jest.fn()}}));
jest.mock('../src/lib/storage/StorageService', () => ({createZustandStorage: () => ({getItem: () => null, setItem: jest.fn(), removeItem: jest.fn()})}));
jest.mock('../src/lib/localContent/files', () => ({listLocalFolder: jest.fn(async () => [{uri: 'file:///new.mkv', name: 'S01E02.mkv', directory: false}])}));
jest.mock('axios', () => ({get: jest.fn()}));

import {useContentDetails} from '../src/lib/hooks/useContentInfo';
import useLocalContentStore from '../src/lib/zustand/localContentStore';
import {localContentLink} from '../src/lib/localContent/library';

let details: ReturnType<typeof useContentDetails>;
let tree: renderer.ReactTestRenderer;
let client: QueryClient;
const title = {id: 'folder', rootUri: 'root', folderUri: 'folder', name: 'Folder name', useMetadataTitles: true,
  episodes: [{uri: 'file:///old.mkv', name: 'S01E01.mkv', folder: 'Default'}], collections: ['movies'],
  metadata: {imdbId: 'tt123', type: 'series' as const, title: 'Matched show', poster: 'https://poster', background: 'https://background', description: 'Synopsis'}};
const Probe = () => {details = useContentDetails(localContentLink(title.id), 'local'); return null;};
beforeEach(async () => {
  jest.clearAllMocks(); useLocalContentStore.setState({titles: [title]});
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  await act(async () => {tree = renderer.create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);});
});
afterEach(() => {act(() => tree.unmount()); client.clear();});

it('feeds imported artwork and synopsis into the existing Info page without requesting a provider', () => {
  expect(details.info).toEqual(expect.objectContaining({title: 'Matched show', synopsis: 'Synopsis', image: 'https://background', poster: 'https://poster'}));
  expect(details.meta).toEqual(expect.objectContaining({name: 'Matched show', background: 'https://background'}));
  expect(details.localTitle?.collections).toEqual(['movies']);
  expect(details.isLoading).toBe(false);
  expect(mockGetMetaData).not.toHaveBeenCalled();
});

it('refreshes files locally and preserves their metadata and category assignments', async () => {
  await act(async () => {await details.refetch();});
  expect(details.localTitle?.episodes[0].uri).toBe('file:///new.mkv');
  expect(details.localTitle?.metadata).toEqual(title.metadata);
  expect(details.localTitle?.collections).toEqual(['movies']);
  expect(mockGetMetaData).not.toHaveBeenCalled();
});

it('discovers a new season and removes files no longer in the folder', async () => {
  (listLocalFolder as jest.Mock).mockImplementationOnce(async () => [{uri: 'season2', name: 'Season 2', directory: true}])
    .mockImplementationOnce(async () => [{uri: 'new-episode', name: 'S02E01.mkv', directory: false}]);
  await act(async () => { await details.refetch(); });
  expect(details.localTitle?.episodes).toEqual([{uri: 'new-episode', name: 'S02E01.mkv', folder: 'Season 2', season: 2, episode: 1}]);
});
it('keeps edits made while a folder scan is in progress', async () => {
  let finish!: (entries: any[]) => void;
  (listLocalFolder as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    const pending = details.refetch();
    useLocalContentStore.getState().setCollections(title.id, ['updated']);
    finish([]);
    await pending;
  });
  expect(details.localTitle?.collections).toEqual(['updated']);
  expect(details.localTitle?.episodes).toEqual([]);
});
it('preserves the previous files when folder access fails', async () => {
  (listLocalFolder as jest.Mock).mockRejectedValueOnce(new Error('Folder access denied'));
  await act(async () => { await expect(details.refetch()).rejects.toThrow('Folder access denied'); });
  expect(details.localTitle?.episodes).toEqual(title.episodes);
});
