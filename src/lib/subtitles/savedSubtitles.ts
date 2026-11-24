import * as FileSystem from 'expo-file-system/legacy';
import {cacheStorage} from '../storage/StorageService';
import {getEpisodeIdentity} from '../utils/episodeIdentity';

export interface SubtitleInput {
  uri: string;
  title?: string;
  language?: string;
  type?: string;
}
export interface SavedSubtitle extends SubtitleInput {
  id: string;
  videoKey: string;
  uri: string;
  originalUri: string;
  title: string;
  language: string;
  type: string;
  origin: 'search' | 'file';
  size: number;
  addedAt: number;
}

const KEY = 'savedSubtitles:v1';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_PER_VIDEO = 20;
const listeners = new Set<() => void>();
let pending: Promise<unknown> = Promise.resolve();
const directory = () => {
  if (!FileSystem.cacheDirectory) throw new Error('Subtitle cache is unavailable');
  return `${FileSystem.cacheDirectory}saved-subtitles/`;
};
const owned = (uri: string) => uri.startsWith(directory()) && /^[a-z0-9]+-[a-z0-9]+\.(srt|vtt|ttml)$/.test(uri.slice(directory().length));
const read = (): SavedSubtitle[] => {
  const value = cacheStorage.getObject<unknown>(KEY);
  return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' &&
    typeof item.videoKey === 'string' && typeof item.uri === 'string' && owned(item.uri)) : [];
};
const write = (items: SavedSubtitle[]) => {
  if (items.length) cacheStorage.setObject(KEY, items);
  else cacheStorage.delete(KEY);
  listeners.forEach(listener => listener());
};
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const result = pending.then(work, work);
  pending = result.catch(() => {});
  return result;
};
const deleteCopy = (uri: string) => owned(uri)
  ? FileSystem.deleteAsync(uri, {idempotent: true}).catch(() => {}) : Promise.resolve();

/** Stable across server switches; each episode and local video has its own entry. */
export function subtitleVideoKey(episode: any, params: any, provider: string): string {
  const identity = getEpisodeIdentity(episode) || (params?.localContent ? params.directUrl : '') || '';
  if (!identity) return '';
  return JSON.stringify([params?.providerValue || provider || '', params?.infoUrl || '', identity]);
}
export const savedSubtitleLabel = (id: string) => `vega-saved-subtitle:${id}`;
export const findSavedSubtitle = (track: any, saved: SavedSubtitle[]) => saved.find(item =>
  track?.savedSubtitleId === item.id || track?.uri === item.uri || track?.title === savedSubtitleLabel(item.id),
);
export const savedSubtitleTrack = (item: SavedSubtitle) => ({
  uri: item.uri, type: item.type, language: item.language,
  title: savedSubtitleLabel(item.id), savedSubtitleId: item.id,
});
export const subscribeSavedSubtitles = (listener: () => void) => {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
};

/** Checks only this video's small list, once on opening, never on playback ticks. */
export const loadSavedSubtitles = (videoKey: string): Promise<SavedSubtitle[]> => serialize(async () => {
  if (!videoKey) return [];
  const items = read();
  const matching = items.filter(item => item.videoKey === videoKey);
  const present = await Promise.all(matching.map(async item => ({item, exists:
    await FileSystem.getInfoAsync(item.uri).then(info => info.exists).catch(() => false)})));
  const missing = new Set(present.filter(entry => !entry.exists).map(entry => entry.item.id));
  if (missing.size) write(items.filter(item => !missing.has(item.id)));
  return present.filter(entry => entry.exists).map(entry => entry.item);
});

export const saveSubtitle = (videoKey: string, track: SubtitleInput, origin: SavedSubtitle['origin']): Promise<SavedSubtitle> => serialize(async () => {
  if (!videoKey) throw new Error('This video has no stable identity for saved subtitles');
  if (typeof track.uri !== 'string' || !/^(https?|file|content):\/\//i.test(track.uri)) throw new Error('Invalid subtitle URL');
  const items = read();
  const existing = items.find(item => item.videoKey === videoKey &&
    (item.originalUri === track.uri || item.uri === track.uri));
  if (existing && (await FileSystem.getInfoAsync(existing.uri)).exists) return existing;
  await FileSystem.makeDirectoryAsync(directory(), {intermediates: true});
  const type = ['text/vtt', 'application/ttml+xml', 'application/x-subrip'].includes(track.type || '') ? track.type! : (/\.vtt(?:\?|$)/i.test(track.uri) ? 'text/vtt' : /\.(ttml|xml|dfxp)(?:\?|$)/i.test(track.uri) ? 'application/ttml+xml' : 'application/x-subrip');
  const extension = type === 'text/vtt' ? 'vtt' : type === 'application/ttml+xml' ? 'ttml' : 'srt';
  // Clearing app cache metadata must not leave unbounded orphan copies behind.
  const names = await FileSystem.readDirectoryAsync(directory());
  await Promise.all(names.map(name => `${directory()}${name}`).filter(uri => owned(uri) && !items.some(item => item.uri === uri)).map(deleteCopy));
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2) || '0'}`;
  const uri = `${directory()}${id}.${extension}`;
  try {
    if (/^https?:/i.test(track.uri)) {
      const response = await FileSystem.downloadAsync(track.uri, uri);
      if (response.status < 200 || response.status >= 300) throw new Error(`Subtitle download failed (${response.status})`);
    } else await FileSystem.copyAsync({from: track.uri, to: uri});
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || !info.size || info.size > MAX_FILE_BYTES) throw new Error('Subtitle is empty or larger than 2 MB');
    const item: SavedSubtitle = {id, videoKey, uri, originalUri: track.uri,
      title: track.title?.trim() || 'External subtitle', language: track.language || 'und', type, origin,
      size: info.size, addedAt: Date.now()};
    let next = [item, ...items.filter(entry => entry.id !== existing?.id)];
    let perVideo = 0, bytes = 0;
    const removed: SavedSubtitle[] = existing ? [existing] : [];
    next = next.filter((entry, index) => {
      const fits = index < MAX_FILES && (entry.videoKey !== videoKey || ++perVideo <= MAX_PER_VIDEO) && bytes + entry.size <= MAX_CACHE_BYTES;
      if (fits) bytes += entry.size;
      else removed.push(entry);
      return fits;
    });
    write(next);
    await Promise.all(removed.map(entry => deleteCopy(entry.uri)));
    return item;
  } catch (error) {
    await deleteCopy(uri);
    throw error;
  }
});

/** Deletes only Vega's cache copy, never the original picked file. */
export const removeSavedSubtitle = (videoKey: string, id: string): Promise<void> => serialize(async () => {
  const items = read(), item = items.find(entry => entry.videoKey === videoKey && entry.id === id);
  if (!item) return;
  write(items.filter(entry => entry !== item));
  await deleteCopy(item.uri);
});
