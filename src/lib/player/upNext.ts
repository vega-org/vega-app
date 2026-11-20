import type {EpisodeLink} from '../providers/types';
import {getEpisodeIdentity} from '../utils/episodeIdentity';
import type {ContinueWatchingItem} from '../zustand/continueWatchingStore';

/**
 * Share of an episode after which it counts as watched. The episode list
 * ticks it off, the Resume card offers the next episode instead, and the
 * player starts it over rather than resuming near the end.
 */
export const WATCHED_FRACTION = 0.85;

export const isWatched = (position = 0, duration = 0): boolean =>
  Number.isFinite(position) &&
  Number.isFinite(duration) &&
  duration > 0 &&
  position / duration > WATCHED_FRACTION;

/** The episode after [current] in [episodes], if there is one. */
export const getNextEpisode = <T extends EpisodeLink>(
  episodes: T[] | undefined,
  current: EpisodeLink | undefined,
): T | undefined => {
  if (!episodes || !current) {
    return undefined;
  }
  const identity = getEpisodeIdentity(current);
  const index = episodes.findIndex(
    episode =>
      episode === current ||
      (identity !== '' && getEpisodeIdentity(episode) === identity),
  );
  return index < 0 ? undefined : episodes[index + 1];
};

/**
 * The Continue Watching entry once [finished] has been watched: the show
 * moves on to [next], newest in the list. [nextProgress] is what was saved
 * for [next] before; a partly watched next episode keeps it, so Resume
 * continues there.
 *
 * Returns [item] itself when nothing changes: the entry holds another
 * episode (it already moved on, so calling this again is harmless), the
 * episode is not watched yet, it is a movie, there is no next episode, or the
 * next episode is already watched (a rewatch keeps its watched history).
 */
export const getUpNextItem = (
  item: ContinueWatchingItem,
  finished: EpisodeLink,
  next: EpisodeLink | undefined,
  nextProgress = {position: 0, duration: 0},
  now = Date.now(),
): ContinueWatchingItem => {
  const finishedId = getEpisodeIdentity(finished);
  if (
    !next ||
    item.type === 'movie' ||
    !finishedId ||
    getEpisodeIdentity(item.episode) !== finishedId ||
    getEpisodeIdentity(next) === finishedId ||
    !isWatched(item.position, item.duration) ||
    isWatched(nextProgress.position, nextProgress.duration)
  ) {
    return item;
  }
  const resume = nextProgress.position > 0 && nextProgress.duration > 0;
  return {
    ...item,
    episode: next,
    episodeTitle: next.title || item.seasonTitle,
    position: resume ? nextProgress.position : 0,
    duration: resume ? nextProgress.duration : 0,
    // Later than the last progress save of the finished episode, so synced
    // devices pick the next episode as the latest one of this show.
    updatedAt: Math.max(now, item.updatedAt + 1),
  };
};

/**
 * Entries shown in the Continue Watching row, latest first. Watched movies
 * are left out. A show stays even on its last listed episode, as the next
 * season may be on the Info page.
 */
export const getContinueWatchingRow = (
  items: ContinueWatchingItem[],
): ContinueWatchingItem[] =>
  items
    .filter(
      item =>
        Boolean(item.providerValue) &&
        !(item.type === 'movie' && isWatched(item.position, item.duration)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

export interface ManualWatchContext {
  id: string;
  title: string;
  poster?: string;
  background?: string;
  providerValue: string;
  infoUrl: string;
  type: string;
  seasonTitle?: string;
  /** All episodes of the active season in episode order (ascending). */
  seasonEpisodes: EpisodeLink[];
  /** Episodes that were manually marked watched or unwatched. */
  markedEpisodes: EpisodeLink[];
  watched: boolean;
  readProgress: (
    link: string,
  ) => {position: number; duration: number} | null | undefined;
  now?: number;
}

const sameEpisode = (a?: EpisodeLink, b?: EpisodeLink): boolean => {
  if (!a || !b) {
    return false;
  }
  const idA = getEpisodeIdentity(a);
  const idB = getEpisodeIdentity(b);
  if (idA && idB && idA === idB) {
    return true;
  }
  const linkA = a.sourceLink || a.link;
  const linkB = b.sourceLink || b.link;
  return Boolean(linkA && linkB && linkA === linkB);
};

/**
 * Computes the next Continue Watching entry after episodes are manually marked
 * watched or unwatched from the Info screen. Returns [existing] itself when no
 * change is needed.
 */
export const getContinueWatchingAfterMark = (
  existing: ContinueWatchingItem | undefined,
  context: ManualWatchContext,
): ContinueWatchingItem | undefined => {
  const {
    id,
    title,
    poster,
    background,
    providerValue,
    infoUrl,
    type,
    seasonTitle,
    seasonEpisodes,
    markedEpisodes,
    watched,
    readProgress,
    now = Date.now(),
  } = context;

  if (markedEpisodes.length === 0) {
    return existing;
  }

  const episodes = seasonEpisodes.length > 0 ? seasonEpisodes : markedEpisodes;
  let firstMarkedIndex = -1;
  let lastMarkedIndex = -1;
  for (let i = 0; i < episodes.length; i++) {
    if (markedEpisodes.some(marked => sameEpisode(marked, episodes[i]))) {
      if (firstMarkedIndex < 0) {
        firstMarkedIndex = i;
      }
      lastMarkedIndex = i;
    }
  }
  if (lastMarkedIndex < 0) {
    return existing;
  }

  const isMovie = (existing?.type || type) === 'movie';

  if (isMovie) {
    if (!existing) {
      return existing;
    }
    const touchesExisting =
      markedEpisodes.some(marked => sameEpisode(marked, existing.episode)) ||
      episodes.length <= 1;
    if (!touchesExisting) {
      return existing;
    }
    if (watched) {
      if (isWatched(existing.position, existing.duration)) {
        return existing;
      }
      const duration = existing.duration > 1 ? existing.duration : 1;
      return {
        ...existing,
        position: duration,
        duration,
        updatedAt: Math.max(now, existing.updatedAt + 1),
      };
    }
    if (existing.position === 0 && existing.duration === 0) {
      return existing;
    }
    return {
      ...existing,
      position: 0,
      duration: 0,
      updatedAt: Math.max(now, existing.updatedAt + 1),
    };
  }

  const currentIndex = existing
    ? episodes.findIndex(episode => sameEpisode(episode, existing.episode))
    : -1;

  if (!watched) {
    if (!existing) {
      return existing;
    }
    const firstMarked = episodes[firstMarkedIndex];
    const isCurrentMarked = markedEpisodes.some(marked =>
      sameEpisode(marked, existing.episode),
    );
    const shouldRewindToEarlier =
      !isCurrentMarked &&
      currentIndex >= 0 &&
      firstMarkedIndex < currentIndex &&
      (existing.position <= 0 || isWatched(existing.position, existing.duration));

    if (!isCurrentMarked && !shouldRewindToEarlier) {
      return existing;
    }
    if (
      sameEpisode(firstMarked, existing.episode) &&
      existing.position === 0 &&
      existing.duration === 0
    ) {
      return existing;
    }
    return {
      ...existing,
      episode: firstMarked,
      episodeTitle: firstMarked.title || seasonTitle || existing.seasonTitle,
      seasonTitle: seasonTitle ?? existing.seasonTitle,
      position: 0,
      duration: 0,
      updatedAt: Math.max(now, existing.updatedAt + 1),
    };
  }

  // Series + watched === true
  const isEpisodeWatched = (episode: EpisodeLink): boolean => {
    if (markedEpisodes.some(marked => sameEpisode(marked, episode))) {
      return true;
    }
    const progress = readProgress(episode.sourceLink || episode.link);
    return isWatched(progress?.position, progress?.duration);
  };

  let nextUnwatched: EpisodeLink | undefined;
  for (let i = lastMarkedIndex + 1; i < episodes.length; i++) {
    if (!isEpisodeWatched(episodes[i])) {
      nextUnwatched = episodes[i];
      break;
    }
  }

  if (!existing) {
    if (!nextUnwatched || !infoUrl || !providerValue) {
      return existing;
    }
    const nextProgress = readProgress(
      nextUnwatched.sourceLink || nextUnwatched.link,
    );
    const resume =
      nextProgress && nextProgress.position > 0 && nextProgress.duration > 0;
    return {
      id,
      title,
      episodeTitle: nextUnwatched.title || seasonTitle,
      seasonTitle,
      episode: nextUnwatched,
      type,
      poster,
      background,
      providerValue,
      infoUrl,
      position: resume ? nextProgress.position : 0,
      duration: resume ? nextProgress.duration : 0,
      updatedAt: now,
    };
  }

  // Do not drag Continue Watching backward when marking an earlier episode.
  if (currentIndex >= 0 && lastMarkedIndex < currentIndex) {
    return existing;
  }

  // If Continue Watching points to an unwatched episode in another season,
  // finishing a different season without a next episode should not clobber it.
  if (
    currentIndex < 0 &&
    !nextUnwatched &&
    !isWatched(existing.position, existing.duration)
  ) {
    return existing;
  }

  if (nextUnwatched) {
    const nextProgress = readProgress(
      nextUnwatched.sourceLink || nextUnwatched.link,
    );
    const resume =
      nextProgress && nextProgress.position > 0 && nextProgress.duration > 0;
    return {
      ...existing,
      episode: nextUnwatched,
      episodeTitle: nextUnwatched.title || seasonTitle || existing.seasonTitle,
      seasonTitle: seasonTitle ?? existing.seasonTitle,
      position: resume ? nextProgress.position : 0,
      duration: resume ? nextProgress.duration : 0,
      updatedAt: Math.max(now, existing.updatedAt + 1),
    };
  }

  const lastMarked = episodes[lastMarkedIndex];
  if (sameEpisode(lastMarked, existing.episode)) {
    if (isWatched(existing.position, existing.duration)) {
      return existing;
    }
    const duration = existing.duration > 1 ? existing.duration : 1;
    return {
      ...existing,
      position: duration,
      duration,
      updatedAt: Math.max(now, existing.updatedAt + 1),
    };
  }

  return {
    ...existing,
    episode: lastMarked,
    episodeTitle: lastMarked.title || seasonTitle || existing.seasonTitle,
    seasonTitle: seasonTitle ?? existing.seasonTitle,
    position: 1,
    duration: 1,
    updatedAt: Math.max(now, existing.updatedAt + 1),
  };
};

