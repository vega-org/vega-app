import {EpisodeLink} from '../providers/types';
import {watchProgressStorage} from '../storage';
import {setSyncedEpisodeProgress} from '../sync/syncService';
import useContinueWatchingStore from '../zustand/continueWatchingStore';

type SyncDetails = Omit<
  Parameters<typeof setSyncedEpisodeProgress>[0],
  'episode' | 'position' | 'duration'
>;

/**
 * Episodes from the start of [episodes] up to and including the one with
 * [link]. [episodes] must be in episode order, not the order the list is
 * sorted in. Returns an empty array when [link] is not in the list.
 */
export function episodesUpTo<T extends {link: string}>(
  episodes: T[],
  link: string,
): T[] {
  const index = episodes.findIndex(episode => episode.link === link);
  return index === -1 ? [] : episodes.slice(0, index + 1);
}

/**
 * Marks every episode as watched or unwatched. Progress is written for each
 * episode, but only [syncEpisode] (the last episode by default) goes to sync
 * history. Sync history keeps 50 items, so one entry per episode would push
 * other titles out of it. Also updates Continue Watching for the title.
 */
export function markEpisodesWatched<T extends EpisodeLink>(
  episodes: T[],
  watched: boolean,
  options: {
    sync: SyncDetails;
    syncEpisode?: T;
    seasonEpisodes?: EpisodeLink[];
  },
): void {
  if (episodes.length === 0) {
    return;
  }
  const position = watched ? 1 : 0;
  episodes.forEach(episode =>
    watchProgressStorage.setProgress(episode.link, position, 1),
  );
  setSyncedEpisodeProgress({
    ...options.sync,
    episode: options.syncEpisode || episodes[episodes.length - 1],
    position,
    duration: 1,
  });
  useContinueWatchingStore.getState?.()?.markEpisodesWatched?.({
    id: options.sync.infoUrl,
    title: options.sync.title,
    poster: options.sync.poster,
    background: options.sync.background,
    providerValue: options.sync.provider,
    infoUrl: options.sync.infoUrl,
    type: options.sync.type,
    seasonTitle: options.sync.seasonTitle,
    seasonEpisodes: options.seasonEpisodes || episodes,
    markedEpisodes: episodes,
    watched,
    readProgress: link => watchProgressStorage.getProgress?.(link),
  });
}
