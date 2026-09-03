import {AxiosStatic} from 'axios';
import * as cheerio from 'cheerio';
import {Content} from '../zustand/contentStore';
import * as Crypto from 'expo-crypto';

export interface ProvidersList {
  name: string;
  value: string;
  type: string;
  flag: string;
}

export interface Post {
  title: string;
  link: string;
  image: string;
  provider?: string;
  aspectRatio?: number | string;
  borderRadius?: number;
  tag?: string;
  cornerTag?: string;
}

export declare enum TextTrackType {
  SUBRIP = 'application/x-subrip',
  TTML = 'application/ttml+xml',
  VTT = 'text/vtt',
}

export type TextTracks = {
  title: string;
  language: ISO639_1;
  type: TextTrackType;
  uri: string;
}[];

export interface SkipInterval {
  title?: string;
  from: number;
  to: number;
}

// getStream
export interface Stream {
  server: string;
  link: string;
  type: string;
  quality?: '360' | '480' | '720' | '1080' | '2160' | string;
  tag?: string;
  tags?: string[];
  subtitles?: TextTracks;
  headers?: any;
  skip?: SkipInterval[];
}

// getInfo
export interface Info {
  title: string;
  image: string;
  logo?: string;
  poster?: string;
  synopsis: string;
  imdbId?: string;
  tmdbId?: number | string;
  type: string;
  quickDownload?: boolean;
  populateMeta?: boolean;
  webUrl?: string;
  tags?: string[];
  cast?: string[];
  rating?: string;
  trailerUrl?: string;
  linkList: Link[];
}
// getEpisodeLinks
export interface EpisodeLink {
  id?: string;
  title: string;
  link: string;
  sourceLink?: string;
  description?: string;
  image?: string;
  quickDownload?: boolean;
  skip?: SkipInterval[];
}

export interface Link {
  title: string;
  quality?: string;
  episodesLink?: string;
  quickDownload?: boolean;
  directLinks?: {
    title: string;
    link: string;
    type?: 'movie' | 'series';
    description?: string;
    image?: string;
    quickDownload?: boolean;
    skip?: SkipInterval[];
  }[];
}

// catalog
export interface Catalog {
  title: string;
  filter: string;
}

export type CatalogList =
  | Catalog[]
  | ((params?: { signal?: AbortSignal; providerContext?: ProviderContext }) => Promise<Catalog[]> | Catalog[]);

export interface ProviderType {
  searchFilter?: string;
  catalog: CatalogList;
  genres: CatalogList;
  blurImage?: boolean;
  nonStreamableServer?: string[];
  nonDownloadableServer?: string[];
  GetStream: ({
    link,
    type,
    signal,
    providerContext,
    isDownload,
  }: {
    link: string;
    type: string;
    signal?: AbortSignal;
    providerContext: ProviderContext;
    isDownload?: boolean;
  }) => Promise<Stream[]>;
  GetHomePosts: ({
    filter,
    page,
    providerValue,
    signal,
    providerContext,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
    providerContext: ProviderContext;
  }) => Promise<Post[]>;
  GetEpisodeLinks?: ({
    url,
    providerContext,
  }: {
    url: string;
    providerContext: ProviderContext;
  }) => Promise<EpisodeLink[]>;
  GetMetaData: ({
    link,
    provider,
    providerContext,
  }: {
    link: string;
    provider: Content['provider'];
    providerContext: ProviderContext;
  }) => Promise<Info>;
  GetSearchPosts: ({
    searchQuery,
    page,
    providerValue,
    signal,
    providerContext,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
    providerContext: ProviderContext;
  }) => Promise<Post[]>;
}

// Options to customize the WAF-solving WebView dialog.
export interface OpenWebViewOptions {
  // Title shown in the dialog header.
  title?: string;
  // Helper text shown under the title.
  description?: string;

  headers?: Record<string, string>;

  waitForCookie?: string;

  force?: boolean;
  // If set, the dialog auto-cancels (rejects) after this many milliseconds.
  timeoutMs?: number;
}

// Result returned to the provider after the user solves the challenge.
export interface OpenWebViewResult {
  // The page response after the challenge is solved: the rendered HTML of the
  // document (document.documentElement.outerHTML).
  data: string;
  // Cookie header value, e.g. "cf_clearance=abc; other=def".
  cookies: string;
  // Backward-compatible alias used by older provider modules.
  cookie?: string;
  // Cookies as a name -> value map.
  cookieMap: Record<string, string>;
  // The User-Agent used by the WebView.
  userAgent: string;
  // The URL that was opened.
  url: string;
}

export type SettingsFieldType =
  | 'text'
  | 'toggle'
  | 'select'
  | 'multiselect'
  | 'number';

export interface SelectOption {
  label: string;
  value: string;
}

export interface BaseSettingsField {
  key: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
}

export interface TextSettingsField extends BaseSettingsField {
  type: 'text';
  placeholder?: string;
  defaultValue?: string;
}

export interface ToggleSettingsField extends BaseSettingsField {
  type: 'toggle';
  defaultValue?: boolean;
}

export interface SelectSettingsField extends BaseSettingsField {
  type: 'select';
  options: SelectOption[];
  defaultValue?: string;
}

export interface MultiSelectSettingsField extends BaseSettingsField {
  type: 'multiselect';
  options: SelectOption[];
  defaultValue?: string[];
}

export interface NumberSettingsField extends BaseSettingsField {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export type SettingsField =
  | TextSettingsField
  | ToggleSettingsField
  | SelectSettingsField
  | MultiSelectSettingsField
  | NumberSettingsField;

export interface ProviderKvStore {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
}

export type ProviderContext = {
  axios: AxiosStatic;
  Crypto: typeof Crypto;
  getBaseUrl: (providerValue: string) => Promise<string>;
  commonHeaders: Record<string, string>;
  cheerio: typeof cheerio;

  openWebView: (
    url: string,
    options?: OpenWebViewOptions,
  ) => Promise<OpenWebViewResult>;
  kvStore: ProviderKvStore;
};

export type ISO639_1 =
  | 'aa'
  | 'ab'
  | 'ae'
  | 'af'
  | 'ak'
  | 'am'
  | 'an'
  | 'ar'
  | 'as'
  | 'av'
  | 'ay'
  | 'az'
  | 'ba'
  | 'be'
  | 'bg'
  | 'bi'
  | 'bm'
  | 'bn'
  | 'bo'
  | 'br'
  | 'bs'
  | 'ca'
  | 'ce'
  | 'ch'
  | 'co'
  | 'cr'
  | 'cs'
  | 'cu'
  | 'cv'
  | 'cy'
  | 'da'
  | 'de'
  | 'dv'
  | 'dz'
  | 'ee'
  | 'el'
  | 'en'
  | 'eo'
  | 'es'
  | 'et'
  | 'eu'
  | 'fa'
  | 'ff'
  | 'fi'
  | 'fj'
  | 'fo'
  | 'fr'
  | 'fy'
  | 'ga'
  | 'gd'
  | 'gl'
  | 'gn'
  | 'gu'
  | 'gv'
  | 'ha'
  | 'he'
  | 'hi'
  | 'ho'
  | 'hr'
  | 'ht'
  | 'hu'
  | 'hy'
  | 'hz'
  | 'ia'
  | 'id'
  | 'ie'
  | 'ig'
  | 'ii'
  | 'ik'
  | 'io'
  | 'is'
  | 'it'
  | 'iu'
  | 'ja'
  | 'jv'
  | 'ka'
  | 'kg'
  | 'ki'
  | 'kj'
  | 'kk'
  | 'kl'
  | 'km'
  | 'kn'
  | 'ko'
  | 'kr'
  | 'ks'
  | 'ku'
  | 'kv'
  | 'kw'
  | 'ky'
  | 'la'
  | 'lb'
  | 'lg'
  | 'li'
  | 'ln'
  | 'lo'
  | 'lt'
  | 'lu'
  | 'lv'
  | 'mg'
  | 'mh'
  | 'mi'
  | 'mk'
  | 'ml'
  | 'mn'
  | 'mr'
  | 'ms'
  | 'mt'
  | 'my'
  | 'na'
  | 'nb'
  | 'nd'
  | 'ne'
  | 'ng'
  | 'nl'
  | 'nn'
  | 'no'
  | 'nr'
  | 'nv'
  | 'ny'
  | 'oc'
  | 'oj'
  | 'om'
  | 'or'
  | 'os'
  | 'pa'
  | 'pi'
  | 'pl'
  | 'ps'
  | 'pt'
  | 'qu'
  | 'rm'
  | 'rn'
  | 'ro'
  | 'ru'
  | 'rw'
  | 'sa'
  | 'sc'
  | 'sd'
  | 'se'
  | 'sg'
  | 'si'
  | 'sk'
  | 'sl'
  | 'sm'
  | 'sn'
  | 'so'
  | 'sq'
  | 'sr'
  | 'ss'
  | 'st'
  | 'su'
  | 'sv'
  | 'sw'
  | 'ta'
  | 'te'
  | 'tg'
  | 'th'
  | 'ti'
  | 'tk'
  | 'tl'
  | 'tn'
  | 'to'
  | 'tr'
  | 'ts'
  | 'tt'
  | 'tw'
  | 'ty'
  | 'ug'
  | 'uk'
  | 'ur'
  | 'uz'
  | 've'
  | 'vi'
  | 'vo'
  | 'wa'
  | 'wo'
  | 'xh'
  | 'yi'
  | 'yo'
  | 'za'
  | 'zh'
  | 'zu';
