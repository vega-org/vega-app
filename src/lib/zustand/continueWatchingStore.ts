import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import type {EpisodeLink} from '../providers/types';
import {getEpisodeIdentity} from '../utils/episodeIdentity';
import {createZustandStorage} from '../storage/StorageService';
import {getUpNextItem} from '../player/upNext';

export interface ContinueWatchingItem {
  id: string;
  title: string;
  episodeTitle?: string;
  /** Season (link group) of the episode, used by the Resume button. */
  seasonTitle?: string;
  episode: EpisodeLink;
  type: string;
  poster?: string;
  background?: string;
  providerValue: string;
  infoUrl: string;
  position: number;
  duration: number;
  updatedAt: number;
}

interface ContinueWatchingState {
  items: ContinueWatchingItem[];
  upsertItem: (item: ContinueWatchingItem) => void;
  recordLivePlayback: (id: string, episode: EpisodeLink) => void;
  updateProgress: (
    id: string,
    position: number,
    duration: number,
    episode?: EpisodeLink,
  ) => void;
  /**
   * Up next: once [episode] counts as watched, moves the show on to [next].
   * [nextProgress] is what was saved for [next] before. Returns true when the
   * entry moved; it does nothing for a movie, the last episode, an already
   * watched next episode, or an entry that holds another episode, so it can
   * be called again safely.
   */
  finishEpisode: (
    id: string,
    episode: EpisodeLink,
    next?: EpisodeLink,
    nextProgress?: {position: number; duration: number},
  ) => boolean;
  removeItem: (id: string) => void;
}

const useContinueWatchingStore = create<ContinueWatchingState>()(
  persist(
    (set, get) => ({
      items: [],
      upsertItem: item =>
        set(state => ({
          // Trim only the other items. A new show starts with updatedAt 0 and
          // would be cut right away if the list is already full.
          items: [
            item,
            ...state.items
              .filter(existing => existing.id !== item.id)
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 29),
          ].sort((a, b) => b.updatedAt - a.updatedAt),
        })),
      recordLivePlayback: (id, episode) => set(state => {
        const item = state.items.find(entry => entry.id === id &&
          getEpisodeIdentity(entry.episode) === getEpisodeIdentity(episode));
        if (!item) return state;
        const now = Date.now();
        // Keep recency without persisting a moving DVR window as resume progress.
        if (state.items[0] === item && item.position === 0 && item.duration === 0 && item.updatedAt > 0 &&
            now >= item.updatedAt && now - item.updatedAt < 5000) return state;
        return {items: state.items.map(entry => entry === item
          ? {...entry, position: 0, duration: 0, updatedAt: now} : entry)
          .sort((a, b) => b.updatedAt - a.updatedAt)};
      }),
      updateProgress: (id, position, duration, episode) =>
        set(state => ({
          items: state.items
            .map(item =>
              // The entry is per show. Skip it while it still holds another
              // episode, or that episode would get this one's position.
              item.id === id &&
              (!episode ||
                getEpisodeIdentity(item.episode) ===
                  getEpisodeIdentity(episode))
                ? {...item, position, duration, updatedAt: Date.now()}
                : item,
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        })),
      finishEpisode: (id, episode, next, nextProgress) => {
        const item = get().items.find(existing => existing.id === id);
        if (!item) {
          return false;
        }
        const upNext = getUpNextItem(item, episode, next, nextProgress);
        if (upNext === item) {
          return false;
        }
        set(state => ({
          items: state.items
            .map(existing => (existing.id === id ? upNext : existing))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));
        return true;
      },
      removeItem: id =>
        set(state => ({items: state.items.filter(item => item.id !== id)})),
    }),
    {
      name: 'continue-watching-storage',
      storage: createJSONStorage(() => createZustandStorage()),
    },
  ),
);

export default useContinueWatchingStore;
