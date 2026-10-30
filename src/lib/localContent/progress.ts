import {cacheStorage} from '../storage';
import useLocalContentStore from '../zustand/localContentStore';
import type {LocalTitle} from './model';

export function readLocalProgress(uri: string): {
  position: number;
  duration: number;
} {
  try {
    const value = JSON.parse(cacheStorage.getString(uri) || 'null');
    if (
      Number.isFinite(value?.position) &&
      Number.isFinite(value?.duration) &&
      value.duration > 0
    )
      return value;
  } catch {
    /* Old or incomplete progress must not prevent browsing. */
  }
  return {position: 0, duration: 0};
}

/** Imported file URIs stay on this device; do not send them to provider sync. */
export function markLocalEpisodesWatched(
  title: LocalTitle,
  uris: string[],
  watched: boolean,
): void {
  const valid = new Set(title.episodes.map(episode => episode.uri));
  const targets = [...new Set(uris)].filter(uri => valid.has(uri));
  if (!targets.length) return;
  for (const uri of targets)
    cacheStorage.setString(
      uri,
      JSON.stringify({position: watched ? 1 : 0, duration: 1}),
    );
  const uri = watched ? targets[targets.length - 1] : targets[0];
  // Update the local resume record too, otherwise it would override the new cache value.
  useLocalContentStore
    .getState()
    .savePlayback(title.id, uri, watched ? 1 : 0, 1);
}
