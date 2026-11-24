import {useMemo} from 'react';
import {providerOrderKey} from '../providerOrder';
import type {ProviderExtension} from '../storage/extensionStorage';
import useContentStore from '../zustand/contentStore';
import useNavigationPreferencesStore from '../zustand/navigationPreferencesStore';

export const isProviderVisible = (provider: ProviderExtension, hideAdult: boolean) =>
  !hideAdult || provider.adult !== true;

export function useVisibleInstalledProviders() {
  const providers = useContentStore(state => state.installedProviders);
  const hideAdult = useNavigationPreferencesStore(state => state.hideAdultProviders);
  return useMemo(
    () => hideAdult ? providers.filter(provider => isProviderVisible(provider, true)) : providers,
    [hideAdult, providers],
  );
}

export function useBrowsingProvider() {
  const selected = useContentStore(state => state.provider);
  const providers = useContentStore(state => state.installedProviders);
  const hideAdult = useNavigationPreferencesStore(state => state.hideAdultProviders);
  return useMemo(() => {
    if (!hideAdult) return selected;
    const installed = providers.find(provider => providerOrderKey(provider) === providerOrderKey(selected));
    if (isProviderVisible(installed ?? selected, true)) return selected;
    return providers.find(provider => isProviderVisible(provider, true)) ?? {...selected, value: ''};
  }, [hideAdult, providers, selected]);
}
