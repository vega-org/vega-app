import type {ProviderExtension} from '../storage/extensionStorage';

/** Keys of the providers the author disabled in the manifest. */
export const deprecatedProviderKeys = (
  available: ProviderExtension[],
  fallbackAuthor = '',
): Set<string> => {
  const keys = new Set<string>();
  for (const provider of available) {
    if (!provider?.value || !provider.disabled) continue;
    keys.add(`${provider.source?.author || fallbackAuthor}:${provider.value}`);
  }
  return keys;
};
