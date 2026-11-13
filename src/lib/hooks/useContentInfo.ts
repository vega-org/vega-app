import {useEffect} from 'react';
import useMetadataOverrideStore, {metadataOverrideKey, applyMetadataOverride} from '../zustand/metadataOverrideStore';
import useLocalContentStore from '../zustand/localContentStore';
import {localContentId, localContentInfo} from '../localContent/library';
import {scanEpisodes} from '../localContent/model';
import {listLocalFolder} from '../localContent/files';
import {useQuery} from '@tanstack/react-query';
import {providerManager} from '../services/ProviderManager';
import {cacheStorage} from '../storage';
import axios from 'axios';
import {shouldShowSynopsisSkeleton} from '../synopsisLoading';

const getContentInfoCacheKey = (link: string, providerValue: string) =>
  `contentInfo:${providerValue}:${link}`;

const getEnhancedMetadataCacheKey = (imdbId: string, type: string) =>
  `enhancedMeta:${type}:${imdbId}`;

// Hook for fetching content info/metadata
export const useContentInfo = (link: string, providerValue: string, enabled = true) => {
  const cacheKey = getContentInfoCacheKey(link, providerValue);
  const query = useQuery({
    queryKey: ['contentInfo', link, providerValue],
    queryFn: async ({signal}) => {
      console.log('Fetching content info for:', link);

      const data = await providerManager.getMetaData({
        link,
        provider: providerValue,
        signal,
      });
      if (!data || (!data?.title && !data?.synopsis && !data?.image)) {
        throw new Error('Error: No data returned from provider');
      }

      return data;
    },
    enabled: enabled && !!link && !!providerValue,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: (count, error) => !error.message?.includes('WAF') && count < 1,
    initialData: () => {
      if (!enabled) return undefined;
      const cached = cacheStorage.getString(cacheKey);
      if (cached) {
        try {
          const info = JSON.parse(cached);
          // Older builds could cache hero metadata here, which has no links.
          return Array.isArray(info?.linkList) ? info : undefined;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    refetchOnMount: false,
  });

  useEffect(() => {
    if (query.data) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
    }
  }, [cacheKey, query.data]);

  return query;
};

// Hook for fetching enhanced metadata from Stremio
export const useEnhancedMetadata = (
  imdbId: string,
  type: string,
  enabled = false,
) => {
  const cacheKey = getEnhancedMetadataCacheKey(imdbId, type);
  const query = useQuery({
    queryKey: ['enhancedMeta', imdbId, type],
    queryFn: async () => {
      console.log('Fetching enhanced metadata for:', imdbId);
      try {
        // Validate imdbId and type
        if (!imdbId || !type) {
          return null;
        }
        const response = await axios.get(
          `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
          {timeout: 10000},
        );
        return response.data?.meta ?? null;
      } catch (error) {
        console.log('Error fetching enhanced metadata:', error);
        return null;
      }
    },
    enabled: enabled && !!imdbId && !!type,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    retry: 1, // Don't retry too much for external API
    initialData: () => {
      if (!enabled) {
        return undefined;
      }
      const cached =
        cacheStorage.getString(cacheKey) || cacheStorage.getString(imdbId);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    refetchOnMount: false,
  });

  useEffect(() => {
    if (query.data && imdbId) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
      cacheStorage.setString(imdbId, JSON.stringify(query.data));
    }
  }, [cacheKey, imdbId, query.data]);

  return query;
};

// Combined hook for both info and metadata
export const useContentDetails = (link: string, providerValue: string) => {
  const localId = localContentId(link);
  const localTitle = useLocalContentStore(state => state.titles.find(title => title.id === localId));
  // First, get the basic content info
  const {
    data: providerInfo,
    isLoading: infoLoading,
    isFetching: infoFetching,
    error: infoError,
    refetch: refetchInfo,
  } = useContentInfo(link, providerValue, !localId);

  const manualMetadata = useMetadataOverrideStore(state => state.overrides[metadataOverrideKey(providerValue, link)]);
  const info = providerInfo ? applyMetadataOverride(providerInfo, manualMetadata) : undefined;
  const imdbId = info?.imdbId || '';
  const contentType = info?.type || '';
  const shouldPopulateMeta = !manualMetadata && info?.populateMeta === true;

  // Only enrich providers that explicitly opt in to Cinemeta metadata.
  const {
    data: enhancedMeta,
    isLoading: enhancedMetaLoading,
    isFetching: enhancedMetaFetching,
    refetch: refetchMeta,
  } = useEnhancedMetadata(imdbId, contentType, shouldPopulateMeta);
  const meta = manualMetadata ? {...manualMetadata, name: manualMetadata.title, imdbRating: manualMetadata.rating} : shouldPopulateMeta ? enhancedMeta : null;
  const metaLoading = shouldPopulateMeta && enhancedMetaLoading;
  const metaFetching = shouldPopulateMeta && enhancedMetaFetching;

  if (localId) {
    return {
      info: localTitle ? localContentInfo(localTitle) : undefined,
      meta: localTitle?.metadata ? {...localTitle.metadata, name: localTitle.metadata.title,
        imdbRating: localTitle.metadata.rating} : null,
      localTitle,
      isLoading: false, isMetaLoading: false, isRefetching: false, isSynopsisLoading: false,
      error: localTitle ? null : new Error('This local title is no longer imported'),
      refetch: async () => {
        if (!localTitle) return;
        const episodes = await scanEpisodes(localTitle.folderUri, listLocalFolder, undefined, !localTitle.rootFilesOnly);
        // Keep edits made during the scan and never recreate a removed import.
        const latest = useLocalContentStore.getState().titles.find(title => title.id === localId);
        if (latest) useLocalContentStore.getState().saveTitles([{...latest, episodes}]);
      },
    };
  }
  return {
    localTitle: undefined,
    info,
    meta,
    isLoading: infoLoading,
    isMetaLoading: metaLoading,
    isRefetching: infoFetching || metaFetching,
    isSynopsisLoading: shouldShowSynopsisSkeleton({
      enhancedSynopsis: meta?.description,
      providerSynopsis: info?.synopsis,
      infoLoading,
      infoFetching,
      metaLoading,
      metaFetching,
    }),
    error: infoError,
    refetch: async () => {
      await refetchInfo();
      if (shouldPopulateMeta && imdbId && contentType) {
        await refetchMeta();
      }
    },
  };
};
