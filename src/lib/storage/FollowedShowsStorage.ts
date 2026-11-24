import {mainStorage} from './StorageService';
import type {ScheduledEpisodeCheck} from '../episodeCheckSchedule';

export type EpisodeUpdateInterval =
  | 'off'
  | '12h'
  | '24h'
  | '48h'
  | '72h'
  | '168h'
  | 'custom';

export const EPISODE_UPDATE_INTERVAL_OPTIONS = [
  {
    value: 'off',
    label: 'Off',
    description: 'Only check manually from Followed shows',
    hours: 0,
  },
  {
    value: 'custom',
    label: 'Custom schedule',
    description: 'Choose the days and time to check',
    hours: 0,
  },
  {
    value: '12h',
    label: 'Every 12 hours',
    description: 'Check twice a day in the background',
    hours: 12,
  },
  {
    value: '24h',
    label: 'Daily',
    description: 'Check once a day in the background',
    hours: 24,
  },
  {
    value: '48h',
    label: 'Every 2 days',
    description: 'Check every 48 hours in the background',
    hours: 48,
  },
  {
    value: '72h',
    label: 'Every 3 days',
    description: 'Check every 72 hours in the background',
    hours: 72,
  },
  {
    value: '168h',
    label: 'Weekly',
    description: 'Check once a week in the background',
    hours: 168,
  },
] as const;

export const getEpisodeUpdateIntervalHours = (
  interval: EpisodeUpdateInterval,
): number => {
  const match = EPISODE_UPDATE_INTERVAL_OPTIONS.find(
    option => option.value === interval,
  );
  return match?.hours ?? 0;
};

export const getEpisodeUpdateIntervalLabel = (
  interval: EpisodeUpdateInterval,
): string => {
  const match = EPISODE_UPDATE_INTERVAL_OPTIONS.find(
    option => option.value === interval,
  );
  return match?.label ?? 'Off';
};

export enum FollowedShowsKeys {
  SHOWS = 'followed-shows',
  UPDATE_INTERVAL = 'followed-shows-update-interval',
  CUSTOM_SCHEDULE = 'followed-shows-custom-schedule',
  WIFI_ONLY = 'followed-shows-wifi-only',
  UNFOLLOW_ON_LIBRARY_REMOVAL = 'followed-shows-unfollow-on-library-removal',
  UNFOLLOW_ON_CONTINUE_WATCHING_REMOVAL = 'followed-shows-unfollow-on-continue-watching-removal',
  LAST_CHECKED_AT = 'followed-shows-last-checked-at',
  LAST_BACKGROUND_CHECK_AT = 'followed-shows-last-background-check-at',
}

export interface FollowedShow {
  id: string;
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
  createdAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
  lastNotifiedAt?: number;
  lastError?: string;
}

export const createFollowedShowId = (provider: string, link: string): string =>
  `${provider}::${link}`;

const VALID_INTERVALS = new Set<string>(
  EPISODE_UPDATE_INTERVAL_OPTIONS.map(option => option.value),
);

export class FollowedShowsStorage {
  getFollowedShows(): FollowedShow[] {
    const raw =
      mainStorage.getArray<Partial<FollowedShow>>(FollowedShowsKeys.SHOWS) ||
      [];
    return raw
      .filter(
        item =>
          Boolean(
            item &&
              typeof item.link === 'string' &&
              item.link &&
              typeof item.provider === 'string' &&
              item.provider &&
              typeof item.title === 'string' &&
              item.title,
          ),
      )
      .map(item => ({
        id:
          typeof item.id === 'string' && item.id
            ? item.id
            : createFollowedShowId(item.provider!, item.link!),
        link: item.link!,
        provider: item.provider!,
        providerName: item.providerName || item.provider!,
        title: item.title!,
        poster: item.poster || '',
        seasonTitle: item.seasonTitle || 'Season 1',
        seasonIndex: typeof item.seasonIndex === 'number' ? item.seasonIndex : 0,
        episodesLink:
          typeof item.episodesLink === 'string' && item.episodesLink
            ? item.episodesLink
            : undefined,
        knownEpisodeKeys: Array.isArray(item.knownEpisodeKeys)
          ? item.knownEpisodeKeys.filter(
              (key): key is string => typeof key === 'string' && key.length > 0,
            )
          : [],
        knownEpisodeTitles: Array.isArray(item.knownEpisodeTitles)
          ? item.knownEpisodeTitles.filter(
              (title): title is string =>
                typeof title === 'string' && title.length > 0,
            )
          : [],
        knownEpisodeCount:
          typeof item.knownEpisodeCount === 'number'
            ? item.knownEpisodeCount
            : Array.isArray(item.knownEpisodeKeys)
              ? item.knownEpisodeKeys.length
              : 0,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        lastCheckedAt:
          typeof item.lastCheckedAt === 'number'
            ? item.lastCheckedAt
            : undefined,
        lastNotifiedAt:
          typeof item.lastNotifiedAt === 'number'
            ? item.lastNotifiedAt
            : undefined,
        lastError:
          typeof item.lastError === 'string' && item.lastError
            ? item.lastError
            : undefined,
      }));
  }

  saveFollowedShows(shows: FollowedShow[]): FollowedShow[] {
    mainStorage.setArray(FollowedShowsKeys.SHOWS, shows);
    return shows;
  }

  upsertFollowedShow(show: FollowedShow): FollowedShow[] {
    const existing = this.getFollowedShows();
    const index = existing.findIndex(item => item.id === show.id);
    const next =
      index >= 0
        ? existing.map(item => (item.id === show.id ? show : item))
        : [show, ...existing];
    return this.saveFollowedShows(next);
  }

  removeFollowedShow(id: string): FollowedShow[] {
    const next = this.getFollowedShows().filter(item => item.id !== id);
    return this.saveFollowedShows(next);
  }

  getUpdateInterval(): EpisodeUpdateInterval {
    const stored = mainStorage.getString(FollowedShowsKeys.UPDATE_INTERVAL);
    if (stored && VALID_INTERVALS.has(stored)) {
      return stored as EpisodeUpdateInterval;
    }
    return 'off';
  }

  setUpdateInterval(interval: EpisodeUpdateInterval): EpisodeUpdateInterval {
    mainStorage.setString(FollowedShowsKeys.UPDATE_INTERVAL, interval);
    return interval;
  }

  getCustomSchedule(): ScheduledEpisodeCheck | undefined {
    const schedule = mainStorage.getObject<ScheduledEpisodeCheck>(FollowedShowsKeys.CUSTOM_SCHEDULE);
    if (!schedule || !Array.isArray(schedule.days)) return;

    const days = [...new Set(schedule.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
    const {hour, minute, nextAt} = schedule;
    if (
      days.length === 0 ||
      !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59 ||
      !Number.isFinite(nextAt) || nextAt <= 0
    ) return;
    return {days, hour, minute, nextAt};
  }

  setCustomSchedule(schedule: ScheduledEpisodeCheck): void {
    mainStorage.setObject(FollowedShowsKeys.CUSTOM_SCHEDULE, schedule);
  }

  isWifiOnly(): boolean {
    return mainStorage.getBool(FollowedShowsKeys.WIFI_ONLY, false);
  }

  setWifiOnly(wifiOnly: boolean): boolean {
    mainStorage.setBool(FollowedShowsKeys.WIFI_ONLY, wifiOnly);
    return wifiOnly;
  }

  getUnfollowOnLibraryRemoval(): boolean {
    return mainStorage.getBool(FollowedShowsKeys.UNFOLLOW_ON_LIBRARY_REMOVAL, false);
  }

  setUnfollowOnLibraryRemoval(enabled: boolean): void {
    mainStorage.setBool(FollowedShowsKeys.UNFOLLOW_ON_LIBRARY_REMOVAL, enabled);
  }

  getUnfollowOnContinueWatchingRemoval(): boolean {
    return mainStorage.getBool(FollowedShowsKeys.UNFOLLOW_ON_CONTINUE_WATCHING_REMOVAL, false);
  }

  setUnfollowOnContinueWatchingRemoval(enabled: boolean): void {
    mainStorage.setBool(FollowedShowsKeys.UNFOLLOW_ON_CONTINUE_WATCHING_REMOVAL, enabled);
  }

  getLastCheckedAt(): number | undefined {
    const value = mainStorage.getNumber(FollowedShowsKeys.LAST_CHECKED_AT);
    return typeof value === 'number' && value > 0 ? value : undefined;
  }

  setLastCheckedAt(timestamp: number): number {
    mainStorage.setNumber(FollowedShowsKeys.LAST_CHECKED_AT, timestamp);
    return timestamp;
  }

  getLastBackgroundCheckAt(): number | undefined {
    return mainStorage.getNumber(FollowedShowsKeys.LAST_BACKGROUND_CHECK_AT);
  }

  setLastBackgroundCheckAt(timestamp: number): void {
    mainStorage.setNumber(FollowedShowsKeys.LAST_BACKGROUND_CHECK_AT, timestamp);
  }
}

export const followedShowsStorage = new FollowedShowsStorage();
