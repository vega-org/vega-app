import {useCallback, useEffect, useRef, useState} from 'react';
import {
  loadSavedSubtitles, removeSavedSubtitle, saveSubtitle, subscribeSavedSubtitles,
  type SavedSubtitle, type SubtitleInput,
} from '../subtitles/savedSubtitles';

export function useSavedSubtitles(videoKey: string) {
  const [state, setState] = useState<{key: string; items: SavedSubtitle[]}>({key: videoKey, items: []});
  const mounted = useRef(false);
  const currentKey = useRef(videoKey);
  currentKey.current = videoKey;
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const refresh = () => {void loadSavedSubtitles(videoKey).then(items => {
      if (!cancelled) setState({key: videoKey, items});
    }).catch(error => console.warn('Could not read saved subtitles:', error));};
    const unsubscribe = subscribeSavedSubtitles(refresh);
    refresh();
    return () => {mounted.current = false; cancelled = true; unsubscribe();};
  }, [videoKey]);
  const add = useCallback(async (track: SubtitleInput, origin: SavedSubtitle['origin']) => {
    const key = videoKey;
    const saved = await saveSubtitle(key, track, origin);
    // The download may finish after the user has moved to another episode.
    if (!mounted.current || currentKey.current !== key) return undefined;
    const items = await loadSavedSubtitles(key);
    if (!mounted.current || currentKey.current !== key) return undefined;
    setState({key, items});
    return saved;
  }, [videoKey]);
  const remove = useCallback((id: string) => removeSavedSubtitle(videoKey, id), [videoKey]);
  return {savedSubtitles: state.key === videoKey ? state.items : [], saveSubtitle: add, removeSavedSubtitle: remove};
}
