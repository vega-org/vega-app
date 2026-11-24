import {create} from 'zustand';
import {
  getNextEpisodeCheckAt,
  type EpisodeCheckSchedule,
  type ScheduledEpisodeCheck,
} from '../episodeCheckSchedule';
import {
  createFollowedShowId,
  followedShowsStorage,
  getEpisodeUpdateIntervalHours,
  type EpisodeUpdateInterval,
  type FollowedShow,
} from '../storage/FollowedShowsStorage';
import {episodeCheckNative} from '../services/episodeCheckNative';

export interface FollowShowInput {
  link: string;
  provider: string;
  providerName: string;
  title: string;
  poster: string;
  seasonTitle: string;
  seasonIndex: number;
  episodesLink?: string;
  knownEpisodeKeys: string[];
  knownEpisodeTitles: string[];
  knownEpisodeCount: number;
}

export interface ShowCheckUpdate {
  episodesLink?: string;
  knownEpisodeKeys?: string[];
  knownEpisodeTitles?: string[];
  knownEpisodeCount?: number;
  lastCheckedAt: number;
  lastNotifiedAt?: number;
  lastError?: string;
}

interface FollowedShowsStore {
  shows: FollowedShow[];
  updateInterval: EpisodeUpdateInterval;
  customSchedule?: ScheduledEpisodeCheck;
  wifiOnly: boolean;
  unfollowOnLibraryRemoval: boolean;
  unfollowOnContinueWatchingRemoval: boolean;
  lastCheckedAt?: number;
  lastBackgroundCheckAt?: number;
  isChecking: boolean;
  followShow: (input: FollowShowInput) => FollowedShow;
  unfollowShow: (id: string) => void;
  unfollowAllShows: () => void;
  unfollowRemovedShows: (
    source: 'library' | 'continueWatching',
    removed: readonly Pick<FollowedShow, 'provider' | 'link'>[],
  ) => void;
  setUpdateInterval: (interval: EpisodeUpdateInterval) => void;
  setCustomSchedule: (schedule: EpisodeCheckSchedule) => void;
  advanceCustomSchedule: (completedSlot: number) => void;
  setWifiOnly: (wifiOnly: boolean) => void;
  setUnfollowOnLibraryRemoval: (enabled: boolean) => void;
  setUnfollowOnContinueWatchingRemoval: (enabled: boolean) => void;
  updateShowCheckResult: (id: string, update: ShowCheckUpdate) => void;
  setLastCheckedAt: (timestamp: number, background?: boolean) => void;
  setChecking: (checking: boolean) => void;
  reloadFromStorage: () => void;
}

const useFollowedShowsStore = create<FollowedShowsStore>()((set, get) => ({
  shows: followedShowsStorage.getFollowedShows(),
  updateInterval: followedShowsStorage.getUpdateInterval(),
  customSchedule: followedShowsStorage.getCustomSchedule(),
  wifiOnly: followedShowsStorage.isWifiOnly(),
  unfollowOnLibraryRemoval: followedShowsStorage.getUnfollowOnLibraryRemoval(),
  unfollowOnContinueWatchingRemoval: followedShowsStorage.getUnfollowOnContinueWatchingRemoval(),
  lastCheckedAt: followedShowsStorage.getLastCheckedAt(),
  lastBackgroundCheckAt: followedShowsStorage.getLastBackgroundCheckAt(),
  isChecking: false,

  followShow: input => {
    const {shows: previousShows, updateInterval, customSchedule, setCustomSchedule} = get();
    const id = createFollowedShowId(input.provider, input.link);
    const existing = previousShows.find(item => item.id === id);
    const now = Date.now();
    const record: FollowedShow = {
      id,
      link: input.link,
      provider: input.provider,
      providerName: input.providerName,
      title: input.title,
      poster: input.poster,
      seasonTitle: input.seasonTitle,
      seasonIndex: input.seasonIndex,
      episodesLink: input.episodesLink,
      knownEpisodeKeys: input.knownEpisodeKeys,
      knownEpisodeTitles: input.knownEpisodeTitles,
      knownEpisodeCount: input.knownEpisodeCount,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastCheckedAt: now,
      lastNotifiedAt: existing?.lastNotifiedAt,
      lastError: undefined,
    };
    const shows = followedShowsStorage.upsertFollowedShow(record);
    set({shows});
    if (previousShows.length === 0 && updateInterval === 'custom' && customSchedule && customSchedule.nextAt <= now) {
      setCustomSchedule(customSchedule);
    }
    return record;
  },

  unfollowShow: id => {
    const shows = followedShowsStorage.removeFollowedShow(id);
    set({shows});
  },

  unfollowAllShows: () => set({shows: followedShowsStorage.saveFollowedShows([])}),

  unfollowRemovedShows: (source, removed) => {
    const state = get();
    const enabled = source === 'library'
      ? state.unfollowOnLibraryRemoval
      : state.unfollowOnContinueWatchingRemoval;
    if (!enabled || removed.length === 0) return;

    const ids = new Set(removed.map(({provider, link}) => createFollowedShowId(provider, link)));
    const current = followedShowsStorage.getFollowedShows();
    const shows = current.filter(show => !ids.has(show.id));
    if (shows.length === current.length) return;

    set({shows: followedShowsStorage.saveFollowedShows(shows)});
    if (shows.length === 0) void syncEpisodeCheckSchedule();
  },

  setUpdateInterval: interval => {
    followedShowsStorage.setUpdateInterval(interval);
    set({updateInterval: interval});
  },

  setCustomSchedule: schedule => {
    const nextAt = getNextEpisodeCheckAt(schedule);
    if (nextAt === undefined) return;

    const customSchedule = {...schedule, nextAt};
    followedShowsStorage.setCustomSchedule(customSchedule);
    followedShowsStorage.setUpdateInterval('custom');
    set({customSchedule, updateInterval: 'custom'});
  },

  advanceCustomSchedule: completedSlot => {
    const {updateInterval, customSchedule} = get();
    if (updateInterval === 'custom' && customSchedule?.nextAt === completedSlot) {
      get().setCustomSchedule(customSchedule);
    }
  },

  setWifiOnly: wifiOnly => {
    followedShowsStorage.setWifiOnly(wifiOnly);
    set({wifiOnly});
  },

  setUnfollowOnLibraryRemoval: enabled => {
    followedShowsStorage.setUnfollowOnLibraryRemoval(enabled);
    set({unfollowOnLibraryRemoval: enabled});
  },

  setUnfollowOnContinueWatchingRemoval: enabled => {
    followedShowsStorage.setUnfollowOnContinueWatchingRemoval(enabled);
    set({unfollowOnContinueWatchingRemoval: enabled});
  },

  updateShowCheckResult: (id, update) => {
    const current = followedShowsStorage.getFollowedShows();
    let changed = false;
    const next = current.map(show => {
      if (show.id !== id) {
        return show;
      }
      changed = true;
      return {
        ...show,
        episodesLink:
          update.episodesLink !== undefined
            ? update.episodesLink
            : show.episodesLink,
        knownEpisodeKeys:
          update.knownEpisodeKeys !== undefined
            ? update.knownEpisodeKeys
            : show.knownEpisodeKeys,
        knownEpisodeTitles:
          update.knownEpisodeTitles !== undefined
            ? update.knownEpisodeTitles
            : show.knownEpisodeTitles,
        knownEpisodeCount:
          update.knownEpisodeCount !== undefined
            ? update.knownEpisodeCount
            : show.knownEpisodeCount,
        lastCheckedAt: update.lastCheckedAt,
        lastNotifiedAt:
          update.lastNotifiedAt !== undefined
            ? update.lastNotifiedAt
            : show.lastNotifiedAt,
        lastError: update.lastError,
        updatedAt: update.lastCheckedAt,
      };
    });
    if (changed) {
      followedShowsStorage.saveFollowedShows(next);
      set({shows: next});
    }
  },

  setLastCheckedAt: (timestamp, background = false) => {
    followedShowsStorage.setLastCheckedAt(timestamp);
    if (background) {
      followedShowsStorage.setLastBackgroundCheckAt(timestamp);
      set({lastCheckedAt: timestamp, lastBackgroundCheckAt: timestamp});
    } else {
      set({lastCheckedAt: timestamp});
    }
  },

  setChecking: checking => {
    set({isChecking: checking});
  },

  reloadFromStorage: () => {
    set({
      shows: followedShowsStorage.getFollowedShows(),
      updateInterval: followedShowsStorage.getUpdateInterval(),
      customSchedule: followedShowsStorage.getCustomSchedule(),
      wifiOnly: followedShowsStorage.isWifiOnly(),
      unfollowOnLibraryRemoval: followedShowsStorage.getUnfollowOnLibraryRemoval(),
      unfollowOnContinueWatchingRemoval: followedShowsStorage.getUnfollowOnContinueWatchingRemoval(),
      lastCheckedAt: followedShowsStorage.getLastCheckedAt(),
      lastBackgroundCheckAt: followedShowsStorage.getLastBackgroundCheckAt(),
    });
  },
}));

export const syncEpisodeCheckSchedule = async (): Promise<void> => {
  if (!episodeCheckNative.isAvailable()) return;

  const {shows, updateInterval, customSchedule, wifiOnly} = useFollowedShowsStore.getState();
  const hours = getEpisodeUpdateIntervalHours(updateInterval);
  try {
    if (shows.length > 0 && updateInterval === 'custom' && customSchedule) {
      await episodeCheckNative.scheduleAt(customSchedule.nextAt, wifiOnly);
    } else if (hours > 0 && shows.length > 0) {
      await episodeCheckNative.schedule(hours, wifiOnly);
    } else {
      await episodeCheckNative.cancel();
    }
  } catch (error) {
    console.warn('[EpisodeCheck] Failed to sync background schedule:', error);
  }
};

export default useFollowedShowsStore;
