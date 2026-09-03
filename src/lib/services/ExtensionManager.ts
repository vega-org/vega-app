import axios from 'axios';
import {
  extensionStorage,
  ProviderExtension,
  ProviderModule,
  ProviderSource,
} from '../storage/extensionStorage';
import {mainStorage} from '../storage/StorageService';
import {createProviderSource} from '../utils/helpers';

export const isRateLimitError = (error: unknown): boolean => {
  if (!error) return false;
  const status =
    (error as any)?.response?.status ??
    (error as any)?.status;
  if (status === 403 || status === 429) {
    return true;
  }
  const msg = String((error as any)?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("status code 403") || msg.includes("status code 429");
};

export const throwIfRateLimited = (error: unknown): void => {
  if (isRateLimitError(error)) {
    throw new Error(
      'GitHub API rate limit exceeded. Please wait a few minutes before trying again.',
    );
  }
};
/**
 * Extension manager service for handling dynamic provider loading
 */
export class ExtensionManager {
  private static instance: ExtensionManager;
  private readonly legacyCustomProviderBaseUrlKey = 'customProviderBaseUrl';

  private testMode = false;
  private baseUrlTestMode = '';

  private getManifest = (url: string) => {
    return `${url}/manifest.json`;
  };

  private getActiveSource(source?: ProviderSource): ProviderSource | undefined {
    if (source) {
      return source;
    }

    return extensionStorage.getProviderSource();
  }

  private migrateLegacyCustomProviderSource(): void {
    if (extensionStorage.getProviderSources().length > 0) {
      return;
    }

    const legacyValue =
      mainStorage.getString(this.legacyCustomProviderBaseUrlKey)?.trim() || '';
    if (!legacyValue) {
      return;
    }

    try {
      const source = createProviderSource(legacyValue);
      extensionStorage.addProviderSources(source.author, source.url);
      extensionStorage.setDefaultProviderSource(source.author);

      const installedProviders = extensionStorage.getInstalledProviders();
      const migratedInstalledProviders = installedProviders.map(provider => {
        if (provider.source?.author && provider.source?.url) {
          return provider;
        }

        return {
          ...provider,
          source: {
            author: source.author,
            url: source.url,
          },
        };
      });

      extensionStorage.setInstalledProviders(migratedInstalledProviders);
      console.log('Migrated customProviderBaseUrl to provider source');
    } catch (error) {
      console.warn('Failed to migrate customProviderBaseUrl:', error);
    } finally {
      mainStorage.delete(this.legacyCustomProviderBaseUrlKey);
    }
  }

  // Test mode configuration
  private testModuleCacheExpiry = 200000;
  private testModuleCache = new Map<
    string,
    {module: ProviderModule; cachedAt: number}
  >();

  static getInstance(): ExtensionManager {
    if (!ExtensionManager.instance) {
      ExtensionManager.instance = new ExtensionManager();
    }
    return ExtensionManager.instance;
  }

  /**
   * Fetch latest manifest from GitHub
   */
  async fetchManifest(
    sourceOrForce?: ProviderSource | boolean,
    force = false,
  ): Promise<ProviderExtension[]> {
    const source =
      sourceOrForce && typeof sourceOrForce === 'object'
        ? sourceOrForce
        : undefined;
    const shouldForce =
      typeof sourceOrForce === 'boolean' ? sourceOrForce : force;
    const activeSource = this.getActiveSource(source);

    if (!activeSource) {
      throw new Error('No provider source configured');
    }

    try {
      // Check cache first
      if (
        !shouldForce &&
        !extensionStorage.isManifestCacheExpired(activeSource.author)
      ) {
        const cached = extensionStorage.getManifestCache(activeSource.author);
        if (cached.length > 0) {
          return cached;
        }
      }

      const manifestBase = this.testMode
        ? `${this.baseUrlTestMode}/manifest.json`
        : this.getManifest(activeSource.url);
      const manifestUrl = shouldForce
        ? `${manifestBase}${manifestBase.includes('?') ? '&' : '?'}t=${Date.now()}`
        : manifestBase;
      console.log('Fetching manifest from:', manifestUrl);
      const response = await axios.get(manifestUrl, {
        timeout: 10000,
        headers: shouldForce
          ? {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            }
          : undefined,
      });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid manifest format');
      }

      const providers: ProviderExtension[] = response.data.map((item: any) => ({
        value: item.value,
        display_name: item.display_name,
        disabled: item.disabled || false,
        source: activeSource,
        version: item.version,
        icon: item.icon || '',
        type: item.type || 'global',
        hasSettings: Boolean(item.hasSettings),
        installed: false,
      }));

      // Cache the manifest
      extensionStorage.setManifestCache(providers, activeSource.author);
      extensionStorage.setAvailableProviders(activeSource.author, providers);

      return providers;
    } catch (error) {
      console.error('Failed to fetch manifest:', error);
      throwIfRateLimited(error);

      const cached = extensionStorage.getManifestCache(activeSource.author);
      if (cached.length > 0) {
        return cached;
      }

      throw error;
    }
  }

  /**
   * Download and cache provider modules
   */
  async downloadProviderModules(
    sourceUrl: string,
    sourceAuthor: string,
    providerValue: string,
    version: string,
  ): Promise<ProviderModule> {
    if (this.testMode) {
      return this.downloadTestProviderModule(providerValue);
    }
    try {
      const requiredFiles = ['posts', 'meta', 'stream', 'catalog'];
      const optionalFiles = ['episodes', 'settings'];
      const allFiles = [...requiredFiles, ...optionalFiles];

      const modules: Record<string, string> = {};
      const downloadPromises = allFiles.map(async fileName => {
        try {
          const url = `${sourceUrl}/dist/${providerValue}/${fileName}.js?t=${Date.now()}`;
          console.log(`Downloading: ${url}`);

          const response = await axios.get(url, {
            timeout: 15000,
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            },
          });

          if (response.data) {
            modules[fileName] = response.data;
          }
        } catch (error) {
          throwIfRateLimited(error);
          if (requiredFiles.includes(fileName)) {
            console.error(
              `Failed to download ${fileName}.js for ${providerValue}:`,
              error,
            );
            throw error;
          } else {
            console.warn(
              `Optional file ${fileName}.js not found for ${providerValue}`,
            );
          }
        }
      });

      await Promise.all(downloadPromises);

      // Verify required files were downloaded
      const missingRequired = requiredFiles.filter(file => !modules[file]);
      if (missingRequired.length > 0) {
        throw new Error(
          `Missing required files: ${missingRequired.join(', ')}`,
        );
      }

      const providerModule: ProviderModule = {
        value: providerValue,
        sourceAuthor,
        version,
        modules: {
          posts: modules.posts,
          meta: modules.meta,
          stream: modules.stream,
          catalog: modules.catalog,
          episodes: modules.episodes,
          settings: modules.settings,
        },
        cachedAt: Date.now(),
      };

      // Cache the modules
      extensionStorage.cacheProviderModules(providerModule);

      return providerModule;
    } catch (error) {
      console.error(`Failed to download modules for ${providerValue}:`, error);
      throw error;
    }
  }

  async downloadTestProviderModule(
    providerValue: string,
  ): Promise<ProviderModule> {
    try {
      const url = `${this.baseUrlTestMode}/dist/${providerValue}/`;
      const requiredFiles = ['posts', 'meta', 'stream', 'catalog'];
      const optionalFiles = ['episodes', 'settings'];
      const allFiles = [...requiredFiles, ...optionalFiles];
      const modules: Record<string, string> = {};
      const downloadPromises = allFiles.map(async fileName => {
        try {
          const fileUrl = `${url}${fileName}.js`;
          console.log(`Downloading test module: ${fileUrl}`);

          const response = await axios.get(fileUrl, {
            timeout: 15000,
          });

          if (response.data) {
            modules[fileName] = response.data;
          } else {
            throw new Error(`No data received for ${fileName}`);
          }
        } catch (error) {
          // Only log error for required files
          if (requiredFiles.includes(fileName)) {
            console.error(
              `Failed to download ${fileName}.js for ${providerValue}:`,
              error,
            );
            throw error;
          } else {
            console.warn(
              `Optional file ${fileName}.js not found for ${providerValue}`,
            );
          }
        }
      });

      await Promise.all(downloadPromises);

      if (!modules.posts) {
        throw new Error(`No data received for ${providerValue}`);
      }

      const providerModule: ProviderModule = {
        value: providerValue,
        version: 'test',
        modules: {
          posts: modules.posts,
          meta: modules.meta,
          stream: modules.stream,
          catalog: modules.catalog,
          episodes: modules.episodes,
          settings: modules.settings,
        },
        cachedAt: Date.now(),
      };

      // Cache the test module
      this.testModuleCache.set(providerValue, {
        module: providerModule,
        cachedAt: Date.now(),
      });

      return providerModule;
    } catch (error) {
      console.error(
        `Failed to download test module for ${providerValue}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Install a provider
   */
  async installProvider(provider: ProviderExtension): Promise<void> {
    try {
      // Download the provider modules
      await this.downloadProviderModules(
        provider.source.url,
        provider.source.author,
        provider.value,
        provider.version,
      );

      // Mark as installed
      extensionStorage.installProvider(provider);

      console.log(`Successfully installed provider: ${provider.display_name}`);
    } catch (error) {
      console.error(
        `Failed to install provider ${provider.display_name}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Uninstall a provider
   */
  uninstallProvider(providerValue: string, sourceAuthor?: string): void {
    extensionStorage.uninstallProvider(providerValue, sourceAuthor);
    console.log(`Uninstalled provider: ${providerValue}`);
  }

  /**
   * Update a provider
   */
  async updateProvider(provider: ProviderExtension): Promise<void> {
    try {
      // Download updated modules
      await this.downloadProviderModules(
        provider.source.url,
        provider.source.author,
        provider.value,
        provider.version,
      );

      // Update installation record
      extensionStorage.installProvider(provider);

      console.log(`Successfully updated provider: ${provider.display_name}`);
    } catch (error) {
      console.error(
        `Failed to update provider ${provider.display_name}:`,
        error,
      );
      throw error;
    }
  }
  /**
   * Get cached provider modules (works synchronously for both normal and test mode)
   */
  getProviderModules(
    providerValue: string,
    sourceAuthor?: string,
  ): ProviderModule | undefined {
    if (this.testMode) {
      // In test mode, return cached test module and trigger background refresh
      const cached = this.testModuleCache.get(providerValue);
      if (cached) {
        // Trigger background refresh for next call
        this.refreshTestModuleInBackground(providerValue);

        return cached.module;
      }
      this.refreshTestModuleInBackground(providerValue);

      // If no test cache exists, fall back to regular cache
      console.warn(
        `No test module cache found for ${providerValue}, falling back to regular cache`,
      );
    }

    return extensionStorage.getProviderModules(providerValue, sourceAuthor);
  }

  /**
   * Check if provider needs update
   */
  checkForUpdates(author?: string): ProviderExtension[] {
    const activeAuthor = author || this.getActiveSource()?.author;
    if (!activeAuthor) {
      return [];
    }
    return extensionStorage.getProvidersNeedingUpdate(activeAuthor);
  }

  /**
   * Initialize extension system
   */
  async initialize(): Promise<void> {
    try {
      this.migrateLegacyCustomProviderSource();

      // Load providers from cache
      const source = this.getActiveSource();
      const installed = extensionStorage.getInstalledProviders();
      const available = source
        ? extensionStorage.getAvailableProviders(source.author)
        : [];

      console.log(`Loaded ${installed.length} installed providers`);
      console.log(`Loaded ${available.length} available providers`);

      if (!source) {
        console.log('No provider source configured yet');
        return;
      }

      // Try to fetch latest manifest if cache is expired
      if (extensionStorage.isManifestCacheExpired(source.author)) {
        try {
          await this.fetchManifest(source, false);
        } catch (error) {
          console.warn('Failed to refresh manifest on startup:', error);
        }
      }
    } catch (error) {
      console.error('Failed to initialize extension system:', error);
    }
  }

  /**
   * Enable/disable test mode
   */
  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
    console.log(`Test mode ${enabled ? 'enabled' : 'disabled'}`);
  }
  /**
   * Check if test module cache is expired
   */
  private isTestModuleCacheExpired(providerValue: string): boolean {
    const cached = this.testModuleCache.get(providerValue);
    if (!cached) {
      return true;
    }

    return Date.now() - cached.cachedAt > this.testModuleCacheExpiry;
  }
  /**
   * Pre-fetch test modules to ensure they're available synchronously
   */
  async preFetchTestModules(providerValues: string[]): Promise<void> {
    if (!this.testMode) {
      return;
    }

    console.log('Pre-fetching test modules for:', providerValues);

    const fetchPromises = providerValues.map(async providerValue => {
      try {
        const module = await this.downloadTestProviderModule(providerValue);
        this.testModuleCache.set(providerValue, {
          module,
          cachedAt: Date.now(),
        });
        console.log(`Pre-fetched test module for: ${providerValue}`);
      } catch (error) {
        console.error(
          `Failed to pre-fetch test module for ${providerValue}:`,
          error,
        );
      }
    });

    await Promise.allSettled(fetchPromises);
  }
  /**
   * Refresh test module in background if needed
   */
  private refreshTestModuleInBackground(providerValue: string): void {
    if (!this.testMode) {
      return;
    }

    // Refresh in background without blocking
    this.downloadTestProviderModule(providerValue)
      .then(module => {
        this.testModuleCache.set(providerValue, {
          module,
          cachedAt: Date.now(),
        });
        console.log(`Background refreshed test module for: ${providerValue}`);
      })
      .catch(error => {
        console.error(
          `Failed to background refresh test module for ${providerValue}:`,
          error,
        );
      });
  }
}

/**
 * Global extension manager instance
 */
export const extensionManager = ExtensionManager.getInstance();
