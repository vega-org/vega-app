import {cache, getColors} from 'react-native-image-colors';
import {mixHex} from '../theme/seeds';
import {cacheStorage} from './storage/StorageService';

const IMAGE_COLOR_FALLBACK = '#FFFFFF';
const accentCache = new Map<string, Promise<string>>();
const inFlightExtractions = new Map<string, Promise<string | undefined>>();

export const clearImageAccentCache = (): void => {
  accentCache.clear();
  inFlightExtractions.clear();
};

export const getCachedImageAccent = (cacheKey: string): string | undefined => {
  if (!cacheKey) return undefined;
  return cacheStorage.getString(`accent:${cacheKey}`);
};

export const scoreHexColor = (hex?: string): number => {
  if (!hex || typeof hex !== 'string') return -1;
  const clean = hex.trim();
  if (!clean.startsWith('#') || clean.length < 7) return -1;
  if (clean.toUpperCase() === IMAGE_COLOR_FALLBACK.toUpperCase()) return -1;

  const red = parseInt(clean.slice(1, 3), 16);
  const green = parseInt(clean.slice(3, 5), 16);
  const blue = parseInt(clean.slice(5, 7), 16);
  if (isNaN(red) || isNaN(green) || isNaN(blue)) return -1;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max ? (max - min) / max : 0;
  const brightness = max / 255;

  // Filter out dark muddy colors, near-white washed out colors, or gray/monochrome
  if (brightness < 0.14 || brightness > 0.96 || saturation < 0.12) {
    return -1;
  }

  // Exact desktop weighting: high saturation + target brightness ~0.62
  return 1 + saturation * 5 + (1 - Math.abs(brightness - 0.62)) * 3;
};

export const selectImageAccent = (
  imageColors: Awaited<ReturnType<typeof getColors>>,
): string | undefined => {
  let rawCandidates: (string | undefined)[] = [];

  if (imageColors.platform === 'android') {
    rawCandidates = [
      imageColors.vibrant,
      imageColors.dominant,
      imageColors.darkVibrant,
      imageColors.lightVibrant,
      imageColors.muted,
      imageColors.darkMuted,
      imageColors.lightMuted,
      imageColors.average,
    ];
  } else if (imageColors.platform === 'ios') {
    rawCandidates = [
      imageColors.primary,
      imageColors.secondary,
      imageColors.detail,
      imageColors.background,
    ];
  } else {
    rawCandidates = [
      (imageColors as any).vibrant,
      (imageColors as any).dominant,
      (imageColors as any).darkVibrant,
      (imageColors as any).lightVibrant,
      (imageColors as any).muted,
    ];
  }

  const validCandidates = rawCandidates.filter(
    (c): c is string =>
      typeof c === 'string' &&
      c.toUpperCase() !== IMAGE_COLOR_FALLBACK.toUpperCase(),
  );

  if (validCandidates.length === 0) return undefined;

  const scored = validCandidates
    .map(hex => ({hex, score: scoreHexColor(hex)}))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored[0].hex;
  }

  return validCandidates[0];
};

export const extractImageAccent = async (
  imageUri: string,
  cacheKey: string,
): Promise<string | undefined> => {
  if (!imageUri) return undefined;

  // 1. Instant check from persistent MMKV cache
  const cachedAccent = getCachedImageAccent(cacheKey);
  if (cachedAccent) {
    return cachedAccent;
  }

  // 2. Deduplicate in-flight extractions for identical cacheKey
  const inFlight = inFlightExtractions.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const extractionPromise = (async () => {
    try {
      // 3. Set a strict 3.5s timeout on image download/color extraction so the UI never hangs
      const fetchColorsPromise = getColors(imageUri, {
        cache: true,
        fallback: IMAGE_COLOR_FALLBACK,
        key: cacheKey,
        pixelSpacing: 8,
      });

      const timeoutPromise = new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), 3500),
      );

      const imageColors = await Promise.race([fetchColorsPromise, timeoutPromise]);
      if (!imageColors) {
        cache.removeItem(cacheKey);
        return undefined;
      }

      const accent = selectImageAccent(imageColors);
      if (!accent) {
        cache.removeItem(cacheKey);
        return undefined;
      }

      // 4. Save to persistent MMKV cache for instant 0ms future access
      cacheStorage.setString(`accent:${cacheKey}`, accent);
      return accent;
    } catch {
      cache.removeItem(cacheKey);
      return undefined;
    } finally {
      inFlightExtractions.delete(cacheKey);
    }
  })();

  inFlightExtractions.set(cacheKey, extractionPromise);
  return extractionPromise;
};

export const getImageAccent = (
  imageUri: string | undefined,
  fallback: string,
): Promise<string> => {
  if (!imageUri) {
    return Promise.resolve(fallback);
  }

  const cached = accentCache.get(imageUri);
  if (cached) {
    return cached;
  }

  const cacheKey = `shared-image-accent-v2:${imageUri}`;
  const accent = extractImageAccent(imageUri, cacheKey).then(extractedColor =>
    extractedColor ? mixHex(extractedColor, '#FFFFFF', 0.35) : fallback,
  );

  accentCache.set(imageUri, accent);
  return accent;
};
