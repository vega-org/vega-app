import {useCallback, useEffect, useState} from 'react';
import {Image} from 'react-native';
import {scheduleWhenIdle} from '../performance/idleWork';
import {throwIfProviderAborted} from '../sandbox/abort';
import {QueryClient, useQuery, useQueryClient} from '@tanstack/react-query';
import {getHomePageData, HomePageData} from '../getHomepagedata';
import {Content} from '../zustand/contentStore';
import {cacheStorage} from '../storage';
import {deduplicatePosts} from '../providers/deduplicatePosts';
import type {Post} from '../providers/types';

const normalizeHomePosts = (data: HomePageData[]) =>
  data.map(category => ({
    ...category,
    Posts: deduplicatePosts(category.Posts || []),
  }));

interface UseHomePageDataOptions {
  provider: Content['provider'];
  enabled?: boolean;
}

export const useHomePageData = ({
  provider,
  enabled = true,
}: UseHomePageDataOptions) => {
  const queryClient = useQueryClient();
  const scope = [
    provider.source?.author || '',
    provider.source?.url || '',
    provider.value,
    provider.version,
  ];
  const cacheKey = 'homeData:' + JSON.stringify(scope);
  const queryKey = ['homePageData', ...scope];
  const catalogOptions = {
    queryKey: ['homeCatalog', ...scope],
    queryFn: async ({signal}: {signal: AbortSignal}) => {
      const {providerManager} = await import('../services/ProviderManager');
      return providerManager.getCatalog({
        providerValue: provider.value,
        signal,
      });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  };
  const catalogQuery = useQuery({
    ...catalogOptions,
    enabled: enabled && !!provider.value,
  });
  const query = useQuery<HomePageData[], Error>({
    queryKey,
    select: normalizeHomePosts,
    queryFn: async ({signal}) => {
      const catalogs = await queryClient.fetchQuery(catalogOptions);
      return getHomePageData(provider, signal, {
        catalogs,
        previousData: queryClient.getQueryData<HomePageData[]>(queryKey),
        onCategory: data => {
          // Cancellation retains manual cache writes. Keep partial results
          // stale so returning resumes unfinished rows immediately; query
          // completion supplies the normal freshness timestamp.
          if (!signal.aborted)
            queryClient.setQueryData(queryKey, data, {updatedAt: 0});
        },
      });
    },
    enabled: enabled && !!provider.value,
    staleTime: 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: (count, error) => error.name !== 'AbortError' && count < 2,
    initialData: () => {
      const stored = cacheStorage.getString(cacheKey);
      if (!stored) return undefined;
      try {
        return JSON.parse(stored);
      } catch {
        return undefined;
      }
    },
    initialDataUpdatedAt: 0,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (
      !query.data?.length ||
      query.isFetching ||
      query.data.some(row => row.isLoading)
    )
      return;
    const task = scheduleWhenIdle(() =>
      cacheStorage.setString(cacheKey, JSON.stringify(query.data)),
    );
    return task;
  }, [cacheKey, query.data, query.isFetching]);
  return {...query, catalog: catalogQuery.data ?? []};
};

export const HERO_COUNT = 4;
const HERO_ROTATE_MS = 8000;
// Extra wait after interactions settle before the other heroes load.
const HERO_PREFETCH_DELAY_MS = 1000;
// Prefetched hero details stay fresh this long, so rotating back does not refetch.
const HERO_PREFETCH_STALE_MS = 10 * 60 * 1000;

// Hero links per provider, so tab switches and catalog refetches keep the same heroes.
const heroSelectionCache = new Map<string, string[]>();

const shuffle = <T>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Picks up to HERO_COUNT random posts from all catalogs, kept per provider. */
export const getRandomHeroPosts = (
  homeData: HomePageData[],
  providerValue?: string,
): Post[] => {
  const pool = new Map<string, Post>();
  for (const category of homeData || []) {
    for (const post of category.Posts || []) {
      if (post?.link && !pool.has(post.link)) {
        pool.set(post.link, post);
      }
    }
  }
  if (pool.size === 0) {
    return [];
  }

  const cacheKey = providerValue || 'default';
  const cached = (heroSelectionCache.get(cacheKey) || [])
    .map(link => pool.get(link))
    .filter((post): post is Post => !!post);
  if (cached.length > 0) {
    return cached;
  }

  const links = shuffle(Array.from(pool.keys())).slice(0, HERO_COUNT);
  heroSelectionCache.set(cacheKey, links);
  return links.map(link => pool.get(link)!);
};

// Function to clear hero cache when explicitly refreshing
export const clearHeroCache = (providerValue?: string) => {
  if (providerValue) {
    heroSelectionCache.delete(providerValue);
  } else {
    heroSelectionCache.clear();
  }
};

const heroMetadataKey = (heroLink: string, providerValue: string) => [
  'heroMetadata',
  heroLink,
  providerValue,
];

const heroStorageKey = (heroLink: string, providerValue: string) =>
  `heroMeta:${providerValue}:${heroLink}`;

const readStoredHeroMetadata = (heroLink: string, providerValue: string) => {
  const cached = cacheStorage.getString(
    heroStorageKey(heroLink, providerValue),
  );
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const fetchHeroMetadata = async (
  heroLink: string,
  providerValue: string,
  signal?: AbortSignal,
) => {
  const {providerManager} = await import('../services/ProviderManager');
  const {default: axios} = await import('axios');

  const info = await providerManager.getMetaData({
    link: heroLink,
    provider: providerValue,
    signal,
  });

  let result = info;
  // Only enrich providers that explicitly opt in to Cinemeta metadata.
  if (info.populateMeta === true && info.imdbId && info.type) {
    try {
      const response = await axios.get(
        `https://v3-cinemeta.strem.io/meta/${info.type}/${info.imdbId}.json`,
        {timeout: 5000, signal},
      );
      result = response.data?.meta || info;
    } catch {
      result = info; // Fallback to original info if Stremio fails
    }
  }

  throwIfProviderAborted(signal);
  cacheStorage.setString(
    heroStorageKey(heroLink, providerValue),
    JSON.stringify(result),
  );
  return result;
};

// Hook for hero metadata with React Query, instant cache load & background revalidation
export const useHeroMetadata = (heroLink: string, providerValue: string) =>
  useQuery({
    queryKey: heroMetadataKey(heroLink, providerValue),
    queryFn: ({signal}) => fetchHeroMetadata(heroLink, providerValue, signal),
    enabled: !!heroLink && !!providerValue,
    // Stored details still refresh once (initialDataUpdatedAt: 0), but a
    // rotation back to a loaded hero must not refetch it every few seconds.
    staleTime: HERO_PREFETCH_STALE_MS,
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
    // Use cached data as initial data
    initialData: () => readStoredHeroMetadata(heroLink, providerValue),
    initialDataUpdatedAt: 0,
    refetchOnMount: true,
  });

/**
 * Loads one hero's details in the background. Stored details make the hero
 * ready at once and are refreshed quietly. Resolves false when nothing could
 * be loaded.
 */
const prefetchHeroMetadata = async (
  queryClient: QueryClient,
  heroLink: string,
  providerValue: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const queryKey = heroMetadataKey(heroLink, providerValue);
  if (signal?.aborted) return false;
  const onAbort = () => {
    const query = queryClient.getQueryCache().find({queryKey, exact: true});
    if (query?.getObserversCount() === 0)
      queryClient.cancelQueries({queryKey, exact: true}).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, {once: true});
  const stored = readStoredHeroMetadata(heroLink, providerValue);
  if (
    stored !== undefined &&
    queryClient.getQueryData(queryKey) === undefined
  ) {
    queryClient.setQueryData(queryKey, stored, {updatedAt: 0});
  }
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal: querySignal}) =>
        fetchHeroMetadata(heroLink, providerValue, querySignal),
      staleTime: HERO_PREFETCH_STALE_MS,
      retry: 1,
    });
    // Measure the artwork too, so the hero shows at its final layout at once.
    const data: any = queryClient.getQueryData(queryKey);
    prefetchArtworkShape(data?.background || data?.image || data?.poster);
    return true;
  } catch {
    return queryClient.getQueryData(queryKey) !== undefined;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Rotates the hero through `posts`. The first hero's details load right after
 * the catalog; once that request is done and the app is idle, the others load
 * one at a time in the background. Only heroes whose details have loaded join
 * the rotation, so a slide never shows up half empty.
 */
/**
 * True when an image would look poor stretched across the hero: portrait or
 * square posters and small images.
 */
export const isPosterLikeArtwork = (width: number, height: number) =>
  width / height < 1.2 || width < 1000;

// Cache shape and aspect ratio by URL so artwork shown again is not
// measured again.
type ArtworkShape = {posterLike: boolean; aspectRatio?: number};
const artworkShapeCache = new Map<string, ArtworkShape>();
const measuredArtworkShape = (width: number, height: number): ArtworkShape => ({
  posterLike: isPosterLikeArtwork(width, height),
  aspectRatio: width > 0 && height > 0 ? width / height : undefined,
});

/**
 * Measures an image to decide how to show it as a backdrop. `ready` turns
 * true once the size is known, so callers can wait instead of drawing the
 * image sharp and then switching it to blurred.
 */
export const useArtworkShape = (uri: string | undefined) => {
  const [shape, setShape] = useState<ArtworkShape & {uri: string}>();
  const cached = uri ? artworkShapeCache.get(uri) : undefined;
  useEffect(() => {
    if (!uri || artworkShapeCache.has(uri)) {
      return;
    }
    let cancelled = false;
    const done = (measured: ArtworkShape) => {
      artworkShapeCache.set(uri, measured);
      if (!cancelled) {
        setShape({uri, ...measured});
      }
    };
    Image.getSize(
      uri,
      (width, height) => done(measuredArtworkShape(width, height)),
      () => done({posterLike: false}),
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  if (cached !== undefined) {
    return {ready: true, ...cached};
  }
  const ready = !!uri && shape?.uri === uri;
  return {ready, posterLike: ready && shape?.posterLike === true, aspectRatio: ready ? shape?.aspectRatio : undefined};
};

/** Measures an image ahead of time so useArtworkShape answers at once. */
export const prefetchArtworkShape = (uri: string | undefined) => {
  if (!uri || artworkShapeCache.has(uri)) {
    return;
  }
  Image.getSize(
    uri,
    (width, height) =>
      artworkShapeCache.set(uri, measuredArtworkShape(width, height)),
    () => artworkShapeCache.set(uri, {posterLike: false}),
  );
};

export const useHeroRotation = (
  posts: Post[],
  providerValue: string,
  paused: boolean,
) => {
  const queryClient = useQueryClient();
  const linksKey = posts.map(post => post.link).join('\n');
  const firstLink = posts[0]?.link || '';
  const [index, setIndex] = useState(0);
  const [readyLinks, setReadyLinks] = useState<string[]>([]);

  const firstQuery = useHeroMetadata(firstLink, providerValue);
  const firstDone =
    !!firstLink &&
    !firstQuery.isFetching &&
    (firstQuery.data !== undefined || firstQuery.isError);

  useEffect(() => {
    setIndex(0);
    setReadyLinks(firstLink ? [firstLink] : []);
  }, [linksKey, firstLink, providerValue]);

  useEffect(() => {
    if (paused || !firstDone || posts.length < 2) {
      return;
    }
    const cancelJobs = posts.slice(1).map(post =>
      scheduleWhenIdle(async signal => {
        if (signal.aborted) return;
        const ready = await prefetchHeroMetadata(
          queryClient,
          post.link,
          providerValue,
          signal,
        );
        if (!signal.aborted && ready)
          setReadyLinks(current =>
            current.includes(post.link) ? current : [...current, post.link],
          );
      }, HERO_PREFETCH_DELAY_MS),
    );
    return () => cancelJobs.forEach(cancel => cancel());
  }, [firstDone, linksKey, providerValue, queryClient, paused]);

  // Moves to the next (1) or previous (-1) hero that has loaded.
  const step = useCallback(
    (direction: 1 | -1) => {
      setIndex(current => {
        for (let offset = 1; offset <= posts.length; offset++) {
          const next =
            (current + direction * offset + posts.length * offset) %
            posts.length;
          if (readyLinks.includes(posts[next].link)) {
            return next;
          }
        }
        return current;
      });
    },
    [posts, readyLinks],
  );

  // The timer restarts on every change, so a swipe gets the full interval.
  useEffect(() => {
    if (paused || readyLinks.length < 2) {
      return;
    }
    const timer = setTimeout(() => step(1), HERO_ROTATE_MS);
    return () => clearTimeout(timer);
  }, [paused, readyLinks.length, step, index]);

  const activeIndex = index < posts.length ? index : 0;
  return {
    post: posts[activeIndex] as Post | undefined,
    activeIndex,
    readyLinks,
    step,
  };
};
