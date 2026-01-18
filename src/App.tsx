import React, {useEffect} from 'react';
import './global.css';
import Home from './screens/home/Home';
import Info from './screens/home/Info';
import Player from './screens/home/Player';
import Settings from './screens/settings/Settings';
import WatchList from './screens/WatchList';
import Search from './screens/Search';
import ScrollList from './screens/ScrollList';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Entypo from '@expo/vector-icons/Entypo';
import 'react-native-reanimated';
import 'react-native-gesture-handler';
import WebView from './screens/WebView';
import SearchResults from './screens/SearchResults';
import * as SystemUI from 'expo-system-ui';
// import DisableProviders from './screens/settings/DisableProviders';
import About, {checkForUpdate} from './screens/settings/About';
import BootSplash from 'react-native-bootsplash';
import {enableFreeze, enableScreens} from 'react-native-screens';
import Preferences from './screens/settings/Preference';
import useThemeStore from './lib/zustand/themeStore';
import {Dimensions, LogBox, ViewStyle} from 'react-native';
import {EpisodeLink} from './lib/providers/types';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import TabBarBackgound from './components/TabBarBackgound';
import {TouchableOpacity} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StyleProp} from 'react-native';
import Animated from 'react-native-reanimated';
import Downloads from './screens/settings/Downloads';
import SeriesEpisodes from './screens/settings/SeriesEpisodes';
import WatchHistory from './screens/WatchHistory';
import SubtitlePreference from './screens/settings/SubtitleSettings';
import Extensions from './screens/settings/Extensions';
import Constants from 'expo-constants';
import {settingsStorage} from './lib/storage';
import {updateProvidersService} from './lib/services/UpdateProviders';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from './lib/client';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import notifee from '@notifee/react-native';
import notificationService from './lib/services/Notification';
// Lazy-load Firebase modules so app runs without google-services files
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getAnalytics = (): any | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-firebase/analytics').default;
  } catch {
    return null;
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getCrashlytics = (): any | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-firebase/crashlytics').default;
  } catch {
    return null;
  }
};

enableScreens(true);
enableFreeze(true);

const isLargeScreen = Dimensions.get('window').width > 768;

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
          params?: {
            screen?: string;
            params?: any;
          };
        };
      }
    | undefined;
  Player: {
    linkIndex: number;
    episodeList: EpisodeLink[];
    directUrl?: string;
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
    doNotTrack?: boolean;
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
  WatchList: undefined;
  Info: {link: string; provider?: string; poster?: string};
};

export type WatchHistoryStackParamList = {
  WatchHistory: undefined;
  Info: {link: string; provider?: string; poster?: string};
  SeriesEpisodes: {
    series: string;
    episodes: Array<{uri: string; size: number}>;
    thumbnails: Record<string, string>;
  };
};

export type SettingsStackParamList = {
  Settings: undefined;
  DisableProviders: undefined;
  About: undefined;
  Preferences: undefined;
  Downloads: undefined;
  WatchHistoryStack: undefined;
  SubTitlesPreferences: undefined;
  Extensions: undefined;
};

export type TabStackParamList = {
  HomeStack: undefined;
  SearchStack: undefined;
  WatchListStack: undefined;
  SettingsStack: undefined;
};
const Tab = createBottomTabNavigator<TabStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const App = () => {
  LogBox.ignoreLogs([
    'You have passed a style to FlashList',
    'new NativeEventEmitter()',
  ]);
  const HomeStack = createNativeStackNavigator<HomeStackParamList>();
  const Stack = createNativeStackNavigator<RootStackParamList>();
  const SearchStack = createNativeStackNavigator<SearchStackParamList>();
  const WatchListStack = createNativeStackNavigator<WatchListStackParamList>();
  const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
  const WatchHistoryStack =
    createNativeStackNavigator<WatchHistoryStackParamList>();
  const {primary} = useThemeStore(state => state);
  const hasFirebase = Boolean(Constants?.expoConfig?.extra?.hasFirebase);

  const showTabBarLables = settingsStorage.showTabBarLabels();

  SystemUI.setBackgroundColorAsync('black');

  useEffect(() => {
    // Apply telemetry preference before using analytics
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
          analytics().setUserProperty(
            'theme_preference',
            primary ? 'custom' : 'default',
          );
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
    return () => {
      unsubscribe();
    };
  }, []);

  // Initialize update service
  useEffect(() => {
    // Start automatic update checking at app startup
    updateProvidersService.startAutomaticUpdateCheck();

    // Cleanup on unmount
    return () => {
      updateProvidersService.stopAutomaticUpdateCheck();
    };
  }, []);

  function HomeStackScreen() {
    return (
      <HomeStack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 200,
          freezeOnBlur: true,
        }}>
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
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 200,
          freezeOnBlur: true,
        }}>
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
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 200,
          freezeOnBlur: true,
        }}>
        <WatchListStack.Screen name="WatchList" component={WatchList} />
        <WatchListStack.Screen name="Info" component={Info} />
      </WatchListStack.Navigator>
    );
  }

  function WatchHistoryStackScreen() {
    return (
      <WatchHistoryStack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 200,
          freezeOnBlur: true,
        }}>
        <WatchHistoryStack.Screen
          name="WatchHistory"
          component={WatchHistory}
        />
        <WatchHistoryStack.Screen name="Info" component={Info} />
        <WatchHistoryStack.Screen
          name="SeriesEpisodes"
          component={SeriesEpisodes}
        />
      </WatchHistoryStack.Navigator>
    );
  }

  function SettingsStackScreen() {
    return (
      <SettingsStack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 200,
          freezeOnBlur: true,
        }}>
        <SettingsStack.Screen name="Settings" component={Settings} />
        {/* <SettingsStack.Screen
          name="DisableProviders"
          component={DisableProviders}
        /> */}
        <SettingsStack.Screen name="About" component={About} />
        <SettingsStack.Screen name="Preferences" component={Preferences} />
        <SettingsStack.Screen name="Downloads" component={Downloads} />
        <SettingsStack.Screen name="Extensions" component={Extensions} />
        <SettingsStack.Screen
          name="WatchHistoryStack"
          component={WatchHistoryStackScreen}
        />
        <SettingsStack.Screen
          name="SubTitlesPreferences"
          component={SubtitlePreference}
        />
      </SettingsStack.Navigator>
    );
  }
  function TabStack() {
    return (
      <Tab.Navigator
        detachInactiveScreens={true}
        screenOptions={{
          animation: 'shift',
          tabBarLabelPosition: 'below-icon',
          tabBarVariant: isLargeScreen ? 'material' : 'uikit',
          popToTopOnBlur: false,
          tabBarPosition: isLargeScreen ? 'left' : 'bottom',
          headerShown: false,
          freezeOnBlur: true,
          tabBarActiveTintColor: primary,
          tabBarInactiveTintColor: '#dadde3',
          tabBarShowLabel: showTabBarLables,
          tabBarStyle: !isLargeScreen
            ? {
                position: 'absolute',
                bottom: 0,
                height: 55,
                borderRadius: 0,
                // backgroundColor: 'rgba(0, 0, 0, 0.8)',
                overflow: 'hidden',
                elevation: 0,
                borderTopWidth: 0,
                paddingHorizontal: 0,
                paddingTop: 5,
              }
            : {},
          tabBarBackground: () => <TabBarBackgound />,
          tabBarHideOnKeyboard: true,
          tabBarButton: props => {
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={props.accessibilityState}
                style={props.style as StyleProp<ViewStyle>}
                onPress={e => {
                  props.onPress && props.onPress(e);
                  if (
                    !props?.accessibilityState?.selected &&
                    settingsStorage.isHapticFeedbackEnabled()
                  ) {
                    RNReactNativeHapticFeedback.trigger('effectTick', {
                      enableVibrateFallback: true,
                      ignoreAndroidSystemSettings: false,
                    });
                  }
                }}>
                {props.children}
              </TouchableOpacity>
            );
          },
        }}>
        <Tab.Screen
          name="HomeStack"
          component={HomeStackScreen}
          options={{
            title: 'Home',
            tabBarIcon: ({focused, color, size}) => (
              <Animated.View
                style={{
                  transform: [{scale: focused ? 1.1 : 1}],
                }}>
                {focused ? (
                  <Ionicons name="home" color={color} size={size} />
                ) : (
                  <Ionicons name="home-outline" color={color} size={size} />
                )}
              </Animated.View>
            ),
          }}
        />
        <Tab.Screen
          name="SearchStack"
          component={SearchStackScreen}
          options={{
            title: 'Search',
            tabBarIcon: ({focused, color, size}) => (
              <Animated.View
                style={{
                  transform: [{scale: focused ? 1.1 : 1}],
                }}>
                {focused ? (
                  <Ionicons name="search" color={color} size={size} />
                ) : (
                  <Ionicons name="search-outline" color={color} size={size} />
                )}
              </Animated.View>
            ),
          }}
        />
        <Tab.Screen
          name="WatchListStack"
          component={WatchListStackScreen}
          options={{
            title: 'Watch List',
            tabBarIcon: ({focused, color, size}) => (
              <Animated.View
                style={{
                  transform: [{scale: focused ? 1.1 : 1}],
                }}>
                {focused ? (
                  <Entypo name="folder-video" color={color} size={size} />
                ) : (
                  <Entypo name="folder-video" color={color} size={size} />
                )}
              </Animated.View>
            ),
          }}
        />
        <Tab.Screen
          name="SettingsStack"
          component={SettingsStackScreen}
          options={{
            title: 'Settings',
            tabBarIcon: ({focused, color, size}) => (
              <Animated.View
                style={{
                  transform: [{scale: focused ? 1.1 : 1}],
                }}>
                {focused ? (
                  <Ionicons name="settings" color={color} size={size} />
                ) : (
                  <Ionicons name="settings-outline" color={color} size={size} />
                )}
              </Animated.View>
            ),
          }}
        />
      </Tab.Navigator>
    );
  }

  useEffect(() => {
    if (settingsStorage.isAutoCheckUpdateEnabled()) {
      checkForUpdate(() => {}, settingsStorage.isAutoDownloadEnabled(), false);
    }
  }, []);

  return (
    <GlobalErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaView
            edges={{
              right: 'off',
              top: 'off',
              left: 'off',
              bottom: 'additive',
            }}
            className="flex-1"
            style={{backgroundColor: 'black'}}>
            <NavigationContainer
              ref={navigationRef}
              onReady={async () => {
                // Hide bootsplash
                await BootSplash.hide({fade: true});
                // Track initial screen
                if (hasFirebase) {
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
                }
              }}
              onStateChange={async () => {
                if (hasFirebase) {
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
                }
              }}
              theme={{
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
                  primary: primary,
                  text: 'white',
                  border: 'black',
                  notification: primary,
                },
              }}>
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  animation: 'ios_from_right',
                  animationDuration: 200,
                  freezeOnBlur: true,
                  contentStyle: {backgroundColor: 'transparent'},
                }}>
                <Stack.Screen name="TabStack" component={TabStack} />
                <Stack.Screen
                  name="Player"
                  component={Player}
                  options={{orientation: 'landscape'}}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </SafeAreaView>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
