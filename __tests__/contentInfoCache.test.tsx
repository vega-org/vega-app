jest.mock('../src/lib/zustand/metadataOverrideStore', () => ({__esModule: true, default: (selector: any) => selector({overrides: {}}), metadataOverrideKey: (provider: string, link: string) => JSON.stringify([provider, link]), applyMetadataOverride: (info: any) => info}));
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const mockCache = new Map<string, string>();
const mockGetMetaData = jest.fn();
jest.mock('../src/lib/localContent/files', () => ({listLocalFolder: jest.fn()}));

jest.mock('../src/lib/storage', () => ({
  cacheStorage: {
    getString: (key: string) => mockCache.get(key),
    setString: (key: string, value: string) => mockCache.set(key, value),
  },
}));
jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getMetaData: (args: object) => mockGetMetaData(args)},
}));
jest.mock('../src/lib/zustand/localContentStore', () => ({__esModule: true, default: (selector: any) => selector({titles: []})}));

jest.mock('axios', () => ({get: jest.fn()}));

import {useContentInfo} from '../src/lib/hooks/useContentInfo';

const link = 'https://example.com/show';
const providerInfo = {
  title: 'Show',
  synopsis: '',
  image: '',
  imdbId: '',
  type: 'series',
  linkList: [{title: 'Season 1', episodesLink: 'https://example.com/s1'}],
};

const renderInfo = async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let data: unknown;
  let tree: renderer.ReactTestRenderer | undefined;
  const Probe = () => {
    data = useContentInfo(link, 'vega').data;
    return null;
  };
  await act(async () => {
    tree = renderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    // React Query notifies through setTimeout, so wait past it.
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  act(() => tree?.unmount());
  client.clear();
  return data;
};

describe('useContentInfo cache', () => {
  beforeEach(() => {
    mockCache.clear();
    mockGetMetaData.mockReset();
    mockGetMetaData.mockResolvedValue(providerInfo);
  });

  it('fetches from the provider when the cache has no links', async () => {
    mockCache.set(link, JSON.stringify({name: 'Show', videos: []}));
    mockCache.set(
      `contentInfo:vega:${link}`,
      JSON.stringify({name: 'Show', videos: []}),
    );

    const data = await renderInfo();

    expect(mockGetMetaData).toHaveBeenCalledTimes(1);
    expect(data).toEqual(providerInfo);
  });

  it('uses fresh cached info that has links without refetching', async () => {
    mockCache.set(`contentInfo:vega:${link}`, JSON.stringify(providerInfo));
    mockCache.set(
      `contentInfo:updatedAt:vega:${link}`,
      String(Date.now()),
    );

    const data = await renderInfo();

    expect(mockGetMetaData).not.toHaveBeenCalled();
    expect(data).toEqual(providerInfo);
  });

  it('serves stale or untimestamped cache immediately and revalidates in background', async () => {
    const updatedInfo = {
      ...providerInfo,
      linkList: [
        {
          title: 'Season 2',
          directLinks: [
            {title: 'S2 E5 · Panick Attack', link: 'https://example.com/e5'},
            {title: 'S2 E4 · Live Free and Die', link: 'https://example.com/e4'},
          ],
        },
      ],
    };
    let resolveFetch!: (value: typeof updatedInfo) => void;
    mockGetMetaData.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
    );
    mockCache.set(`contentInfo:vega:${link}`, JSON.stringify(providerInfo));

    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    let observedData: unknown;
    let tree: renderer.ReactTestRenderer | undefined;
    const Probe = () => {
      observedData = useContentInfo(link, 'vega').data;
      return null;
    };

    try {
      await act(async () => {
        tree = renderer.create(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      expect(observedData).toEqual(providerInfo);
      expect(mockGetMetaData).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFetch(updatedInfo);
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      expect(observedData).toEqual(updatedInfo);
      expect(
        JSON.parse(mockCache.get(`contentInfo:vega:${link}`)!),
      ).toEqual(updatedInfo);
      expect(
        Number(mockCache.get(`contentInfo:updatedAt:vega:${link}`)),
      ).toBeGreaterThan(0);
    } finally {
      act(() => tree?.unmount());
      client.clear();
    }
  });
});
