import {throwIfProviderAborted} from '../sandbox/abort';
import {ToastAndroid} from 'react-native';
import axios from 'axios';
import {headers as commonHeaders} from '../providers/headers';
import {
  Catalog,
  EpisodeLink,
  Info,
  Post,
  Stream,
  SettingsField,
} from '../providers/types';
import {extensionManager} from './ExtensionManager';
import {extensionStorage} from '../storage/extensionStorage';
import {providerKvStorage} from '../storage/StorageService';
import {getSourceAuthHeaders} from '../storage/sourceTokenStorage';
import {getProviderFilesUrl} from '../utils/helpers';
import {MAX_STATE_BYTES} from '../sandbox/protocol';
import {sandboxBridge, setSandboxStateHandler} from '../sandbox/sandboxBridge';
import {
  getProviderKvPrefix,
  providerAuthor,
  providerScopeId,
} from '../sandbox/providerScope';
import {getJarCookieHeader} from '../sandbox/providerCookieJar';

/** Module code and the source author it came from. */
interface ProviderCode {
  code: string;
  author: string;
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized || fallback;
  } catch {
    return fallback;
  }
};

export class ProviderManager {
  // Keyed by providerScopeId(author, value).
  private readonly providerState = new Map<string, Record<string, unknown>>();
  private readonly settingsSchemaCache = new Map<string, SettingsField[]>();

  constructor() {
    setSandboxStateHandler((providerValue, author, state) => {
      try {
        this.saveProviderState(providerScopeId(author, providerValue), state);
      } catch (error) {
        console.warn('Discarding provider state:', error);
      }
    });
  }

  clearProviderState(providerValue: string): void {
    const suffix = `/${encodeURIComponent(providerValue)}`;
    for (const scope of Array.from(this.providerState.keys())) {
      if (scope.endsWith(suffix)) {
        this.providerState.delete(scope);
      }
    }
    for (const key of Array.from(this.settingsSchemaCache.keys())) {
      if (key.endsWith(`:${providerValue}`)) {
        this.settingsSchemaCache.delete(key);
        this.settingsActionModules.delete(key);
      }
    }
  }

  private getProviderState(scope: string): Record<string, unknown> {
    const current = this.providerState.get(scope);
    if (!current) {
      return {};
    }
    try {
      return JSON.parse(JSON.stringify(current));
    } catch {
      return {};
    }
  }

  private saveProviderState(scope: string, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Provider state must be an object');
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > MAX_STATE_BYTES) {
      throw new Error('Provider state exceeds the 256 KB limit');
    }
    this.providerState.set(
      scope,
      JSON.parse(serialized) as Record<string, unknown>,
    );
  }

  private getModule(
    providerValue: string,
    key: 'catalog' | 'posts' | 'meta' | 'stream' | 'episodes' | 'settings',
  ): ProviderCode | undefined {
    const module = extensionManager.getProviderModules(providerValue);
    const code = module?.modules[key];
    return code
      ? {code, author: providerAuthor(module?.sourceAuthor)}
      : undefined;
  }

  private executeModule<T>(
    module: ProviderCode,
    providerValue: string,
    exportName?: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    return sandboxBridge.invoke<T>({
      moduleCode: module.code,
      providerValue,
      author: module.author,
      exportName,
      // commonHeaders is passed per invoke because it is platform dependent and
      // the sandbox realm cannot read Platform itself.
      args: {...args, commonHeaders},
      state: this.getProviderState(
        providerScopeId(module.author, providerValue),
      ),
      signal,
    });
  }

  private requireArray<T>(
    value: unknown,
    providerValue: string,
    operation: string,
  ): T[] {
    if (!Array.isArray(value)) {
      const actualType = value === null ? 'null' : typeof value;
      throw new Error(
        `Provider ${providerValue} ${operation} returned ${actualType}, expected an array`,
      );
    }
    return value as T[];
  }
  getCatalog = async ({
    providerValue,
    signal,
  }: {
    providerValue: string;
    signal?: AbortSignal;
  }): Promise<Catalog[]> => {
    throwIfProviderAborted(signal);
    const catalogModule = this.getModule(providerValue, 'catalog');
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{
        catalog?: Catalog[] | (() => Promise<Catalog[]> | Catalog[]);
      }>(catalogModule, providerValue, undefined, {}, signal);
      let catalog = moduleExports?.catalog;
      if (typeof catalog === 'function') {
        catalog = await (catalog as any)();
      }
      return this.requireArray<Catalog>(
        catalog ?? [],
        providerValue,
        'catalog',
      );
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      console.error('Error loading catalog:', error);
      throw new Error(
        getErrorMessage(
          error,
          `Invalid catalog module for provider: ${providerValue}`,
        ),
      );
    }
  };
  getGenres = async ({
    providerValue,
  }: {
    providerValue: string;
  }): Promise<Catalog[]> => {
    const catalogModule = this.getModule(providerValue, 'catalog');
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{
        genres?: Catalog[] | (() => Promise<Catalog[]> | Catalog[]);
      }>(catalogModule, providerValue);
      let genres = moduleExports?.genres;
      if (typeof genres === 'function') {
        genres = await (genres as any)();
      }
      return this.requireArray<Catalog>(genres ?? [], providerValue, 'genres');
    } catch (error) {
      console.error('Error loading genres:', error);
      throw new Error(
        getErrorMessage(
          error,
          `Invalid catalog module for provider: ${providerValue}`,
        ),
      );
    }
  };
  getPosts = async ({
    filter,
    page,
    providerValue,
    signal,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    throwIfProviderAborted(signal);
    const getPostsModule = this.getModule(providerValue, 'posts');
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      const posts = await this.executeModule<Post[]>(
        getPostsModule,
        providerValue,
        'getPosts',
        {filter, page, providerValue},
        signal,
      );
      return this.requireArray<Post>(posts, providerValue, 'getPosts');
    } catch (error) {
      throwIfProviderAborted(signal);
      if (!signal.aborted) {
        console.error('Error in posts function:', error);
      }
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get posts from provider: ${providerValue}`,
        ),
      );
    }
  };
  getSearchPosts = async ({
    searchQuery,
    page,
    providerValue,
    signal,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    throwIfProviderAborted(signal);
    const getPostsModule = this.getModule(providerValue, 'posts');
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      const posts = await this.executeModule<Post[]>(
        getPostsModule,
        providerValue,
        'getSearchPosts',
        {searchQuery, page, providerValue},
        signal,
      );
      return this.requireArray<Post>(posts, providerValue, 'getSearchPosts');
    } catch (error) {
      throwIfProviderAborted(signal);
      console.error('Error in search posts function:', error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to search posts from provider: ${providerValue}`,
        ),
      );
    }
  };
  getMetaData = async ({
    link,
    provider,
    signal,
  }: {
    link: string;
    provider: string;
    signal?: AbortSignal;
  }): Promise<Info> => {
    throwIfProviderAborted(signal);
    const getMetaDataModule = this.getModule(provider, 'meta');
    if (!getMetaDataModule) {
      throw new Error(`No meta data module found for provider: ${provider}`);
    }
    try {
      return await this.executeModule<Info>(
        getMetaDataModule,
        provider,
        'getMeta',
        {link, provider},
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (getErrorMessage(error, '') !== 'Provider sandbox was torn down') {
        console.error('Error in meta data function:', error);
      }
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get metadata from provider: ${provider}`,
        ),
      );
    }
  };
  getStream = async ({
    link,
    type,
    signal,
    providerValue,
    isDownload,
  }: {
    link: string;
    type: string;
    signal?: AbortSignal;
    providerValue: string;
    isDownload?: boolean;
  }): Promise<Stream[]> => {
    throwIfProviderAborted(signal);
    const getStreamModule = this.getModule(providerValue, 'stream');
    if (!getStreamModule) {
      throw new Error(`No stream module found for provider: ${providerValue}`);
    }
    try {
      const startedAt = Date.now();
      const streams = await this.executeModule<Stream[]>(
        getStreamModule,
        providerValue,
        'getStream',
        {link, type, isDownload: Boolean(isDownload)},
        signal,
      );
      console.log(
        `[ProviderPerf] getStream ${providerValue} ${
          Array.isArray(streams) ? streams.length : 0
        } streams in ${Date.now() - startedAt}ms`,
      );
      return this.withJarCookies(
        getStreamModule.author,
        this.requireArray<Stream>(streams, providerValue, 'getStream'),
      );
    } catch (error) {
      console.error('Error in stream function:', error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get stream from provider: ${providerValue}`,
        ),
      );
    }
  };
  /**
   * Provider requests no longer share the native cookie store with the player,
   * so streams get their author's cookies (e.g. WAF clearance) as a header,
   * unless the provider set a Cookie header itself.
   */
  private withJarCookies(author: string, streams: Stream[]): Stream[] {
    return streams.map(stream => {
      const headers =
        stream.headers && typeof stream.headers === 'object'
          ? stream.headers
          : {};
      if (
        !/^https?:/i.test(stream.link ?? '') ||
        Object.keys(headers).some(k => k.toLowerCase() === 'cookie')
      ) {
        return stream;
      }
      const cookie = getJarCookieHeader(author, stream.link);
      return cookie
        ? {...stream, headers: {...headers, Cookie: cookie}}
        : stream;
    });
  }

  getEpisodes = async ({
    url,
    providerValue,
    signal,
  }: {
    url: string;
    providerValue: string;
    signal?: AbortSignal;
  }): Promise<EpisodeLink[]> => {
    throwIfProviderAborted(signal);
    const getEpisodeLinksModule = this.getModule(providerValue, 'episodes');
    if (!getEpisodeLinksModule) {
      throw new Error(
        `No episode links module found for provider: ${providerValue}`,
      );
    }
    try {
      const episodes = await this.executeModule<EpisodeLink[]>(
        getEpisodeLinksModule,
        providerValue,
        'getEpisodes',
        {url},
        signal,
      );
      return this.requireArray<EpisodeLink>(
        episodes,
        providerValue,
        'getEpisodes',
      );
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      console.error('Error in episodes function:', error);
      const errorMessage = getErrorMessage(
        error,
        `Failed to get episodes from provider: ${providerValue}`,
      );
      ToastAndroid.show(errorMessage, ToastAndroid.LONG);
      throw new Error(errorMessage);
    }
  };

  private settingsActionModules = new Map<string, ProviderCode>();

  runSettingsAction = async ({providerValue, sourceAuthor, key}: {
    providerValue: string; sourceAuthor?: string; key: string;
  }): Promise<void> => {
    const schema = await this.getSettingsSchema({providerValue, sourceAuthor});
    if (!schema.some(field => field.type === 'button' && field.key === key)) {
      throw new Error('Unknown provider settings action');
    }
    const module = this.settingsActionModules.get(`${sourceAuthor || ''}:${providerValue}`);
    if (!module) throw new Error('Provider settings module is unavailable');
    await this.executeModule(module, providerValue, 'onSettingsAction', {key});
  };

  getSettingsSchema = async ({
    providerValue,
    sourceAuthor,
  }: {
    providerValue: string;
    sourceAuthor?: string;
  }): Promise<SettingsField[]> => {
    const cacheKey = `${sourceAuthor || ''}:${providerValue}`;
    const cached = this.settingsSchemaCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const installedModule = extensionManager.getProviderModules(
      providerValue,
      sourceAuthor,
    );
    let settingsModule = installedModule?.modules?.settings;
    let settingsAuthor = installedModule?.sourceAuthor ?? sourceAuthor;

    if (!settingsModule) {
      // Fallback: try on-demand fetch of settings.js
      const activeSource =
        extensionStorage
          .getProviderSources()
          .find(s => !sourceAuthor || s.author === sourceAuthor) ||
        extensionStorage.getProviderSource();
      if (activeSource?.url) {
        try {
          const path = extensionStorage
            .getInstalledProviders()
            .find(
              p =>
                p.value === providerValue &&
                p.source?.author === activeSource.author,
            )?.path;
          const url = `${getProviderFilesUrl(activeSource.url, providerValue, path)}/settings.js`;
          const res = await axios.get(url, {
            timeout: 6000,
            headers: getSourceAuthHeaders(activeSource.author, url),
          });
          if (res.data && typeof res.data === 'string') {
            settingsModule = res.data;
            settingsAuthor = activeSource.author;
            const existing = extensionStorage.getProviderModules(
              providerValue,
              sourceAuthor,
            );
            if (existing) {
              extensionStorage.cacheProviderModules({
                ...existing,
                modules: {
                  ...existing.modules,
                  settings: settingsModule,
                },
              });
            }
          }
        } catch {
          // ignore download error
        }
      }
    }

    if (!settingsModule) {
      return [];
    }

    this.settingsActionModules.set(`${sourceAuthor || ''}:${providerValue}`, {code: settingsModule, author: providerAuthor(settingsAuthor)});
    try {
      const raw = await this.executeModule<unknown>(
        {code: settingsModule, author: providerAuthor(settingsAuthor)},
        providerValue,
        'getSettingsSchema',
      );
      const parsed = this.requireArray<SettingsField>(
        raw,
        providerValue,
        'getSettingsSchema',
      );
      if (parsed.length > 0) {
        this.settingsSchemaCache.set(cacheKey, parsed);
      }
      return parsed;
    } catch (error) {
      console.warn(
        `Provider ${providerValue} getSettingsSchema failed:`,
        error,
      );
      return [];
    }
  };

  clearProviderStorage = async (
    providerValue: string,
    sourceAuthor?: string,
  ): Promise<void> => {
    this.providerState.delete(providerScopeId(sourceAuthor, providerValue));
    const allKeys = await providerKvStorage.getKeys();
    const prefix = getProviderKvPrefix(sourceAuthor, providerValue);
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        providerKvStorage.delete(key);
      }
    }
  };
}

export const providerManager = new ProviderManager();
