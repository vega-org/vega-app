import {
  getNextEpisodeCheckAt,
  type EpisodeCheckSchedule,
  type ScheduledEpisodeCheck,
} from './episodeCheckSchedule';
import {
  createFollowedShowId,
  EPISODE_UPDATE_INTERVAL_OPTIONS,
  followedShowsStorage,
  type EpisodeUpdateInterval,
  type FollowedShow,
} from './storage/FollowedShowsStorage';
import useFollowedShowsStore, {syncEpisodeCheckSchedule} from './zustand/followedShowsStore';

export interface FollowedShowsBackup {
  shows: FollowedShow[];
  updateInterval?: EpisodeUpdateInterval;
  customSchedule?: EpisodeCheckSchedule;
  wifiOnly?: boolean;
  unfollowOnLibraryRemoval?: boolean;
  unfollowOnContinueWatchingRemoval?: boolean;
}

const VALID_INTERVALS = new Set<string>(
  EPISODE_UPDATE_INTERVAL_OPTIONS.map(option => option.value),
);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isValidFollowedShow = (value: unknown): value is FollowedShow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const show = value as FollowedShow;
  return (
    isNonEmptyString(show.id) &&
    isNonEmptyString(show.link) &&
    isNonEmptyString(show.provider) &&
    typeof show.providerName === 'string' &&
    isNonEmptyString(show.title) &&
    typeof show.poster === 'string' &&
    typeof show.seasonTitle === 'string' &&
    isFiniteNonNegative(show.seasonIndex) &&
    (show.episodesLink === undefined || typeof show.episodesLink === 'string') &&
    isStringArray(show.knownEpisodeKeys) &&
    isStringArray(show.knownEpisodeTitles) &&
    isFiniteNonNegative(show.knownEpisodeCount) &&
    isFiniteNonNegative(show.createdAt) &&
    isFiniteNonNegative(show.updatedAt) &&
    (show.lastCheckedAt === undefined ||
      (typeof show.lastCheckedAt === 'number' && Number.isFinite(show.lastCheckedAt))) &&
    (show.lastNotifiedAt === undefined ||
      (typeof show.lastNotifiedAt === 'number' && Number.isFinite(show.lastNotifiedAt))) &&
    (show.lastError === undefined || typeof show.lastError === 'string')
  );
};

const isValidCustomSchedule = (value: unknown): value is EpisodeCheckSchedule => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const schedule = value as Partial<ScheduledEpisodeCheck>;
  return (
    Array.isArray(schedule.days) &&
    schedule.days.length > 0 &&
    schedule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
    Number.isInteger(schedule.hour) &&
    schedule.hour! >= 0 &&
    schedule.hour! <= 23 &&
    Number.isInteger(schedule.minute) &&
    schedule.minute! >= 0 &&
    schedule.minute! <= 59 &&
    (schedule.nextAt === undefined ||
      (typeof schedule.nextAt === 'number' && Number.isFinite(schedule.nextAt) && schedule.nextAt > 0))
  );
};

export const createFollowedShowsBackup = (): FollowedShowsBackup => {
  const shows = followedShowsStorage.getFollowedShows().map(item => {
    const cleanShow: FollowedShow = {...item};
    delete cleanShow.lastError;
    return cleanShow;
  });
  const storedSchedule = followedShowsStorage.getCustomSchedule();
  return {
    shows,
    updateInterval: followedShowsStorage.getUpdateInterval(),
    ...(storedSchedule
      ? {
          customSchedule: {
            days: storedSchedule.days,
            hour: storedSchedule.hour,
            minute: storedSchedule.minute,
          },
        }
      : {}),
    wifiOnly: followedShowsStorage.isWifiOnly(),
    unfollowOnLibraryRemoval: followedShowsStorage.getUnfollowOnLibraryRemoval(),
    unfollowOnContinueWatchingRemoval:
      followedShowsStorage.getUnfollowOnContinueWatchingRemoval(),
  };
};

export const validateFollowedShowsBackup = (value: unknown): void => {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This backup contains invalid followed shows');
  }
  const backup = value as FollowedShowsBackup;
  if (!Array.isArray(backup.shows) || !backup.shows.every(isValidFollowedShow)) {
    throw new Error('This backup contains invalid followed shows');
  }
  if (
    backup.updateInterval !== undefined &&
    (typeof backup.updateInterval !== 'string' || !VALID_INTERVALS.has(backup.updateInterval))
  ) {
    throw new Error('This backup contains invalid followed shows');
  }
  if (backup.customSchedule !== undefined && !isValidCustomSchedule(backup.customSchedule)) {
    throw new Error('This backup contains invalid followed shows');
  }
  if (
    (backup.wifiOnly !== undefined && typeof backup.wifiOnly !== 'boolean') ||
    (backup.unfollowOnLibraryRemoval !== undefined &&
      typeof backup.unfollowOnLibraryRemoval !== 'boolean') ||
    (backup.unfollowOnContinueWatchingRemoval !== undefined &&
      typeof backup.unfollowOnContinueWatchingRemoval !== 'boolean')
  ) {
    throw new Error('This backup contains invalid followed shows');
  }
};

export const restoreFollowedShowsBackup = (backup?: FollowedShowsBackup): void => {
  if (backup === undefined) return;
  validateFollowedShowsBackup(backup);

  const mergedById = new Map<string, FollowedShow>();
  for (const existing of followedShowsStorage.getFollowedShows()) {
    mergedById.set(existing.id, existing);
  }
  for (const imported of backup.shows) {
    const id = imported.id || createFollowedShowId(imported.provider, imported.link);
    const normalized: FollowedShow = {...imported, id};
    delete normalized.lastError;
    const existing = mergedById.get(id);
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      mergedById.set(id, normalized);
    }
  }
  const merged = Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  followedShowsStorage.saveFollowedShows(merged);

  if (backup.customSchedule !== undefined) {
    const days = [...new Set(backup.customSchedule.days)];
    const {hour, minute} = backup.customSchedule;
    const nextAt = getNextEpisodeCheckAt({days, hour, minute});
    if (nextAt !== undefined) {
      followedShowsStorage.setCustomSchedule({days, hour, minute, nextAt});
    }
  }

  if (backup.updateInterval !== undefined) {
    if (
      backup.updateInterval === 'custom' &&
      followedShowsStorage.getCustomSchedule() === undefined
    ) {
      followedShowsStorage.setUpdateInterval('off');
    } else {
      followedShowsStorage.setUpdateInterval(backup.updateInterval);
    }
  }

  if (backup.wifiOnly !== undefined) {
    followedShowsStorage.setWifiOnly(backup.wifiOnly);
  }
  if (backup.unfollowOnLibraryRemoval !== undefined) {
    followedShowsStorage.setUnfollowOnLibraryRemoval(backup.unfollowOnLibraryRemoval);
  }
  if (backup.unfollowOnContinueWatchingRemoval !== undefined) {
    followedShowsStorage.setUnfollowOnContinueWatchingRemoval(
      backup.unfollowOnContinueWatchingRemoval,
    );
  }

  useFollowedShowsStore.getState().reloadFromStorage();
  syncEpisodeCheckSchedule().catch(() => {});
};
