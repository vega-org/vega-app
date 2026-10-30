import {
  navigationWorkListeners,
  beginUIInteraction,
  endUIInteraction,
  flushInteractionCommits,
  scheduleWhenIdle,
} from './lib/performance/idleWork';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import './global.css';
import Home from './screens/home/Home';
import Info from './screens/home/Info';
import Player from './screens/home/Player';
import {getInitialVideoIntent, subscribeVideoIntent, setVideoIntentsEnabled, supportsVideoIntents, videoIntentPlayerParams, type VideoIntentPayload} from './lib/services/videoIntent';
import Settings from './screens/settings/Settings';
import Library from './screens/Library';
import LocalContent from './screens/LocalContent';
import Search from './screens/Search';
import {isTV} from './lib/tv';
import ScrollList from './screens/ScrollList';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import 'react-native-reanimated';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import WebView from './screens/WebView';
import SearchResults from './screens/SearchResults';
// import DisableProviders from './screens/settings/DisableProviders';
import About, {checkForUpdate} from './screens/settings/About';
import BootSplash from 'react-native-bootsplash';
import {SystemBars} from 'react-native-edge-to-edge';
import {enableFreeze, enableScreens} from 'react-native-screens';
import Preferences from './screens/settings/Preference';
import PlayerSettings from './screens/settings/PlayerSettings';
import PlayerControlSettings from './screens/settings/PlayerControlSettings';
import Appearance from './screens/settings/Appearance';
import {M3ThemeProvider} from './theme/M3ThemeProvider';
import {AppState, Linking, LogBox, useWindowDimensions} from 'react-native';
import {vegaCastService} from './lib/remote/vegaCastService';
import {EpisodeLink, Stream} from './lib/providers/types';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Downloads from './screens/downloads/Downloads';
import DownloadedDetails from './screens/downloads/DownloadedDetails';
import SubtitlePreference from './screens/settings/SubtitleSettings';
import Extensions from './screens/settings/Extensions';
import Constants from 'expo-constants';
import {settingsStorage} from './lib/storage';
import {syncParallelStreaming} from './lib/parallelStreaming';
import {updateProvidersService} from './lib/services/UpdateProviders';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from './lib/client';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import notifee, {EventType} from '@notifee/react-native';
import notificationService from './lib/services/Notification';
import WafWebViewDialog from './components/WafWebViewDialog';
import VerificationConsentDialog from './components/VerificationConsentDialog';
import ProviderSandboxHost from './components/ProviderSandboxHost';
import {syncDohSettings} from './lib/services/dohService';
import {syncWarpSettings} from './lib/services/warpService';
import {syncByeDpiSettings} from './lib/services/byeDpiService';
import {
  getInitialSourceIntent,
  setPendingSourceToken,
  subscribeSourceIntent,
  type SourceIntentPayload,
} from './lib/services/sourceIntent';
import {
  reconcileCompletedDownloadOutputs,
  reconcileDownloadState,
} from './lib/downloadReconciliation';
import useDownloadsStore from './lib/zustand/downloadsStore';
import useNavigationPreferencesStore from './lib/zustand/navigationPreferencesStore';
import {
  initializeSyncService,
  publishSyncManifest,
  syncFromSharedFolder,
} from './lib/sync/syncService';
import StreamingTabBar from './components/navigation/StreamingTabBar';
import AppDialogHost from './components/AppDialogHost';
import {RemoteVolumeToast} from './components/remote-player/RemoteVolumeToast';
import {
  getAnalytics,
  getCrashlytics,
  isFirebaseNativeReady,
} from './lib/utils/firebaseSafe';

enableScreens(true);
enableFreeze(true);

export type HomeStackParamList = {
  Home: undefined;
  Info: {link: string; provider?: string; poster?: string};
  ScrollList: {
    filter: string;
    title?: string;
    providerValue?: string;
    isSearch: boolean;
  };
  Webview: {link: string};
};

export type RootStackParamList = {
  TabStack:
    | {
        screen?: keyof TabStackParamList;
        params?: {
          screen?: string;
          // Nested screen params, or a leaf screen's own params.
          params?: Record<string, unknown>;
        };
      }
    | undefined;
  Player: {
    linkIndex: number;
    episodeList: EpisodeLink[];
    directUrl?: string;
    localContent?: boolean;
    externalVideo?: {mimeType: string};
    type: string;
    primaryTitle?: string;
    secondaryTitle?: string;
    poster: {
      logo?: string;
      poster?: string;
      background?: string;
    };
    file?: string;
    providerValue?: string;
    infoUrl?: string;
    alwaysCast?: boolean;
    // Plays first, before online servers load (an unfinished download).
    initialStream?: Stream;
  };
};

export type SearchStackParamList = {
  Search: undefined;
  ScrollList: {
    filter: string;
    title?: string;
    providerValue?: string;
    isSearch: boolean;
  };
  Info: {link: string; provider?: string; poster?: string};
  SearchResults: {filter: string; availableProviders?: string[]};
};

export type WatchListStackParamList = {
  LocalContent: {editId?: string; collectionId?: string} | undefined;
  WatchList: undefined;
  Info: {link: string; provider?: string; poster?: string};
};

export type SettingsStackParamList = {
  Settings: undefined;
  Appearance: undefined;
  DisableProviders: undefined;
  About: undefined;
  Preferences: undefined;
  PlayerSettings: undefined;
  PlayerControlSettings: undefined;
  SubTitlesPreferences: undefined;
  Extensions: {addSource?: string; requestId?: number} | undefined;
  DownloadsStack: undefined;
};

export type DownloadsStackParamList = {
  Downloads: undefined;
  DownloadedDetails: {groupId: string; localTitleId?: never} | {localTitleId: string; groupId?: never};
  Info: {link: string; provider?: string; poster?: string};
};

export type TabStackParamList = {
  HomeStack: undefined;
  SearchStack: undefined;
  WatchListStack: undefined;
  DownloadsStack: undefined;
  SettingsStack: undefined;
};
const Tab = createBottomTabNavigator<TabStackParamList>();
// Navigators and their screen components live at module scope. Created inside
// App, every App render made new component types and remounted all tabs.
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const SearchStack = createNativeStackNavigator<SearchStackParamList>();
const WatchListStack = createNativeStackNavigator<WatchListStackParamList>();
const DownloadsStack = createNativeStackNavigator<DownloadsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
let pendingVideo: VideoIntentPayload | undefined;
const openVideoIntent = (payload: VideoIntentPayload): void => {
  if (!settingsStorage.isOpenVideosFromOtherAppsEnabled()) return;
  if (!navigationRef.isReady()) {
    pendingVideo = payload;
    return;
  }
  pendingVideo = undefined;
  // Replace an already-open player so its episode and stream state is reset.
  navigationRef.dispatch({
    type: navigationRef.getCurrentRoute()?.name === 'Player' ? 'REPLACE' : 'PUSH',
    payload: {name: 'Player', params: videoIntentPlayerParams(payload)},
  });
};
let pendingDownloadsNavigation = false;
let pendingAddSource: SourceIntentPayload | undefined;

LogBox.ignoreLogs([
  'You have passed a style to FlashList',
  'new NativeEventEmitter()',
  'Failed to fetch manifest',
]);

export const openDownloadsScreen = (): void => {
  if (!navigationRef.isReady()) {
    pendingDownloadsNavigation = true;
    return;
  }
  pendingDownloadsNavigation = false;
  if (settingsStorage.hideDownloadsTab()) {
    navigationRef.navigate('TabStack', {
      screen: 'SettingsStack',
      params: {screen: 'DownloadsStack'},
    });
    return;
  }
  navigationRef.navigate('TabStack', {screen: 'DownloadsStack'});
};

// Opens Extensions with the add source dialog prefilled. The user still
// confirms there, so another app or web page cannot add a source silently.
const openAddSourceScreen = (payload: SourceIntentPayload): void => {
  if (!navigationRef.isReady()) {
    pendingAddSource = payload;
    return;
  }
  pendingAddSource = undefined;
  const requestId = Date.now();
  setPendingSourceToken(requestId, payload.token);
  navigationRef.navigate('TabStack', {
    screen: 'SettingsStack',
    params: {
      screen: 'Extensions',
      params: {addSource: payload.url, requestId},
    },
  });
};

const stackScreenOptions = {
  headerShown: false,
  animation: 'ios_from_right',
  animationDuration: 200,
  freezeOnBlur: true,
} as const;

const rootStackScreenOptions = {
  ...stackScreenOptions,
  contentStyle: {backgroundColor: 'transparent'},
} as const;

const navigationTheme = {
  fonts: {
    regular: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
    },
    medium: {
      fontFamily: 'Inter_500Medium',
      fontWeight: '500',
    },
    bold: {
      fontFamily: 'Inter_700Bold',
      fontWeight: '700',
    },
    heavy: {
      fontFamily: 'Inter_800ExtraBold',
      fontWeight: '800',
    },
  },
  dark: true,
  colors: {
    background: 'transparent',
    card: 'black',
    primary: '#E4E4E4',
    text: 'white',
    border: 'black',
    notification: '#E4E4E4',
  },
} as const;

const playerScreenOptions = ({route}: {route: {params?: object}}) => {
  const isRemotePortrait =
    !isTV &&
    (Boolean((route.params as any)?.alwaysCast) ||
      settingsStorage.isAlwaysCastMode());
  return {
    orientation: isTV
      ? ('landscape' as const)
      : isRemotePortrait
        ? ('portrait' as const)
        : ('default' as const),
    statusBarHidden: isTV || !isRemotePortrait,
    navigationBarHidden: isTV || !isRemotePortrait,
    autoHideHomeIndicator: isTV || !isRemotePortrait,
  };
};

const logScreenView = async () => {
  try {
    const route = navigationRef.getCurrentRoute();
    if (route?.name) {
      const analytics = getAnalytics();
      analytics &&
        (await analytics().logScreenView({
          screen_name: route.name,
          screen_class: 'Navigation',
        }));
    }
  } catch {}
};

type TabIconProps = {focused: boolean; color: string; size: number};
type TabIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const makeTabIcon =
  (focusedName: TabIconName, unfocusedName: TabIconName) =>
  ({focused, color, size}: TabIconProps) => (
    <MaterialCommunityIcons
      name={focused ? focusedName : unfocusedName}
      color={color}
      size={size}
    />
  );

const homeTabOptions = {
  title: 'Home',
  tabBarIcon: makeTabIcon('home-variant', 'home-variant-outline'),
};
const searchTabOptions = {
  title: 'Search',
  tabBarIcon: makeTabIcon('magnify', 'magnify'),
};
const watchListTabOptions = {
  title: 'Library',
  tabBarIcon: makeTabIcon('bookmark', 'bookmark-outline'),
};
const downloadsTabOptions = {
  title: 'Downloads',
  tabBarIcon: makeTabIcon('download', 'download-outline'),
};
const settingsTabOptions = {
  title: 'Settings',
  tabBarIcon: makeTabIcon('cog', 'cog-outline'),
};

const renderTabBar = (props: React.ComponentProps<typeof StreamingTabBar>) => (
  <StreamingTabBar {...props} />
);

function HomeStackScreen() {
  return (
    <HomeStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <HomeStack.Screen name="Home" component={Home} />
      <HomeStack.Screen name="Info" component={Info} />
      <HomeStack.Screen name="ScrollList" component={ScrollList} />
      <HomeStack.Screen name="Webview" component={WebView} />
    </HomeStack.Navigator>
  );
}

function SearchStackScreen() {
  return (
    <SearchStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <SearchStack.Screen name="Search" component={Search} />
      <SearchStack.Screen name="ScrollList" component={ScrollList} />
      <SearchStack.Screen name="Info" component={Info} />
      <SearchStack.Screen name="SearchResults" component={SearchResults} />
      <HomeStack.Screen name="Webview" component={WebView} />
    </SearchStack.Navigator>
  );
}

function WatchListStackScreen() {
  return (
    <WatchListStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <WatchListStack.Screen name="WatchList" component={Library} />
      <WatchListStack.Screen name="LocalContent" component={LocalContent} />
      <WatchListStack.Screen name="Info" component={Info} />
    </WatchListStack.Navigator>
  );
}

function DownloadsStackScreen() {
  return (
    <DownloadsStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <DownloadsStack.Screen name="Downloads" component={Downloads} />
      <DownloadsStack.Screen
        name="DownloadedDetails"
        component={DownloadedDetails}
      />
      <DownloadsStack.Screen name="Info" component={Info} />
    </DownloadsStack.Navigator>
  );
}

function SettingsStackScreen() {
  const insets = useSafeAreaInsets();
  const subpageOptions = useMemo(
    () => ({contentStyle: {flex: 1, paddingTop: isTV ? 0 : insets.top}}),
    [insets.top],
  );

  return (
    <SettingsStack.Navigator
      screenListeners={navigationWorkListeners}
      screenOptions={stackScreenOptions}>
      <SettingsStack.Screen name="Settings" component={Settings} />
      <SettingsStack.Screen
        name="Appearance"
        component={Appearance}
        options={subpageOptions}
      />
      {/* <SettingsStack.Screen
        name="DisableProviders"
        component={DisableProviders}
      /> */}
      <SettingsStack.Screen
        name="About"
        component={About}
        options={subpageOptions}
      />
      <SettingsStack.Screen name="PlayerSettings" component={PlayerSettings} options={subpageOptions} />
      <SettingsStack.Screen name="PlayerControlSettings" component={PlayerControlSettings} options={subpageOptions} />
      <SettingsStack.Screen
        name="Preferences"
        component={Preferences}
        options={subpageOptions}
      />
      <SettingsStack.Screen
        name="Extensions"
        component={Extensions}
        options={subpageOptions}
      />
      <SettingsStack.Screen
        name="DownloadsStack"
        component={DownloadsStackScreen}
      />
      <SettingsStack.Screen
        name="SubTitlesPreferences"
        component={SubtitlePreference}
        options={subpageOptions}
      />
    </SettingsStack.Navigator>
  );
}

function TabStack() {
  // Native tab retention can leave inactive Screen roots above Home on Android.
  // Use the navigator's native detach policy until retention is touch-safe.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const isLargeScreen = isTV || Math.min(windowWidth, windowHeight) >= 600;
  const hideDownloadsTab = useNavigationPreferencesStore(
    state => state.hideDownloadsTab,
  );
  const screenOptions = useMemo(
    () => ({
      animation: isTV ? ('shift' as const) : ('fade' as const),
      popToTopOnBlur: false,
      tabBarPosition: isLargeScreen ? ('left' as const) : ('bottom' as const),
      headerShown: false,
      freezeOnBlur: true,
      tabBarHideOnKeyboard: true,
    }),
    [isLargeScreen],
  );
  const tabs = (
    <Tab.Navigator
      screenListeners={navigationWorkListeners}
      detachInactiveScreens
      tabBar={renderTabBar}
      screenOptions={screenOptions}>
      <Tab.Screen
        name="HomeStack"
        component={HomeStackScreen}
        options={homeTabOptions}
      />
      <Tab.Screen
        name="SearchStack"
        component={SearchStackScreen}
        options={searchTabOptions}
      />
      <Tab.Screen
        name="WatchListStack"
        component={WatchListStackScreen}
        options={watchListTabOptions}
      />
      {!hideDownloadsTab && (
        <Tab.Screen
          name="DownloadsStack"
          component={DownloadsStackScreen}
          options={downloadsTabOptions}
        />
      )}
      <Tab.Screen
        name="SettingsStack"
        component={SettingsStackScreen}
        options={settingsTabOptions}
      />
    </Tab.Navigator>
  );
  return tabs;
}

const App = () => {
  useEffect(()=>{
    void Linking.getInitialURL().then(url=>{if(url)vegaCastService.handleInvitation(url);});
    const subscription=Linking.addEventListener('url',event=>{vegaCastService.handleInvitation(event.url);});
    return()=>subscription.remove();
  },[]);
  const [hasFirebase] = useState(
    () =>
      Boolean(Constants?.expoConfig?.extra?.hasFirebase) &&
      isFirebaseNativeReady(),
  );

  useEffect(() => {
    syncParallelStreaming();
  }, []);

  // Safety fallback to ensure splash is hidden
  useEffect(() => {
    const timer = setTimeout(() => {
      BootSplash.hide({fade: true}).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Reconcile downloads once the store hydrates, then start shared folder sync.
  useEffect(() => {
    let reconciled = false;
    const reconcile = () => {
      if (reconciled) {
        return;
      }
      reconciled = true;
      reconcileDownloadState()
        .then(() => initializeSyncService())
        .catch(error => console.error('Download startup failed:', error));
    };

    if (useDownloadsStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useDownloadsStore.persist.onFinishHydration(reconcile);
  }, []);

  // One AppState listener and one timer. They were registered twice, so every
  // foreground, background and 30 s tick ran the sync twice.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        endUIInteraction('app-background');
        reconcileCompletedDownloadOutputs().catch(error =>
          console.warn('Download foreground reconciliation failed:', error),
        );
        syncFromSharedFolder().catch(error =>
          console.warn('[VegaSync] Foreground sync failed:', error),
        );
      } else {
        beginUIInteraction('app-background');
        flushInteractionCommits();
        publishSyncManifest().catch(error =>
          console.warn('[VegaSync] Background publish failed:', error),
        );
      }
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        scheduleWhenIdle(() => syncFromSharedFolder());
      }
    }, 30000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const optIn = settingsStorage.isTelemetryOptIn();
    if (hasFirebase) {
      try {
        const crashlytics = getCrashlytics();
        crashlytics && crashlytics().setCrashlyticsCollectionEnabled(optIn);
      } catch {}
      try {
        const analytics = getAnalytics();
        analytics && analytics().setAnalyticsCollectionEnabled(optIn);
      } catch {}
      try {
        const analytics = getAnalytics();
        analytics &&
          analytics().setConsent({
            analytics_storage: optIn,
            ad_storage: optIn,
            ad_user_data: optIn,
            ad_personalization: optIn,
          });
      } catch {}

      // Mark app open
      try {
        const analytics = getAnalytics();
        analytics && analytics().logAppOpen();
      } catch {}
      // Example user property: theme
      try {
        const analytics = getAnalytics();
        analytics &&
          analytics().setUserProperty('theme_preference', 'fixed-neutral');
      } catch {}

      // Initial Crashlytics log
      try {
        const crashlytics = getCrashlytics();
        crashlytics && crashlytics().log('App mounted');
      } catch {}
    }

    const unsubscribe = notifee.onForegroundEvent(({type, detail}) => {
      notificationService.actionHandler({type, detail});
    });
    notifee
      .getInitialNotification()
      .then(initialNotification => {
        if (!initialNotification) {
          return;
        }
        const pressActionId = initialNotification.pressAction?.id;
        return notificationService.actionHandler({
          type:
            pressActionId && pressActionId !== 'default'
              ? EventType.ACTION_PRESS
              : EventType.PRESS,
          detail: initialNotification,
        });
      })
      .catch(error =>
        console.warn('Failed to handle initial notification:', error),
      );
    return () => {
      unsubscribe();
    };
  }, [hasFirebase]);

  // Initialize update service
  useEffect(() => {
    // Start automatic update checking at app startup
    updateProvidersService.startAutomaticUpdateCheck();

    // Cleanup on unmount
    return () => {
      updateProvidersService.stopAutomaticUpdateCheck();
    };
  }, []);

  // Initialize DNS over HTTPS, Cloudflare WARP & ByeDPI
  useEffect(() => {
    syncDohSettings().catch(e =>
      console.warn('[DoH] Failed to sync settings:', e),
    );
    syncWarpSettings().catch(e =>
      console.warn('[WARP] Failed to sync settings:', e),
    );
    syncByeDpiSettings().catch(e =>
      console.warn('[ByeDPI] Failed to sync settings:', e),
    );
  }, []);

  useEffect(() => {
    const isPlayStore = Constants.expoConfig?.extra?.isPlayStore;
    if (!isPlayStore && settingsStorage.isAutoCheckUpdateEnabled()) {
      checkForUpdate(() => {}, settingsStorage.isAutoDownloadEnabled(), false);
    }
  }, []);

  useEffect(() => subscribeSourceIntent(openAddSourceScreen), []);
  useEffect(() => subscribeVideoIntent(openVideoIntent), []);
  useEffect(() => {
    if (supportsVideoIntents)
      setVideoIntentsEnabled(settingsStorage.isOpenVideosFromOtherAppsEnabled())
        .catch(error => console.warn('Failed to update video Open with support:', error));
  }, []);

  const handleNavigationReady = useCallback(async () => {
    if (pendingDownloadsNavigation) {
      openDownloadsScreen();
    }
    // Hide bootsplash
    await BootSplash.hide({fade: true});
    const initialSource = pendingAddSource ?? (await getInitialSourceIntent());
    if (initialSource) {
      openAddSourceScreen(initialSource);
    }
    try {
      const initialVideo = pendingVideo ?? (await getInitialVideoIntent());
      if (initialVideo) openVideoIntent(initialVideo);
    } catch (error) {
      console.warn('Failed to open incoming video:', error);
    }
    // Track initial screen
    if (hasFirebase) {
      await logScreenView();
    }
  }, [hasFirebase]);

  const handleNavigationStateChange = useCallback(async () => {
    if (hasFirebase) {
      await logScreenView();
    }
  }, [hasFirebase]);

  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      <M3ThemeProvider>
        <AppDialogHost />
        <GlobalErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{flex: 1, backgroundColor: 'black'}}>
              <NavigationContainer
                ref={navigationRef}
                onReady={handleNavigationReady}
                onStateChange={handleNavigationStateChange}
                theme={navigationTheme}>
                <Stack.Navigator
                  screenListeners={navigationWorkListeners}
                  screenOptions={rootStackScreenOptions}>
                  <Stack.Screen name="TabStack" component={TabStack} />
                  <Stack.Screen
                    name="Player"
                    component={Player}
                    options={playerScreenOptions}
                  />
                </Stack.Navigator>
              </NavigationContainer>
              {/* Global WAF / captcha solving dialog, triggered by providers via
                providerContext.openWebView */}
              <VerificationConsentDialog />
              <WafWebViewDialog />
              <RemoteVolumeToast />
              {/* Isolated realm that runs untrusted provider code. Must stay
                mounted for the app lifetime: every provider call is dispatched
                into it. */}
              <ProviderSandboxHost />
            </GestureHandlerRootView>
          </QueryClientProvider>
        </GlobalErrorBoundary>
      </M3ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;
