import {AppState, DeviceEventEmitter} from 'react-native';
import type {EpisodeLink, Link} from '../providers/types';
import {
  getEpisodeUpdateIntervalHours,
  type FollowedShow,
} from '../storage/FollowedShowsStorage';
import useFollowedShowsStore, {syncEpisodeCheckSchedule} from '../zustand/followedShowsStore';
import {extensionManager} from './ExtensionManager';
import {providerManager} from './ProviderManager';
import notificationService from './Notification';
import {syncDohSettings} from './dohService';
import {sandboxBridge} from '../sandbox/sandboxBridge';
import {buildSandboxHtml, SANDBOX_ORIGIN} from '../sandbox/sandboxHtml';
import {SANDBOX_RUNTIME} from '../sandbox/generated/sandboxRuntime.generated';
import {
  BACKGROUND_SANDBOX_MESSAGE_EVENT,
  BACKGROUND_SANDBOX_RELOAD_EVENT,
  episodeCheckNative,
} from './episodeCheckNative';

export type EpisodeCheckTrigger = 'manual' | 'foreground' | 'background';

export interface EpisodeCheckSummary {
  checkedCount: number;
  updatedShows: number;
  newEpisodeCount: number;
  errors: number;
}

export const normalizeEpisodeTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, ' ');

export const normalizeEpisodeKey = (episode: {
  id?: string;
  link?: string;
  title?: string;
}): string => {
  const raw =
    (typeof episode.id === 'string' && episode.id.trim()) ||
    (typeof episode.link === 'string' && episode.link.trim()) ||
    (typeof episode.title === 'string' && normalizeEpisodeTitle(episode.title)) ||
    '';
  return raw;
};

export const buildEpisodeSnapshot = (
  episodes: Array<{id?: string; link?: string; title?: string}>,
): {
  knownEpisodeKeys: string[];
  knownEpisodeTitles: string[];
  knownEpisodeCount: number;
} => {
  const keys = new Set<string>();
  const titles = new Set<string>();

  for (const episode of episodes) {
    const key = normalizeEpisodeKey(episode);
    if (key) keys.add(key);
    const normalizedTitle =
      typeof episode.title === 'string'
        ? normalizeEpisodeTitle(episode.title)
        : '';
    if (normalizedTitle) titles.add(normalizedTitle);
  }

  return {
    knownEpisodeKeys: [...keys],
    knownEpisodeTitles: [...titles],
    knownEpisodeCount: keys.size,
  };
};

export const diffNewEpisodes = <
  T extends {id?: string; link?: string; title: string},
>(
  fetched: T[],
  knownEpisodeKeys: string[],
  knownEpisodeTitles: string[],
  knownEpisodeCount = knownEpisodeKeys.length,
): T[] => {
  if (fetched.length === 0) {
    return [];
  }
  if (knownEpisodeKeys.length === 0 && knownEpisodeTitles.length === 0) {
    return [];
  }
  // Older snapshots kept only 500 keys. Use one check to rebuild them.
  if (knownEpisodeCount > knownEpisodeKeys.length) return [];

  const keySet = new Set(knownEpisodeKeys);
  const titleSet = new Set(knownEpisodeTitles);
  const seenKeys = new Set<string>();

  return fetched.filter(episode => {
    const key = normalizeEpisodeKey(episode);
    if (!key || keySet.has(key) || seenKeys.has(key)) {
      return false;
    }
    const normalizedTitle = normalizeEpisodeTitle(episode.title);
    if (normalizedTitle && titleSet.has(normalizedTitle)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
};

const findMatchingSeason = (
  linkList: Link[] | undefined,
  seasonTitle: string,
  seasonIndex: number,
): Link | undefined => {
  if (!Array.isArray(linkList) || linkList.length === 0) {
    return undefined;
  }
  const exactTitle = linkList.find(item => item.title === seasonTitle);
  if (exactTitle) {
    return exactTitle;
  }
  const normalizedTarget = normalizeEpisodeTitle(seasonTitle);
  const caseInsensitive = linkList.find(
    item => normalizeEpisodeTitle(item.title) === normalizedTarget,
  );
  if (caseInsensitive) {
    return caseInsensitive;
  }
  if (seasonIndex >= 0 && seasonIndex < linkList.length) {
    return linkList[seasonIndex];
  }
  return linkList[0];
};

const directLinksToEpisodes = (season: Link): EpisodeLink[] =>
  Array.isArray(season.directLinks)
    ? season.directLinks
        .filter(item => Boolean(item && item.title && item.link))
        .map(item => ({
          title: item.title,
          link: item.link,
          description: item.description,
          image: item.image,
        }))
    : [];

export const fetchSeasonEpisodesForCheck = async (
  show: FollowedShow,
  signal?: AbortSignal,
): Promise<{episodes: EpisodeLink[]; resolvedEpisodesLink?: string}> => {
  const modules = extensionManager.getProviderModules(show.provider);
  if (!modules) {
    throw new Error(`Provider ${show.providerName} is not installed`);
  }

  const hasEpisodesModule = Boolean(modules.modules.episodes);

  if (show.episodesLink && hasEpisodesModule) {
    try {
      const episodes = await providerManager.getEpisodes({
        url: show.episodesLink,
        providerValue: show.provider,
        silent: true,
        signal,
      });
      if (Array.isArray(episodes) && episodes.length > 0) {
        return {
          episodes: episodes.filter(ep => Boolean(ep && ep.title && ep.link)),
          resolvedEpisodesLink: show.episodesLink,
        };
      }
    } catch (error) {
      if (
        isAbortError(error) ||
        isSandboxTeardownError(error) ||
        isRetryableSandboxError(error)
      ) {
        throw error;
      }
      // Fall through to refresh the season link from getInfo.
    }
  }

  const info = await providerManager.getMetaData({
    link: show.link,
    provider: show.provider,
    signal,
  });
  const season = findMatchingSeason(
    info?.linkList,
    show.seasonTitle,
    show.seasonIndex,
  );
  if (!season) {
    return {episodes: [], resolvedEpisodesLink: show.episodesLink};
  }

  if (season.episodesLink && hasEpisodesModule) {
    const episodes = await providerManager.getEpisodes({
      url: season.episodesLink,
      providerValue: show.provider,
      silent: true,
      signal,
    });
    return {
      episodes: Array.isArray(episodes)
        ? episodes.filter(ep => Boolean(ep && ep.title && ep.link))
        : [],
      resolvedEpisodesLink: season.episodesLink,
    };
  }

  return {
    episodes: directLinksToEpisodes(season),
    resolvedEpisodesLink: undefined,
  };
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const isSandboxTeardownError = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Provider sandbox was torn down';

const isRetryableSandboxError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === 'Provider sandbox reloaded' ||
    error.message === 'Provider sandbox failed to start');

let activeCheckPromise: Promise<EpisodeCheckSummary> | null = null;

export {syncEpisodeCheckSchedule} from '../zustand/followedShowsStore';

export const checkFollowedShows = async ({
  trigger,
  signal,
}: {
  trigger: EpisodeCheckTrigger;
  signal?: AbortSignal;
}): Promise<EpisodeCheckSummary> => {
  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  const run = (async (): Promise<EpisodeCheckSummary> => {
    const store = useFollowedShowsStore.getState();
    store.reloadFromStorage();
    const shows = useFollowedShowsStore.getState().shows;

    if (shows.length === 0) {
      return {
        checkedCount: 0,
        updatedShows: 0,
        newEpisodeCount: 0,
        errors: 0,
      };
    }

    store.setChecking(true);
    let checkedCount = 0;
    let updatedShows = 0;
    let newEpisodeCount = 0;
    let errors = 0;
    let abortedByLifecycle = false;
    let retriedSandboxRecovery = false;

    try {
      if (trigger === 'background') {
        await syncDohSettings().catch(() => {});
      }

      for (const show of shows) {
        if (signal?.aborted) {
          abortedByLifecycle = true;
          break;
        }
        const checkedAt = Date.now();
        try {
          let fetchResult: {episodes: EpisodeLink[]; resolvedEpisodesLink?: string};
          try {
            fetchResult = await fetchSeasonEpisodesForCheck(show, signal);
          } catch (error) {
            if (
              isRetryableSandboxError(error) &&
              !retriedSandboxRecovery &&
              sandboxBridge.isRegistered() &&
              !signal?.aborted
            ) {
              retriedSandboxRecovery = true;
              sandboxBridge.ensureReady?.();
              fetchResult = await fetchSeasonEpisodesForCheck(show, signal);
            } else {
              throw error;
            }
          }
          const {episodes, resolvedEpisodesLink} = fetchResult;
          checkedCount++;
          if (!useFollowedShowsStore.getState().shows.some(
            current => current.id === show.id && current.createdAt === show.createdAt,
          )) {
            continue;
          }

          const newEpisodes = diffNewEpisodes(
            episodes,
            show.knownEpisodeKeys,
            show.knownEpisodeTitles,
            show.knownEpisodeCount,
          );
          const snapshot =
            episodes.length > 0
              ? buildEpisodeSnapshot(episodes)
              : {
                  knownEpisodeKeys: show.knownEpisodeKeys,
                  knownEpisodeTitles: show.knownEpisodeTitles,
                  knownEpisodeCount: show.knownEpisodeCount,
                };

          let lastNotifiedAt = show.lastNotifiedAt;
          if (newEpisodes.length > 0) {
            updatedShows++;
            newEpisodeCount += newEpisodes.length;
            lastNotifiedAt = checkedAt;
            await notificationService.displayEpisodeNotification({
              show,
              newEpisodes,
            });
          }

          useFollowedShowsStore.getState().updateShowCheckResult(show.id, {
            episodesLink: resolvedEpisodesLink,
            knownEpisodeKeys: snapshot.knownEpisodeKeys,
            knownEpisodeTitles: snapshot.knownEpisodeTitles,
            knownEpisodeCount: snapshot.knownEpisodeCount,
            lastCheckedAt: checkedAt,
            lastNotifiedAt,
            lastError: undefined,
          });
        } catch (error) {
          if (isAbortError(error) || isSandboxTeardownError(error)) {
            abortedByLifecycle = true;
            break;
          }
          errors++;
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Failed to check episodes';
          useFollowedShowsStore.getState().updateShowCheckResult(show.id, {
            lastCheckedAt: checkedAt,
            lastError: message,
          });
        }
      }

      if (!abortedByLifecycle) {
        useFollowedShowsStore
          .getState()
          .setLastCheckedAt(Date.now(), trigger === 'background');
      }
      return {checkedCount, updatedShows, newEpisodeCount, errors};
    } finally {
      useFollowedShowsStore.getState().setChecking(false);
    }
  })();

  activeCheckPromise = run.finally(() => {
    activeCheckPromise = null;
  });
  return activeCheckPromise;
};

export const checkFollowedShowsIfDue = async (): Promise<void> => {
  const store = useFollowedShowsStore.getState();
  store.reloadFromStorage();
  const {shows, updateInterval, lastCheckedAt} =
    useFollowedShowsStore.getState();
  const hours = getEpisodeUpdateIntervalHours(updateInterval);
  if (hours <= 0 || shows.length === 0) {
    return;
  }
  const intervalMs = hours * 60 * 60 * 1000;
  if (lastCheckedAt && Date.now() - lastCheckedAt < intervalMs) {
    return;
  }
  await checkFollowedShows({trigger: 'foreground'});
};

export const runHeadlessEpisodeCheck = async (): Promise<void> => {
  const store = useFollowedShowsStore.getState();
  store.reloadFromStorage();
  const {shows, updateInterval, customSchedule} = useFollowedShowsStore.getState();
  if (updateInterval === 'off' || shows.length === 0) {
    return;
  }
  if (updateInterval === 'custom') {
    if (!customSchedule) return;
    if (customSchedule.nextAt > Date.now()) {
      await syncEpisodeCheckSchedule();
      return;
    }
  }

  const appState = AppState?.currentState;
  const hasReadyForeground =
    sandboxBridge.isRegistered() &&
    (sandboxBridge.isReady?.() ?? true) &&
    appState !== 'background' &&
    appState !== 'inactive';
  const attachedBackgroundSandbox =
    episodeCheckNative.isAvailable() && !hasReadyForeground;

  const html = buildSandboxHtml(SANDBOX_RUNTIME);
  let backgroundHostId: number | undefined;
  let hasRegisteredBackgroundHost = false;
  let messageSub: {remove: () => void} | undefined;
  let reloadSub: {remove: () => void} | undefined;
  let disposed = false;

  let summary: EpisodeCheckSummary | undefined;
  try {
    if (attachedBackgroundSandbox) {
      messageSub = DeviceEventEmitter.addListener(
        BACKGROUND_SANDBOX_MESSAGE_EVENT,
        (raw: string) => {
          if (!disposed) {
            sandboxBridge.handleSandboxMessage(raw, backgroundHostId);
          }
        },
      );
      reloadSub = DeviceEventEmitter.addListener(
        BACKGROUND_SANDBOX_RELOAD_EVENT,
        () => {
          if (!disposed) {
            sandboxBridge.handleReload(backgroundHostId);
            episodeCheckNative
              .startBackgroundSandbox(html, SANDBOX_ORIGIN)
              .catch(() => {});
          }
        },
      );
      backgroundHostId = sandboxBridge.register(
        script => episodeCheckNative.injectBackgroundSandbox(script),
        () => {
          if (!disposed) {
            episodeCheckNative
              .startBackgroundSandbox(html, SANDBOX_ORIGIN)
              .catch(() => {});
          }
        },
        'background',
      );
      hasRegisteredBackgroundHost = true;
      await episodeCheckNative.startBackgroundSandbox(html, SANDBOX_ORIGIN);
    }

    summary = await checkFollowedShows({trigger: 'background'});
  } finally {
    disposed = true;
    if (attachedBackgroundSandbox) {
      if (hasRegisteredBackgroundHost) {
        sandboxBridge.unregister(backgroundHostId);
      }
      messageSub?.remove();
      reloadSub?.remove();
      await episodeCheckNative.stopBackgroundSandbox().catch(() => {});
    }
  }

  if (
    updateInterval === 'custom' &&
    customSchedule &&
    summary &&
    (summary.checkedCount > 0 || summary.errors > 0)
  ) {
    store.advanceCustomSchedule(customSchedule.nextAt);
    await syncEpisodeCheckSchedule();
  }
};
