import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {providerManager} from '../services/ProviderManager';
import {cacheStorage} from '../storage';
import {EpisodeLink} from '../providers/types';
import {extensionManager} from '../services';

const getEpisodesCacheKey = (episodesLink: string, providerValue: string) =>
  `episodes:${providerValue}:${episodesLink}`;

export const useEpisodes = (
  episodesLink: string | undefined,
  providerValue: string,
  enabled: boolean = true,
) => {
  const cacheKey = episodesLink
    ? getEpisodesCacheKey(episodesLink, providerValue)
    : undefined;

  const query = useQuery<EpisodeLink[], Error>({
    queryKey: ['episodes', episodesLink, providerValue],
    queryFn: async ({signal}) => {
      if (!episodesLink || !providerValue || !enabled) {
        return [];
      }

      console.log('Fetching episodes for:', episodesLink);

      // Check if provider has episodes module
      const hasEpisodesModule =
        extensionManager.getProviderModules(providerValue)?.modules.episodes;

      console.log('Has episodes module:', !!hasEpisodesModule);

      if (!hasEpisodesModule) {
        return [];
      }

      const hasCachedEpisodes = Boolean(
        cacheKey &&
          (cacheStorage.getString(cacheKey) ||
            (episodesLink ? cacheStorage.getString(episodesLink) : undefined)),
      );
      const episodes = await providerManager.getEpisodes({
        silent: hasCachedEpisodes,
        url: episodesLink,
        providerValue: providerValue,
        signal,
      });

      return episodes || [];
    },
    enabled: enabled && !!episodesLink && !!providerValue,
    staleTime: 0,
    gcTime: 60 * 60 * 1000, // 1 hour (was cacheTime)
    retry: (failureCount, error) => {
      if (error.message?.includes('WAF')) return false;
      // Don't retry on provider/network errors
      if (failureCount >= 2) {
        return false;
      }
      return true;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    initialData: () => {
      if (!cacheKey) {
        return undefined;
      }

      const cached =
        cacheStorage.getString(cacheKey) ||
        (episodesLink ? cacheStorage.getString(episodesLink) : undefined);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
  });

  useEffect(() => {
    if (cacheKey && query.data && query.data.length > 0) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
    }
  }, [cacheKey, query.data]);

  return query;
};

// Hook for managing streams for external player
export const useStreamData = () => {
  const fetchStreams = async (
    link: string,
    type: string,
    providerValue: string,
    options?: {signal?: AbortSignal; isDownload?: boolean},
  ) => {
    const controller = new AbortController();

    try {
      const stream = await providerManager.getStream({
        link,
        type,
        signal: options?.signal ?? controller.signal,
        providerValue,
        isDownload: options?.isDownload,
      });

      return stream || [];
    } catch (error: any) {
      console.error('Error fetching streams:', error);
      const errorMessage =
        error?.message || error?.toString() || 'Failed to fetch streams';
      throw new Error(errorMessage);
    }
  };

  return {fetchStreams};
};
