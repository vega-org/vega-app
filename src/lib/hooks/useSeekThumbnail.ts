import {useEffect, useRef, useState} from 'react';
import {NativeModules, Platform} from 'react-native';
import {SeekThumbnailSession, type PreviewNativeModule} from '../player/seekThumbnail';

export function useSeekThumbnail(
  source: string | null,
  headers: Record<string, string>,
  timestampMs: number,
  enabled: boolean,
) {
  const headersKey = JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
  const sourceKey = JSON.stringify([source, headersKey]);
  const [preview, setPreview] = useState<{sourceKey: string; uri: string | null; loading: boolean}>();
  const session = useRef<SeekThumbnailSession | null>(null);
  useEffect(() => {
    const native = NativeModules.VideoThumbnailModule as PreviewNativeModule | undefined;
    if (Platform.OS !== 'android' || !source || !native) return;

    const current = new SeekThumbnailSession(
      native,
      source,
      Object.fromEntries(JSON.parse(headersKey)),
      (uri, loading) => {
        setPreview(previous => {
          // Keep the last successful frame while the new position decodes.
          const nextUri = uri ?? (previous?.sourceKey === sourceKey ? previous.uri : null);
          if (previous?.sourceKey === sourceKey && previous.uri === nextUri && previous.loading === loading) {
            return previous;
          }
          return {sourceKey, uri: nextUri, loading};
        });
      },
    );
    session.current = current;
    return () => {
      current.dispose();
      session.current = null;
    };
  }, [source, sourceKey, headersKey]);
  useEffect(() => {
    if (enabled) session.current?.request(timestampMs);
    else session.current?.pause();
  }, [enabled, sourceKey, timestampMs]);

  const current = preview?.sourceKey === sourceKey ? preview : undefined;
  return {
    uri: current?.uri ?? null,
    loading: Boolean(enabled && current?.loading),
  };
}
