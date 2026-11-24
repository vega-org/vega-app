import {validateProviderUrl} from '../sandbox/urlGuard';
import type {Post, PostPreview} from './types';

export type PostPreviewMediaType = 'video' | 'gif';

export interface ResolvedPostPreview {
  url: string;
  mediaType: PostPreviewMediaType;
  explicitType: boolean;
  headers?: Record<string, string>;
}

const GIF_EXTENSIONS = ['.gif', '.webp', '.apng'];
const VIDEO_EXTENSIONS = [
  '.mp4',
  '.m4v',
  '.webm',
  '.mov',
  '.mkv',
  '.m3u8',
  '.mpd',
  '.ts',
];

const sanitizeHeaders = (
  headers?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || typeof value !== 'string') {
      continue;
    }
    if (/[\r\n]/.test(trimmedKey) || /[\r\n]/.test(value)) {
      continue;
    }
    clean[trimmedKey] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
};

const inferMediaTypeFromPath = (pathname: string): PostPreviewMediaType => {
  const lower = pathname.toLowerCase();
  if (GIF_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return 'gif';
  }
  if (VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return 'video';
  }
  return 'video';
};

const normalizeExplicitType = (
  rawType?: PostPreview['type'],
): PostPreviewMediaType | undefined => {
  if (rawType === 'video') {
    return 'video';
  }
  if (rawType === 'gif' || rawType === 'image') {
    return 'gif';
  }
  return undefined;
};

export const resolvePostPreview = (
  post?: Post | null,
): ResolvedPostPreview | null => {
  if (!post || typeof post !== 'object') {
    return null;
  }

  let candidateUrl: string | undefined;
  let explicitMediaType: PostPreviewMediaType | undefined;
  let rawHeaders: Record<string, string> | undefined;

  if (typeof post.preview === 'string') {
    candidateUrl = post.preview;
    rawHeaders = post.previewHeaders;
  } else if (post.preview && typeof post.preview === 'object') {
    candidateUrl = post.preview.url;
    explicitMediaType = normalizeExplicitType(post.preview.type);
    rawHeaders = post.preview.headers ?? post.previewHeaders;
  } else if (typeof post.previewVideo === 'string') {
    candidateUrl = post.previewVideo;
    explicitMediaType = 'video';
    rawHeaders = post.previewHeaders;
  } else if (typeof post.previewGif === 'string') {
    candidateUrl = post.previewGif;
    explicitMediaType = 'gif';
    rawHeaders = post.previewHeaders;
  }

  if (typeof candidateUrl !== 'string' || !candidateUrl.trim()) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = validateProviderUrl(candidateUrl);
  } catch {
    return null;
  }

  return {
    url: parsedUrl.toString(),
    mediaType: explicitMediaType ?? inferMediaTypeFromPath(parsedUrl.pathname),
    explicitType: explicitMediaType !== undefined,
    headers: sanitizeHeaders(rawHeaders),
  };
};
