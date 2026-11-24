import {SettingsSearchScrollView} from '../../components/ui/SettingsSearchTarget';
import {useFocusEffect} from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useCallback, useState} from 'react';
import {BackHandler, ToastAndroid, View} from 'react-native';
import type {SettingsStackParamList} from '../../App';
import AppearancePreference from './components/AppearancePreference';
import {useFloatingTabBarInset} from '../../components/navigation/FloatingTabBarInsetContext';
import SettingsChoiceDialog from '../../components/ui/SettingsChoiceDialog';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {settingsStorage} from '../../lib/storage';
import {isTV} from '../../lib/tv';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Appearance'>;

const bottomBarStyles = [
  {value: 'material', label: 'Material', description: 'Standard navigation bar'},
  {value: 'glass', label: 'Glass', description: 'Floating, rounded navigation bar'},
] as const;

const glassSettingsSearchFallback = {
  'Hide glass bar on subpages': 'Bottom bar style',
};

const Appearance = ({navigation}: Props) => {
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const [showBottomBarStyles, setShowBottomBarStyles] = useState(false);
  const [showTabBarLabels, setShowTabBarLabels] = useState(() =>
    settingsStorage.showTabBarLabels(),
  );
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(() =>
    settingsStorage.showHamburgerMenu(),
  );
  const glassTabBar = useNavigationPreferencesStore(state => state.glassTabBar);
  const setGlassTabBar = useNavigationPreferencesStore(state => state.setGlassTabBar);
  const hideGlassTabBarInSubpages = useNavigationPreferencesStore(
    state => state.hideGlassTabBarInSubpages,
  );
  const setHideGlassTabBarInSubpages = useNavigationPreferencesStore(
    state => state.setHideGlassTabBarInSubpages,
  );
  const hideDownloadsTab = useNavigationPreferencesStore(state => state.hideDownloadsTab);
  const setHideDownloadsTab = useNavigationPreferencesStore(state => state.setHideDownloadsTab);
  const showContinueWatching = useNavigationPreferencesStore(state => state.showContinueWatching);
  const setShowContinueWatching = useNavigationPreferencesStore(state => state.setShowContinueWatching);

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.goBack();
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} style={{flex: 1}}>
      <SettingsSearchScrollView
        focusable={false}
        accessible={false}
        searchFallback={glassTabBar ? undefined : glassSettingsSearchFallback}
        style={{backgroundColor: colors.background}}
        contentContainerStyle={{padding: 20, paddingBottom: 40 + floatingTabBarInset}}
        showsVerticalScrollIndicator={false}>
        <View
          style={{alignItems: 'center', flexDirection: 'row', marginBottom: 24}}>
          <TVFocusable
            hasTVPreferredFocus={isTV}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={navigation.goBack}
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
            style={{color: colors.onBackground}}>
            Appearance
          </AppText>
        </View>
        <AppearancePreference />
        <SettingsSection title="Navigation">
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
            title="Tab bar labels"
            description="Show destination names below navigation icons"
            value={showTabBarLabels}
            onValueChange={next => {
              settingsStorage.setShowTabBarLabels(next);
              setShowTabBarLabels(next);
              ToastAndroid.show('Restart App to Apply Changes', ToastAndroid.SHORT);
            }}
          />
          <SettingsSwitchRow
            title="Hide downloads tab"
            description="Move Downloads from the tab bar to Settings"
            value={hideDownloadsTab}
            onValueChange={setHideDownloadsTab}
            divider={false}
          />
        </SettingsSection>
        <SettingsSection title="Home">
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
            divider={false}
          />
        </SettingsSection>
      </SettingsSearchScrollView>
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

export default Appearance;
