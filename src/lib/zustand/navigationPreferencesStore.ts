import {create} from 'zustand';
import {settingsStorage} from '../storage';

interface NavigationPreferencesState {
  glassTabBar: boolean;
  setGlassTabBar: (enabled: boolean) => void;
  hideGlassTabBarInSubpages: boolean;
  setHideGlassTabBarInSubpages: (hide: boolean) => void;
  hideDownloadsTab: boolean;
  setHideDownloadsTab: (hide: boolean) => void;
  showContinueWatching: boolean;
  setShowContinueWatching: (show: boolean) => void;
  showHeroLibraryButton: boolean;
  hideAdultProviders: boolean;
  setHideAdultProviders: (hide: boolean) => void;
  setShowHeroLibraryButton: (show: boolean) => void;
  holdPreviewEnabled: boolean;
  setHoldPreviewEnabled: (enabled: boolean) => void;
  holdPreviewOnlyWhileHolding: boolean;
  setHoldPreviewOnlyWhileHolding: (enabled: boolean) => void;
}

const useNavigationPreferencesStore = create<NavigationPreferencesState>(
  set => ({
    glassTabBar: settingsStorage.isGlassTabBarEnabled(),
    setGlassTabBar: enabled => {
      settingsStorage.setGlassTabBarEnabled(enabled);
      set({glassTabBar: enabled});
    },
    hideGlassTabBarInSubpages: settingsStorage.hideGlassTabBarInSubpages(),
    setHideGlassTabBarInSubpages: hide => {
      settingsStorage.setHideGlassTabBarInSubpages(hide);
      set({hideGlassTabBarInSubpages: hide});
    },
    hideDownloadsTab: settingsStorage.hideDownloadsTab(),
    setHideDownloadsTab: hide => {
      settingsStorage.setHideDownloadsTab(hide);
      set({hideDownloadsTab: hide});
    },
    showContinueWatching: settingsStorage.showContinueWatching(),
    setShowContinueWatching: show => {
      settingsStorage.setShowContinueWatching(show);
      set({showContinueWatching: show});
    },
    showHeroLibraryButton: settingsStorage.showHeroLibraryButton(),
    hideAdultProviders: settingsStorage.hideAdultProviders(),
    setHideAdultProviders: hide => {
      settingsStorage.setHideAdultProviders(hide);
      set({hideAdultProviders: hide});
    },
    setShowHeroLibraryButton: show => {
      settingsStorage.setShowHeroLibraryButton(show);
      set({showHeroLibraryButton: show});
    },
    holdPreviewEnabled:
      typeof settingsStorage.isHoldPreviewEnabled === 'function'
        ? settingsStorage.isHoldPreviewEnabled()
        : true,
    setHoldPreviewEnabled: enabled => {
      if (typeof settingsStorage.setHoldPreviewEnabled === 'function') {
        settingsStorage.setHoldPreviewEnabled(enabled);
      }
      set({holdPreviewEnabled: enabled});
    },
    holdPreviewOnlyWhileHolding:
      typeof settingsStorage.isHoldPreviewOnlyWhileHolding === 'function'
        ? settingsStorage.isHoldPreviewOnlyWhileHolding()
        : false,
    setHoldPreviewOnlyWhileHolding: enabled => {
      if (
        typeof settingsStorage.setHoldPreviewOnlyWhileHolding === 'function'
      ) {
        settingsStorage.setHoldPreviewOnlyWhileHolding(enabled);
      }
      set({holdPreviewOnlyWhileHolding: enabled});
    },
  }),
);

export default useNavigationPreferencesStore;
