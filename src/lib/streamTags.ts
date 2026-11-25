import type {Stream} from './providers/types';

/**
 * Splits a stream's labels for display: the quality is shown once, and any
 * provider tags repeat it, so they are dropped from the tag list.
 */
export const splitStreamTags = (
  stream: Pick<Stream, 'quality' | 'tag' | 'tags'>,
): {quality?: string; tags?: string[]} => {
  const raw: string[] = Array.isArray(stream.tags)
    ? stream.tags
    : typeof stream.tag === 'string'
      ? [stream.tag]
      : [];
  const quality = stream.quality?.trim() || undefined;
  const tags = raw
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(t => Boolean(t) && t.toLowerCase() !== quality?.toLowerCase());
  return {quality, tags: tags.length > 0 ? tags : undefined};
};
