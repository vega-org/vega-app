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
  }),
);

export default useNavigationPreferencesStore;
