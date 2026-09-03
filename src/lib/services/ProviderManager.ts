import {ToastAndroid} from 'react-native';
import axios from 'axios';
import {headers as commonHeaders} from '../providers/headers';
import {Catalog, EpisodeLink, Info, Post, Stream, SettingsField} from '../providers/types';
import {extensionManager} from './ExtensionManager';
import {extensionStorage} from '../storage/extensionStorage';
import {providerKvStorage} from '../storage/StorageService';
import {MAX_STATE_BYTES} from '../sandbox/protocol';
import {sandboxBridge, setSandboxStateHandler} from '../sandbox/sandboxBridge';

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
  private readonly providerState = new Map<string, Record<string, unknown>>();
  private readonly settingsSchemaCache = new Map<string, SettingsField[]>();

  constructor() {
    setSandboxStateHandler((providerValue, state) => {
      try {
        this.saveProviderState(providerValue, state);
      } catch (error) {
        console.warn('Discarding provider state:', error);
      }
    });
  }

  clearProviderState(providerValue: string): void {
    this.providerState.delete(providerValue);
    for (const key of Array.from(this.settingsSchemaCache.keys())) {
      if (key.endsWith(`:${providerValue}`)) {
        this.settingsSchemaCache.delete(key);
      }
    }
  }

  private getProviderState(providerValue: string): Record<string, unknown> {
    const current = this.providerState.get(providerValue);
    if (!current) {
      return {};
    }
    try {
      return JSON.parse(JSON.stringify(current));
    } catch {
      return {};
    }
  }

  private saveProviderState(providerValue: string, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Provider state must be an object');
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > MAX_STATE_BYTES) {
      throw new Error('Provider state exceeds the 256 KB limit');
    }
    this.providerState.set(
      providerValue,
      JSON.parse(serialized) as Record<string, unknown>,
    );
  }

  private getModule(
    providerValue: string,
    key: 'catalog' | 'posts' | 'meta' | 'stream' | 'episodes' | 'settings',
  ): string | undefined {
    return extensionManager.getProviderModules(providerValue)?.modules[key];
  }

  private executeModule<T>(
    moduleCode: string,
    providerValue: string,
    exportName?: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    return sandboxBridge.invoke<T>({
      moduleCode,
      providerValue,
      exportName,
      // commonHeaders is passed per invoke because it is platform dependent and
      // the sandbox realm cannot read Platform itself.
      args: {...args, commonHeaders},
      state: this.getProviderState(providerValue),
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
  }: {
    providerValue: string;
  }): Promise<Catalog[]> => {
    const catalogModule = this.getModule(providerValue, 'catalog');
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{
        catalog?: Catalog[] | (() => Promise<Catalog[]> | Catalog[]);
      }>(catalogModule, providerValue);
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
      return this.requireArray<Catalog>(
        genres ?? [],
        providerValue,
        'genres',
      );
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
      console.error('Error in posts function:', error);
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
  }: {
    link: string;
    provider: string;
  }): Promise<Info> => {
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
      );
    } catch (error) {
      console.error('Error in meta data function:', error);
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
    const getStreamModule = this.getModule(providerValue, 'stream');
    if (!getStreamModule) {
      throw new Error(`No stream module found for provider: ${providerValue}`);
    }
    try {
      const streams = await this.executeModule<Stream[]>(
        getStreamModule,
        providerValue,
        'getStream',
        {link, type, isDownload: Boolean(isDownload)},
        signal,
      );
      return this.requireArray<Stream>(streams, providerValue, 'getStream');
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
  getEpisodes = async ({
    url,
    providerValue,
  }: {
    url: string;
    providerValue: string;
  }): Promise<EpisodeLink[]> => {
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
      );
      return this.requireArray<EpisodeLink>(
        episodes,
        providerValue,
        'getEpisodes',
      );
    } catch (error) {
      console.error('Error in episodes function:', error);
      const errorMessage = getErrorMessage(
        error,
        `Failed to get episodes from provider: ${providerValue}`,
      );
      ToastAndroid.show(errorMessage, ToastAndroid.LONG);
      throw new Error(errorMessage);
    }
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

    let settingsModule =
      extensionManager.getProviderModules(providerValue, sourceAuthor)?.modules
        ?.settings;

    if (!settingsModule) {
      // Fallback: try on-demand fetch of settings.js
      const activeSource =
        extensionStorage
          .getProviderSources()
          .find(s => !sourceAuthor || s.author === sourceAuthor) ||
        extensionStorage.getProviderSource();
      if (activeSource?.url) {
        try {
          const url = `${activeSource.url}/dist/${providerValue}/settings.js`;
          const res = await axios.get(url, {timeout: 6000});
          if (res.data && typeof res.data === 'string') {
            settingsModule = res.data;
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

    try {
      const raw = await this.executeModule<unknown>(
        settingsModule,
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
      console.warn(`Provider ${providerValue} getSettingsSchema failed:`, error);
      return [];
    }
  };

  clearProviderStorage = async (providerValue: string): Promise<void> => {
    this.providerState.delete(providerValue);
    const allKeys = await providerKvStorage.getKeys();
    const prefix = `${providerValue}:`;
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        providerKvStorage.delete(key);
      }
    }
  };
}

export const providerManager = new ProviderManager();
