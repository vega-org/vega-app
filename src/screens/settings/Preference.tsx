import {SettingsSearchAnchor} from '../../components/ui/SettingsSearchTarget';
import {isExcludedQuality} from '../../lib/streamQuality';
import ExternalAppPreference from './components/ExternalAppPreference';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Surface from '../../components/ui/Surface';
import {useFocusEffect} from '@react-navigation/native';
import {
  View,
  ToastAndroid,
  BackHandler,
} from 'react-native';
import React, {useState, useCallback} from 'react';
import {settingsStorage} from '../../lib/storage';
import {updateProvidersService} from '../../lib/services/UpdateProviders';
import Constants from 'expo-constants';
import DownloadLocationPreference from './components/DownloadLocationPreference';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';
import DownloadConcurrencyPreference from './components/DownloadConcurrencyPreference';
import VerificationWindowPreference from './components/VerificationWindowPreference';
import TmdbApiKeyPreference from './components/TmdbApiKeyPreference';
import AppText from '../../components/ui/Text';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsChoiceDialog from '../../components/ui/SettingsChoiceDialog';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  getAnalytics,
  getCrashlytics,
  isFirebaseNativeReady,
} from '../../lib/utils/firebaseSafe';

const applyTelemetryOptIn = async (next: boolean) => {
  try {
    const crashlytics = getCrashlytics();
    crashlytics && (await crashlytics().setCrashlyticsCollectionEnabled(next));
  } catch {}
  try {
    const analytics = getAnalytics();
    analytics && (await analytics().setAnalyticsCollectionEnabled(next));
    analytics &&
      (await analytics().setConsent({
        analytics_storage: next,
        ad_storage: next,
        ad_user_data: next,
        ad_personalization: next,
      }));
  } catch {}
};

const bottomBarStyles = [
  {value: 'material', label: 'Material', description: 'Standard navigation bar'},
  {value: 'glass', label: 'Glass', description: 'Floating, rounded navigation bar'},
] as const;

const Preferences = ({navigation}: any) => {
  const [showBottomBarStyles, setShowBottomBarStyles] = useState(false);
  const hasFirebase =
    Boolean(Constants?.expoConfig?.extra?.hasFirebase) &&
    isFirebaseNativeReady();
  const colors = useM3Colors();

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );
  const [ExcludedQualities, setExcludedQualities] = useState(() =>
    settingsStorage.getExcludedQualities(),
  );

  const [tmdbInputKey, setTmdbInputKey] = useState(() => settingsStorage.getTmdbApiKey());
  useFocusEffect(useCallback(() => {
    setTmdbInputKey(settingsStorage.getTmdbApiKey());
  }, []));
  const [disableDrawer, setDisableDrawer] = useState(
    () => settingsStorage.getBool('disableDrawer') || false,
  );

  const [showHamburgerMenu, setShowHamburgerMenu] = useState<boolean>(() =>
    settingsStorage.showHamburgerMenu(),
  );

  const [showTabBarLables, setShowTabBarLables] = useState<boolean>(() =>
    settingsStorage.showTabBarLabels(),
  );
  const glassTabBar = useNavigationPreferencesStore(state => state.glassTabBar);
  const setGlassTabBar = useNavigationPreferencesStore(
    state => state.setGlassTabBar,
  );
  const hideGlassTabBarInSubpages = useNavigationPreferencesStore(
    state => state.hideGlassTabBarInSubpages,
  );
  const setHideGlassTabBarInSubpages = useNavigationPreferencesStore(
    state => state.setHideGlassTabBarInSubpages,
  );
  const hideDownloadsTab = useNavigationPreferencesStore(
    state => state.hideDownloadsTab,
  );
  const setHideDownloadsTab = useNavigationPreferencesStore(
    state => state.setHideDownloadsTab,
  );
  const showContinueWatching = useNavigationPreferencesStore(
    state => state.showContinueWatching,
  );
  const setShowContinueWatching = useNavigationPreferencesStore(
    state => state.setShowContinueWatching,
  );

  const [hapticFeedback, setHapticFeedback] = useState(() =>
    settingsStorage.isHapticFeedbackEnabled(),
  );
  const [providerAutoUpdates, setProviderAutoUpdates] = useState(() => settingsStorage.isProviderAutoUpdateEnabled());

  const [alwaysUseExternalDownload, setAlwaysUseExternalDownload] = useState(
    () => settingsStorage.getBool('alwaysExternalDownloader') || false,
  );

  const [skipInAppWebview, setSkipInAppWebview] = useState<boolean>(() =>
    settingsStorage.isSkipInAppWebview(),
  );

  const [telemetryOptIn, setTelemetryOptIn] = useState<boolean>(() =>
    settingsStorage.isTelemetryOptIn(),
  );

  return (
    <TVFocusGuide
      autoFocus={true}
      trapFocusRight={true}
      trapFocusDown={true}
      style={{flex: 1}}>
      <SettingsPage>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              Preferences
            </AppText>
          </View>
          <AppText
            role="bodyLarge"
            className="mb-7 mt-1 text-m3-on-surface-variant">
            Manage app behavior, privacy, and downloads
          </AppText>

          <SettingsSection title="Providers">
            <SettingsSwitchRow title="Auto update providers"
              description="Install provider updates automatically. Turn off to review and install updates manually in Extensions."
              value={providerAutoUpdates} onValueChange={next => {
                settingsStorage.setProviderAutoUpdateEnabled(next);
                setProviderAutoUpdates(next);
                if (next) void updateProvidersService.checkForUpdatesAndAutoUpdate().catch(error => console.warn('Provider update check failed:', error));
              }}/>
            <VerificationWindowPreference />
          </SettingsSection>
          <SettingsSection title="Experience">
            <SettingsSwitchRow
              title="Haptic feedback"
              description="Use subtle vibration for actions and selections"
              value={hapticFeedback}
              onValueChange={next => {
                settingsStorage.setHapticFeedbackEnabled(next);
                setHapticFeedback(next);
              }}
            />
            <SettingsSwitchRow
              title="Tab bar labels"
              description="Show destination names below navigation icons"
              value={showTabBarLables}
              onValueChange={next => {
                settingsStorage.setShowTabBarLabels(next);
                setShowTabBarLables(next);
                ToastAndroid.show(
                  'Restart App to Apply Changes',
                  ToastAndroid.SHORT,
                );
              }}
            />
            {!isTV && (
              <SettingsRow
                title="Bottom bar style"
                description={glassTabBar ? 'Glass' : 'Material'}
                onPress={() => setShowBottomBarStyles(true)}
              />
            )}
            {!isTV && glassTabBar && (
              <SettingsSwitchRow
                title="Hide glass bar on subpages"
                description="Hide the floating Glass bar on detail and settings pages"
                value={hideGlassTabBarInSubpages}
                onValueChange={setHideGlassTabBarInSubpages}
              />
            )}
            <SettingsSwitchRow
              title="Hide downloads tab"
              description="Move Downloads from the tab bar to Settings"
              value={hideDownloadsTab}
              onValueChange={setHideDownloadsTab}
            />
            <SettingsSwitchRow
              title="Hamburger menu"
              description="This switch currently has no effect on the Home provider menu button"
              value={showHamburgerMenu}
              onValueChange={next => {
                settingsStorage.setShowHamburgerMenu(next);
                setShowHamburgerMenu(next);
              }}
            />
            <SettingsSwitchRow
              title="Continue watching"
              description="Show the Continue watching row on Home. Playback positions are still saved."
              value={showContinueWatching}
              onValueChange={setShowContinueWatching}
            />
            <SettingsSwitchRow
              title="Disable drawer"
              description="Turn off the swipe-out provider drawer on Home"
              value={disableDrawer}
              onValueChange={next => {
                settingsStorage.setBool('disableDrawer', next);
                setDisableDrawer(next);
              }}
            />
            <SettingsSwitchRow
              title="External downloader"
              description="Send every download to another app"
              value={alwaysUseExternalDownload}
              onValueChange={next => {
                settingsStorage.setBool('alwaysExternalDownloader', next);
                setAlwaysUseExternalDownload(next);
              }}
            />
            <ExternalAppPreference kind="downloader" />
            <SettingsSwitchRow
              title="Skip in-app webview"
              description="Open web links directly in your default browser"
              value={skipInAppWebview}
              divider={!isTV}
              onValueChange={next => {
                settingsStorage.setSkipInAppWebview(next);
                setSkipInAppWebview(next);
              }}
            />
          </SettingsSection>

          {hasFirebase ? (
            <SettingsSection title="Privacy">
              <SettingsSwitchRow
                title="Usage and crash reports"
                description="Help improve Vega with anonymous diagnostics"
                value={telemetryOptIn}
                divider={false}
                onValueChange={async next => {
                  setTelemetryOptIn(next);
                  settingsStorage.setTelemetryOptIn(next);
                  await applyTelemetryOptIn(next);
                }}
              />
            </SettingsSection>
          ) : null}

          <View className="mb-6">
            <AppText
              role="labelLarge"
              className="mb-3 text-m3-on-surface-variant">
              Quality
            </AppText>
            <Surface level="low" className="p-4">
              <SettingsSearchAnchor label="Excluded Qualities">
                <AppText role="bodyLarge" className="text-m3-on-surface">
                  Excluded Qualities
                </AppText>
              </SettingsSearchAnchor>
              <AppText
                role="bodySmall"
                className="mb-4 mt-1 text-m3-on-surface-variant">
                Hide selected resolutions from stream results
              </AppText>
              <View className="flex-row flex-wrap gap-3">
                {['360p', '480p', '720p', '1080p', '4K'].map(quality => {
                  const selected = isExcludedQuality(quality, ExcludedQualities);
                  return (
                    <TVFocusable
                      key={quality}
                      borderRadius={16}
                      accessibilityRole="button"
                      accessibilityLabel={`Quality ${quality}`}
                      accessibilityState={{selected}}
                      onPress={() => {
                        if (settingsStorage.isHapticFeedbackEnabled()) {
                          RNReactNativeHapticFeedback.trigger('effectTick');
                        }
                        const newExcluded = selected
                          ? ExcludedQualities.filter(q => !isExcludedQuality(q, [quality]))
                          : [...ExcludedQualities, quality];
                        setExcludedQualities(newExcluded);
                        settingsStorage.setExcludedQualities(newExcluded);
                      }}
                      style={{
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : colors.surfaceContainerHigh,
                        borderColor: selected
                          ? colors.primary
                          : colors.outlineVariant,
                        borderRadius: 16,
                        borderWidth: 1,
                        paddingHorizontal: 18,
                        paddingVertical: 10,
                      }}>
                      <AppText
                        role="labelLargeEmphasized"
                        style={{
                          color: selected
                            ? colors.onSecondaryContainer
                            : colors.onSurface,
                        }}>
                        {quality}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>
            </Surface>
          </View>
          <TmdbApiKeyPreference draft={{inputKey: tmdbInputKey, setInputKey: setTmdbInputKey}} />

          <DownloadLocationPreference primary={colors.primary} />

          <DownloadConcurrencyPreference primary={colors.primary} />

      </SettingsPage>
      {showBottomBarStyles && (
        <SettingsChoiceDialog
          title="Bottom bar style"
          choices={bottomBarStyles}
          selected={glassTabBar ? 'glass' : 'material'}
          onSelect={style => {
            setGlassTabBar(style === 'glass');
            setShowBottomBarStyles(false);
          }}
          onDismiss={() => setShowBottomBarStyles(false)}
        />
      )}
    </TVFocusGuide>
  );
};

export default Preferences;
