// WellFlix - Integrated Vega Provider Engine (MovieBox Web)
// Adapted from https://github.com/Zenda-Cross/vega-providers/providers/movieBoxWeb
// Baked-in provider - no user config needed

import * as cheerio from "cheerio";
import { getBaseUrl } from "./baseUrl";
import { EpisodeLink, Info, Link, Post, Stream, TextTracks } from "./types";
import {
  fallbackTrending,
  fallbackMovies,
  fallbackSeries,
  fallbackMeta,
  getFallbackByQuery,
  allFallbackPosts,
} from "./fallback";

export const providerValue = "movieBoxWeb";
export const providerDisplayName = "WellFlix Core";
const pageSize = 18;

const requestHeaders = {
  Accept: "application/json",
  "x-client-info": JSON.stringify({ timezone: "Asia/Colombo" }),
  "x-source": "",
};

// --- Utils ---
export type MovieBoxSubject = {
  subjectId?: string;
  subjectType?: number;
  title?: string;
  description?: string;
  releaseDate?: string;
  genre?: string;
  cover?: { url?: string };
  countryName?: string;
  imdbRatingValue?: string;
  subtitles?: string;
  hasResource?: boolean;
  detailPath?: string;
  stars?: Array<{ name?: string }>;
  dubs?: MovieBoxDub[];
};

export type MovieBoxDub = {
  subjectId?: string;
  lanName?: string;
  lanCode?: string;
  original?: boolean;
  detailPath?: string;
};

export type MovieBoxResource = {
  seasons?: Array<{
    se?: number;
    maxEp?: number;
    allEp?: string;
    resolutions?: Array<{ resolution?: number; epNum?: number }>;
  }>;
};

export type MovieBoxDetail = {
  subject: MovieBoxSubject;
  resource: MovieBoxResource;
};

export type PlaybackLink = {
  subjectId: string;
  detailPath: string;
  language: string;
  season?: number;
  episode?: number;
  resolution?: number;
  seasons?: MovieBoxResource["seasons"];
};

function parseNuxtData(html: string): unknown {
  const $ = cheerio.load(html);
  const serialized = $("#__NUXT_DATA__").text();
  if (!serialized) return null;
  return decodeNuxtData(JSON.parse(serialized));
}

function decodeNuxtData(values: unknown): unknown {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Invalid Nuxt data");
  }
  const entries = values as unknown[];
  const hydrated: unknown[] = new Array(entries.length);
  function hydrate(index: unknown): unknown {
    if (index === -1 || index === -2) return undefined;
    if (index === -3) return NaN;
    if (index === -4) return Infinity;
    if (index === -5) return -Infinity;
    if (index === -6) return -0;
    if (typeof index !== "number" || index < 0 || index >= entries.length) {
      throw new Error("Invalid Nuxt data index");
    }
    if (Object.prototype.hasOwnProperty.call(hydrated, index)) {
      return hydrated[index];
    }
    const value = entries[index];
    if (!value || typeof value !== "object") {
      hydrated[index] = value;
      return value;
    }
    if (Array.isArray(value)) {
      const type = value[0];
      if (
        type === "Reactive" ||
        type === "ShallowReactive" ||
        type === "Ref" ||
        type === "ShallowRef"
      ) {
        const result = hydrate(value[1]);
        hydrated[index] = result;
        return result;
      }
      if (type === "Set") {
        const result = new Set<unknown>();
        hydrated[index] = result;
        for (let item = 1; item < value.length; item++) {
          result.add(hydrate(value[item]));
        }
        return result;
      }
      if (typeof type === "string") {
        throw new Error(`Unsupported Nuxt data type: ${type}`);
      }
      const result: unknown[] = [];
      hydrated[index] = result;
      for (const item of value) {
        result.push(item === -2 ? undefined : hydrate(item));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    hydrated[index] = result;
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") throw new Error("Invalid Nuxt data key");
      result[key] = hydrate(item);
    }
    return result;
  }
  return hydrate(0);
}

function findDetail(value: unknown): MovieBoxDetail | null {
  if (!value || typeof value !== "object") return null;
  if (
    "subject" in value &&
    "resource" in value &&
    typeof (value as any).subject === "object" &&
    typeof (value as any).resource === "object"
  ) {
    return value as MovieBoxDetail;
  }
  for (const child of Object.values(value as object)) {
    const result = findDetail(child);
    if (result) return result;
  }
  return null;
}

export function parseNuxtDetail(html: string): MovieBoxDetail | null {
  return findDetail(parseNuxtData(html));
}

export function encodeLink(value: PlaybackLink): string {
  return JSON.stringify(value);
}

export function decodeLink(value: string): PlaybackLink {
  try {
    return JSON.parse(value) as PlaybackLink;
  } catch {
    // fallback for simple detailPath string - treat as demo
    return {
      subjectId: "demo",
      detailPath: value.replace("/moviesDetail/", ""),
      language: "Original",
    } as PlaybackLink;
  }
}

export function detailPath(link: string): string {
  return link.replace(/^https?:\/\/[^/]+/, "").replace(/^\/moviesDetail\//, "");
}

export function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

// --- Catalog ---
export const catalog = [
  { title: "Trending Now", filter: "/" },
  { title: "Movies", filter: "/newWeb/movie" },
  { title: "TV Series", filter: "/newWeb/tv-series" },
];

// --- Posts fetching ---
type SubjectPreview = {
  detailPath?: string;
  title?: string;
  coverUrl?: string;
  hasResource?: boolean;
};

type SubjectListResponse = {
  code?: number;
  message?: string;
  data?: {
    subjectList?: Array<{
      detailPath?: string;
      title?: string;
      cover?: { url?: string };
      hasResource?: boolean;
    }>;
  };
};

function collectSubjectPreviews(value: unknown): Map<string, SubjectPreview> {
  const subjects = new Map<string, SubjectPreview>();
  const visited = new Set<object>();
  function visit(current: unknown): void {
    if (!current || typeof current !== "object" || visited.has(current as object)) return;
    visited.add(current as object);
    if ("detailPath" in (current as any) && typeof (current as any).detailPath === "string") {
      const c = current as any;
      const cover = "cover" in c ? c.cover : undefined;
      subjects.set(c.detailPath, {
        title: typeof c.title === "string" ? c.title : undefined,
        coverUrl:
          cover && typeof cover === "object" && "url" in cover && typeof cover.url === "string"
            ? cover.url
            : undefined,
        hasResource:
          "hasResource" in c && typeof c.hasResource === "boolean" ? c.hasResource : undefined,
      });
    }
    Object.values(current as object).forEach(visit);
  }
  visit(value);
  return subjects;
}

async function fetchPostsLegacy(path: string, signal?: AbortSignal): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerValue);
  const response = await fetch(absoluteUrl(baseUrl, path), { signal });
  if (!response.ok) throw new Error(`MovieBox Web returned ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const subjects = collectSubjectPreviews(parseNuxtData(html));
  const posts: Post[] = [];
  const seen = new Set<string>();
  $('a[href^="/moviesDetail/"]').each((_, element) => {
    const card = $(element);
    const href = card.attr("href") || "";
    if (!href.startsWith("/moviesDetail/") || seen.has(href)) return;
    const subject = subjects.get(href.replace("/moviesDetail/", ""));
    if (path === "/upcoming" && subject?.hasResource !== true) return;
    if (subject?.hasResource === false) return;
    const image = card.find("img").first();
    const title =
      subject?.title?.trim() ||
      card.find("h2, h3").first().attr("title")?.trim() ||
      image.attr("alt")?.trim() ||
      card.find("h2, h3").first().text().trim() ||
      card.attr("title")?.replace(/^go to /i, "").replace(/ detail page$/i, "").trim() ||
      "";
    if (!title) return;
    if (isUnreleased(title)) return;
    seen.add(href);
    posts.push({
      title,
      link: href,
      image: image.attr("data-src") || subject?.coverUrl || image.attr("src") || "",
    });
  });
  return posts.filter((p) => !isUnreleased(p.title));
}

const UNRELEASED_KEYWORDS = ["salaar 3", "salaar part 3", "pushpa 3", "kalki 2"];

function isUnreleased(title: string): boolean {
  const t = title.toLowerCase();
  return UNRELEASED_KEYWORDS.some((kw) => t.includes(kw));
}

function mapSubjects(subjects: SubjectPreview[]): Post[] {
  return subjects
    .filter((s) => Boolean(s.detailPath && s.title) && s.hasResource !== false && !isUnreleased(s.title || ""))
    .map((s) => ({
      title: s.title || "",
      link: `/moviesDetail/${s.detailPath}`,
      image: s.coverUrl || "",
    }))
    .filter((p) => !isUnreleased(p.title));
}

async function fetchCatalogPage(filter: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerValue);
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    perPage: String(pageSize),
  });
  // Only set tabId for movies - tv-series without tabId avoids 400 on themoviebox.org
  // Original vega-providers only sets ONEROOM_MOVIE for /newWeb/movie
  if (filter === "/newWeb/movie") params.set("tabId", "ONEROOM_MOVIE");
  // For tv-series we keep default trending (no tabId) to avoid 400
  const url = absoluteUrl(baseUrl, `/wefeed-h5api-bff/subject/trending?${params.toString()}`);
  const response = await fetch(url, { headers: requestHeaders, signal });
  if (!response.ok) {
    console.warn(`Catalog ${filter} returned ${response.status}, will fallback`);
    throw new Error(`MovieBox Web returned ${response.status}`);
  }
  const payload = (await response.json()) as SubjectListResponse;
  if (payload.code !== 0) throw new Error(payload.message || "MovieBox Web catalog request failed");
  return mapSubjects(
    (payload.data?.subjectList || []).map((subject) => ({
      detailPath: subject.detailPath,
      title: subject.title,
      coverUrl: subject.cover?.url,
      hasResource: subject.hasResource,
    }))
  );
}

export const getPosts = async (filter: string, page: number, signal?: AbortSignal): Promise<Post[]> => {
  try {
    const path = filter || "/";
    if (["/", "/newWeb/movie", "/newWeb/tv-series"].includes(path)) {
      const result = await fetchCatalogPage(path, page, signal);
      if (result.length > 0) return result;
      throw new Error("Empty catalog");
    }
    if (page > 1) return [];
    const legacy = await fetchPostsLegacy(path, signal);
    if (legacy.length > 0) return legacy;
    throw new Error("Empty legacy");
  } catch (e) {
    // Quiet fallback - don't spam logs with MovieBox 400s
    if (page > 1) return [];
    if (filter === "/newWeb/movie") return fallbackMovies;
    if (filter === "/newWeb/tv-series") return fallbackSeries;
    return fallbackTrending;
  }
};

export const getSearchPosts = async (
  searchQuery: string,
  page: number,
  signal?: AbortSignal
): Promise<Post[]> => {
  try {
    if (page > 1 || !searchQuery.trim()) return [];
    const results = await fetchPostsLegacy(
      `/newWeb/searchResult?keyword=${encodeURIComponent(searchQuery.trim())}`,
      signal
    );
    if (results.length > 0) return results;
    return getFallbackByQuery(searchQuery);
  } catch {
    return getFallbackByQuery(searchQuery);
  }
};

// --- Meta ---
function buildPlaybackLink(
  subject: MovieBoxSubject,
  dub: MovieBoxDub,
  seasons: MovieBoxResource["seasons"]
): string {
  const movieSeason = seasons?.find((season) => season.se === 0) || seasons?.[0];
  const movieResolution = movieSeason?.resolutions
    ?.filter((item) => (item.epNum || 0) >= 1)
    .sort((a, b) => (b.resolution || 0) - (a.resolution || 0))[0]?.resolution;
  return encodeLink({
    subjectId: dub.subjectId || subject.subjectId || "",
    detailPath: dub.detailPath || subject.detailPath || "",
    language: dub.lanName || dub.lanCode || "Original",
    season: subject.subjectType === 2 ? undefined : movieSeason?.se || 0,
    episode: subject.subjectType === 2 ? undefined : 1,
    resolution: subject.subjectType === 2 ? undefined : movieResolution,
    seasons,
  });
}

export const getMeta = async (link: string): Promise<Info> => {
  // If link is already a fallback or invalid, return fallback quickly to avoid 400 logs
  if (!link || link.includes("demo") || !link.includes("/moviesDetail/")) {
    const q = link.toLowerCase();
    const found = allFallbackPosts.find((p) => q.includes(p.title.toLowerCase().split(" ")[0]));
    if (found) {
      return { ...fallbackMeta, title: found.title, image: found.image, type: fallbackSeries.some((s) => s.link === found.link) ? "series" : "movie" };
    }
  }
  try {
    const baseUrl = await getBaseUrl(providerValue);
    const pageUrl = absoluteUrl(baseUrl, `/moviesDetail/${detailPath(link)}`);
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      next: { revalidate: 600 } as any,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const detail = parseNuxtDetail(html);
    if (!detail) throw new Error("MovieBox Web detail not found");
    const { subject, resource } = detail;
    const isSeries = subject.subjectType === 2;
    const dubs = subject.dubs?.length
      ? subject.dubs
      : [{ subjectId: subject.subjectId, detailPath: subject.detailPath, lanName: "Original" }];
    const linkList: Link[] = (subject.hasResource === false ? [] : dubs)
      .filter((dub) => dub.subjectId && (dub.detailPath || subject.detailPath))
      .map((dub) => {
        const playbackLink = buildPlaybackLink(subject, dub, resource.seasons);
        if (isSeries) {
          return { title: dub.lanName || dub.lanCode || "Original", episodesLink: playbackLink };
        }
        return {
          title: dub.lanName || dub.lanCode || "Original",
          directLinks: [{ title: dub.lanName || dub.lanCode || "Original", link: playbackLink, type: "movie" }],
        };
      });

    const tags = [
      subject.countryName,
      subject.releaseDate?.slice(0, 4),
      ...(subject.genre || "").split(",").map((tag) => tag.trim()),
    ].filter((tag): tag is string => Boolean(tag));

    return {
      title: subject.title || "",
      image: subject.cover?.url || "",
      synopsis: subject.description || "",
      imdbId: "",
      type: isSeries ? "series" : "movie",
      tags,
      cast: subject.stars?.map((star) => star.name || "").filter(Boolean),
      rating: subject.imdbRatingValue || "",
      linkList,
      webUrl: pageUrl,
    };
  } catch (e) {
    console.warn("getMeta fallback", e);
    const q = link.toLowerCase();
    const found = allFallbackPosts.find((p) => q.includes(p.title.toLowerCase().split(" ")[0]) || p.link.toLowerCase() === q || q.includes((p.link.toLowerCase().split("/").pop() || "")));
    if (found) {
      return {
        ...fallbackMeta,
        title: found.title,
        image: found.image,
        type: fallbackSeries.some((s) => s.link === found.link) ? "series" : "movie",
      };
    }
    return fallbackMeta;
  }
};

// --- Episodes ---
export const getEpisodes = async (url: string): Promise<EpisodeLink[]> => {
  try {
    const playback = decodeLink(url);
    if (!playback.seasons || playback.seasons.length === 0) {
      // Demo episodes for fallback
      return Array.from({ length: 12 }, (_, i) => ({
        title: `S01 E${String(i + 1).padStart(2, "0")}`,
        link: encodeLink({ ...playback, season: 1, episode: i + 1, seasons: undefined }),
      }));
    }
    const episodes: EpisodeLink[] = [];
    for (const season of playback.seasons) {
      const seasonNumber = season.se || 1;
      const availableEpisodes = season.allEp
        ? season.allEp.split(",").map(Number).filter((ep) => ep > 0)
        : Array.from({ length: season.maxEp || 0 }, (_, index) => index + 1);
      for (const episode of availableEpisodes) {
        const resolution = season.resolutions
          ?.filter((item) => (item.epNum || 0) >= episode)
          .sort((a, b) => (b.resolution || 0) - (a.resolution || 0))[0]?.resolution;
        episodes.push({
          title: `S${String(seasonNumber).padStart(2, "0")} E${String(episode).padStart(2, "0")}`,
          link: encodeLink({ ...playback, seasons: undefined, season: seasonNumber, episode, resolution }),
        });
      }
    }
    return episodes;
  } catch {
    const playback = decodeLink(url);
    return Array.from({ length: 10 }, (_, i) => ({
      title: `S01 E${String(i + 1).padStart(2, "0")}`,
      link: encodeLink({ ...playback, season: 1, episode: i + 1, seasons: undefined }),
    }));
  }
};

// --- Stream ---
type PlayStream = {
  format?: string;
  id?: string;
  url?: string;
  resolutions?: string;
  vipLocked?: boolean;
};

type Caption = {
  lan?: string;
  lanName?: string;
  url?: string;
};

function getQuality(resolutions?: string): Stream["quality"] {
  const values = (resolutions || "")
    .split(",")
    .map(Number)
    .filter((value) => [360, 480, 720, 1080, 2160].includes(value));
  const quality = Math.max(...values);
  return Number.isFinite(quality) ? (String(quality) as Stream["quality"]) : undefined;
}

function getStreamType(format?: string): string {
  const normalized = format?.toUpperCase();
  if (normalized === "HLS" || normalized === "M3U8") return "m3u8";
  if (normalized === "DASH") return "mpd";
  return "mp4";
}

function mapCaptions(captions: Caption[]): TextTracks {
  return captions
    .filter((c) => Boolean(c.url))
    .map((c) => ({
      title: c.lanName || c.lan || "Subtitle",
      language: c.lan || "und",
      type: c.url?.includes(".vtt") ? ("text/vtt" as const) : ("application/x-subrip" as const),
      uri: c.url || "",
    }));
}

async function getCaptions(
  baseUrl: string,
  playback: PlaybackLink,
  stream: PlayStream,
  referer: string
): Promise<TextTracks> {
  if (!stream.id || !stream.format) return [];
  const params = new URLSearchParams({
    format: stream.format,
    id: stream.id,
    subjectId: playback.subjectId,
    detailPath: playback.detailPath,
  });
  const url = absoluteUrl(baseUrl, `/wefeed-h5api-bff/subject/caption?${params}`);
  try {
    const response = await fetch(url, { headers: { ...requestHeaders, Referer: referer } });
    if (!response.ok) return [];
    const data = await response.json();
    return mapCaptions(data?.data?.captions || []);
  } catch {
    return [];
  }
}

export const getStream = async (link: string): Promise<Stream[]> => {
  const playback = decodeLink(link);
  // Demo mode only for explicit demo subjectId
  if (playback.subjectId === "demo" && playback.detailPath === "dune") {
    return [
      {
        server: "Demo 1080p",
        link: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        type: "m3u8",
        quality: "1080",
      },
      {
        server: "Demo 720p",
        link: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        type: "mp4",
        quality: "720",
      },
    ];
  }

  try {
    const baseUrl = await getBaseUrl(providerValue);
    const watchParams = new URLSearchParams({
      id: playback.subjectId,
      type: "/movie/detail",
      detailSe: playback.season ? String(playback.season) : "",
      detailEp: playback.episode ? String(playback.episode) : "",
      lang: "en",
    });
    const referer = absoluteUrl(baseUrl, `/movies/${playback.detailPath}?${watchParams}`);
    const playParams = new URLSearchParams({
      subjectId: playback.subjectId,
      detailPath: playback.detailPath,
    });
    if (playback.season && playback.episode) {
      playParams.set("se", String(playback.season));
      playParams.set("ep", String(playback.episode));
    }
    const playUrl = absoluteUrl(baseUrl, `/wefeed-h5api-bff/subject/play?${playParams}`);
    const response = await fetch(playUrl, {
      headers: { ...requestHeaders, Referer: referer },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} | URL ${playUrl}`);
    const data = await response.json();
    const playData = data?.data;
    if (data?.code !== 0) throw new Error(data?.message || `MovieBox Web play API code ${data?.code}`);
    if (playData?.hasResource === false) return [];
    if (!playData) throw new Error("MovieBox Web play data was not found");
    const sources = [...(playData.streams || []), ...(playData.hls || []), ...(playData.dash || [])] as PlayStream[];
    const availableSources = sources.filter((s) => s.url && !s.vipLocked);
    const streams = await Promise.all(
      availableSources.map(async (source) => ({
        server: `${playback.language} ${source.resolutions || source.format || ""}`.trim(),
        link: source.url || "",
        type: getStreamType(source.format),
        quality: getQuality(source.resolutions),
        subtitles: await getCaptions(baseUrl, playback, source, referer),
        headers: { Referer: baseUrl, Origin: baseUrl },
      }))
    );
    return streams; // Return real streams only, no demo fallback
  } catch {
    return []; // No demo - return empty so UI shows error, not fake video
  }
};
