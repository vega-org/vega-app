import {create} from 'zustand';
import useLocalContentStore from './localContentStore';
import useFollowedShowsStore from './followedShowsStore';
import {localContentId, localLibraryItem} from '../localContent/library';
import {
  createCollectionId,
  getItemCollectionIds,
  watchListStorage,
  type LibraryCollection,
  type WatchListItem,
} from '../storage/WatchListStorage';

// Reuse the WatchListItem interface from our storage
export type WatchList = WatchListItem;

export type CollectionDraft = Pick<LibraryCollection, 'name' | 'icon' | 'color'>;

interface WatchListStore {
  watchList: WatchList[];
  /** Library categories, oldest first. Includes Watchlist unless deleted. */
  collections: LibraryCollection[];
  removeItem: (link: string) => void;
  addItem: (item: WatchList) => void;
  /** Replace the categories of a title. No categories removes the title. */
  setItemCollections: (item: WatchList, ids: string[]) => void;
  /** Take titles out of one category; titles left in none are removed. */
  removeFromCollection: (links: string[], collectionId: string) => void;
  createCollection: (draft: CollectionDraft) => LibraryCollection;
  updateCollection: (id: string, draft: CollectionDraft) => void;
  deleteCollection: (id: string) => void;
}

const useWatchListStore = create<WatchListStore>()((set, get) => ({
  // Initialize from storage
  watchList: watchListStorage.getWatchList(),
  collections: watchListStorage.getCollections(),

  // Remove item using storage service
  removeItem: link => {
    const id = localContentId(link);
    if (id) {useLocalContentStore.getState().hideFromLibrary(id); return;}
    const removed = get().watchList.find(item => item.link === link);
    const newWatchList = watchListStorage.removeFromWatchList(link);
    set({watchList: newWatchList});
    if (removed) {
      useFollowedShowsStore.getState().unfollowRemovedShows('library', [removed]);
    }
  },

  // Add item using storage service
  addItem: item => {
    const id = localContentId(item.link);
    if (id) {useLocalContentStore.getState().setCollections(id, item.collections || get().collections.slice(0, 1).map(c => c.id)); return;}
    const newWatchList = watchListStorage.addToWatchList(item);
    set({watchList: newWatchList});
  },

  setItemCollections: (item, ids) => {
    const id = localContentId(item.link);
    if (id) {useLocalContentStore.getState().setCollections(id, ids); return;}
    if (ids.length === 0) {
      get().removeItem(item.link);
      return;
    }
    set({watchList: watchListStorage.setItemCollections(item, ids)});
  },

  removeFromCollection: (links, collectionId) => {
    const existingIds = new Set(get().collections.map(c => c.id));
    const targets = new Set(links);
    for (const title of useLocalContentStore.getState().titles) {
      const item = localLibraryItem(title);
      if (!targets.has(item.link)) continue;
      useLocalContentStore.getState().setCollections(title.id, getItemCollectionIds(item, existingIds).filter(id => id !== collectionId));
    }
    let watchList = watchListStorage.getWatchList();
    const removed: WatchList[] = [];
    for (const item of watchList) {
      if (!targets.has(item.link)) {
        continue;
      }
      const ids = getItemCollectionIds(item, existingIds).filter(
        id => id !== collectionId,
      );
      watchList = watchListStorage.setItemCollections(item, ids);
      if (ids.length === 0) removed.push(item);
    }
    set({watchList});
    useFollowedShowsStore.getState().unfollowRemovedShows('library', removed);
  },

  createCollection: draft => {
    const now = Date.now();
    const collection: LibraryCollection = {
      id: createCollectionId(),
      name: draft.name.trim(),
      icon: draft.icon,
      color: draft.color,
      createdAt: now,
      updatedAt: now,
    };
    set({
      collections: watchListStorage.saveCollections([
        ...watchListStorage.getCollections(),
        collection,
      ]),
    });
    return collection;
  },

  updateCollection: (id, draft) => {
    set({
      collections: watchListStorage.saveCollections(
        watchListStorage
          .getCollections()
          .map(c =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  icon: draft.icon,
                  color: draft.color,
                  updatedAt: Date.now(),
                }
              : c,
          ),
      ),
    });
  },

  deleteCollection: id => {
    set(watchListStorage.deleteCollection(id));
  },
}));

export default useWatchListStore;
