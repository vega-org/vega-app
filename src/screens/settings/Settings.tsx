import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import {
  View,
  ScrollView,
  findNodeHandle,
  Keyboard,
  TextInput,
  BackHandler,
} from 'react-native';

interface ProviderItemProps {
  item: ProviderExtension;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  colors: any;
  onSelect: (item: ProviderExtension) => void;
}

import useTVNavigationStore from '../../lib/zustand/tvNavigationStore';

const ProviderItem = React.memo(
  ({
    item,
    isSelected,
    isFirst,
    isLast,
    colors,
    onSelect,
  }: ProviderItemProps) => {
    const itemRef = React.useRef<View>(null);
    const [handle, setHandle] = React.useState<number | null>(null);
    const screenFocused = useIsFocused();

    return (
      <View
        style={{
          height: 84,
          marginRight: 12,
          width: 132,
        }}>
        <TVFocusable
          ref={itemRef}
          onLayout={() => {
            if (!isTV) return;
            if (itemRef.current) {
              const h = findNodeHandle(itemRef.current);
              setHandle(h);
              if (screenFocused && isFirst && h) {
                useTVNavigationStore.getState().setActiveScreenFocusHandle(h);
              }
            }
          }}
          onFocus={() => {
            if (itemRef.current) {
              const h = findNodeHandle(itemRef.current);
              if (screenFocused && h) {
                useTVNavigationStore.getState().setActiveScreenFocusHandle(h);
              }
            }
          }}
          hasTVPreferredFocus={isTV && isFirst}
          nextFocusRight={isLast ? handle : undefined}
          onPress={() => onSelect(item)}
          borderRadius={20}
          focusScale={1.08}
          style={{
            flex: 1,
            backgroundColor: isSelected ? colors.secondaryContainer : '#2A2A2A',
            borderColor: isSelected ? colors.primary : '#5A5A5A',
            borderRadius: 20,
            borderWidth: isSelected ? 2 : 1,
          }}>
          <View className="flex-col items-center justify-center h-full p-3">
            <RenderProviderFlagIcon type={item.type} />
            <AppText
              numberOfLines={1}
              role="labelMediumEmphasized"
              style={{
                color: isSelected
                  ? colors.onSecondaryContainer
                  : colors.onSurface,
                marginTop: 9,
                textAlign: 'center',
              }}>
              {item.display_name}
            </AppText>
            {isSelected && (
              <View style={{position: 'absolute', right: 8, top: 8}}>
                <MaterialIcons
                  name="check-circle"
                  size={18}
                  color={colors.onSecondaryContainer}
                />
              </View>
            )}
          </View>
        </TVFocusable>
      </View>
    );
  },
);
import React, {useCallback, useMemo} from 'react';
import {
  settingsStorage,
  ProviderExtension,
} from '../../lib/storage';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import useContentStore from '../../lib/zustand/contentStore';
import {
  NativeStackScreenProps,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {SettingsStackParamList, TabStackParamList} from '../../App';
import {MaterialIcons} from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import RenderProviderFlagIcon from '../../components/RenderProviderFLagIcon';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';
import GitHubStarButton from './components/GitHubStarButton';
import DnsPreference from './components/DnsPreference';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

const AnimatedSection = ({
  children,
}: {
  delay: number;
  children: React.ReactNode;
}) => <View>{children}</View>;

const Settings = ({navigation}: Props) => {
  const providerManagerRowRef = React.useRef<View>(null);
  const tabNavigation =
    useNavigation<NativeStackNavigationProp<TabStackParamList>>();
  const colors = useM3Colors();
  const provider = useContentStore(state => state.provider);
  const setProvider = useContentStore(state => state.setProvider);
  const installedProviders = useContentStore(state => state.installedProviders);
  const hideDownloadsTab = useNavigationPreferencesStore(
    state => state.hideDownloadsTab,
  );

  const handleProviderSelect = useCallback(
    (item: ProviderExtension) => {
      setProvider(item);
      // Add haptic feedback
      if (settingsStorage.isHapticFeedbackEnabled()) {
        ReactNativeHapticFeedback.trigger('virtualKey', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
      // Navigate to home screen
      tabNavigation.navigate('HomeStack');
    },
    [setProvider, tabNavigation],
  );

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      const backAction = () => {
        const currentlyFocused =
          (TextInput as any).currentlyFocusedInput?.() ||
          (TextInput as any).State?.currentlyFocusedInput?.();
        if (currentlyFocused || Keyboard.isVisible()) {
          (currentlyFocused as any)?.blur?.();
          Keyboard.dismiss();
          return true;
        }
        if (navigation.canGoBack()) {
          navigation.goBack();
          return true;
        }
        tabNavigation.navigate('HomeStack');
        return true;
      };
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        backAction,
      );
      return () => backHandler.remove();
    }, [navigation, tabNavigation]),
  );

  const providersList = useMemo(
    () =>
      installedProviders.map((item, index) => (
        <ProviderItem
          key={item.value}
          item={item}
          isSelected={provider.value === item.value}
          isFirst={index === 0}
          isLast={index === installedProviders.length - 1}
          colors={colors}
          onSelect={handleProviderSelect}
        />
      )),
    [installedProviders, provider.value, colors, handleProviderSelect],
  );

  const ScrollContainer = isTV ? ScrollView : Animated.ScrollView;

  return (
    <ScreenSafeArea className="bg-m3-background">
      <TVFocusGuide
        autoFocus={true}
        trapFocusRight={true}
        trapFocusDown={true}
        style={{flex: 1}}>
        <ScrollContainer
          focusable={false}
          accessible={false}
          className="h-full w-full bg-m3-background"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bounces={true}
          overScrollMode="always"
          contentContainerStyle={{
            paddingTop: 15,
            paddingBottom: 24,
            flexGrow: 1,
          }}>
          <View className="p-5">
            {isTV ? (
              <AppText
                role="headlineLargeEmphasized"
                className="mb-6 text-m3-on-background">
                Settings
              </AppText>
            ) : (
              <Animated.View>
                <AppText
                  role="headlineLargeEmphasized"
                  className="mb-6 text-m3-on-background">
                  Settings
                </AppText>
              </Animated.View>
            )}

            {/* Content provider section */}
            <AnimatedSection delay={100}>
              <View className="mb-6">
                <AppText
                  role="labelLarge"
                  className="mb-3"
                  style={{color: colors.onSurfaceVariant}}>
                  Content Provider
                </AppText>
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderColor: colors.outlineVariant,
                    borderRadius: 24,
                    borderWidth: 1,
                    height: 116,
                    justifyContent: 'center',
                  }}>
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    focusable={false}
                    accessible={false}
                    showsHorizontalScrollIndicator={false}
                    style={{flexGrow: 0}}
                    contentContainerStyle={{
                      alignItems: 'center',
                      paddingHorizontal: 10,
                    }}>
                    <View style={{flexDirection: 'row', alignItems: 'center'}}>
                      {providersList}
                    </View>
                    {installedProviders.length === 0 && (
                      <AppText
                        role="bodyMedium"
                        style={{color: colors.onSurfaceVariant}}>
                        No providers installed
                      </AppText>
                    )}
                  </ScrollView>
                </View>
              </View>
              <SettingsSection title="Provider tools">
                <SettingsRow
                  ref={providerManagerRowRef}
                  hasTVPreferredFocus={isTV && installedProviders.length === 0}
                  title="Provider Manager"
                  description="Install, update, and test provider extensions"
                  icon="puzzle-outline"
                  divider={false}
                  onPress={() => navigation.navigate('Extensions')}
                />
              </SettingsSection>
            </AnimatedSection>

            {/* Network Section */}
            <AnimatedSection delay={150}>
              <SettingsSection title="Network">
                <DnsPreference />
              </SettingsSection>
            </AnimatedSection>

            {/* Main options section */}
            <AnimatedSection delay={200}>
              <SettingsSection title="Options">
                <SettingsRow
                  title="Appearance"
                  // description="Accent colors and launcher icon"
                  icon="palette-outline"
                  onPress={() => navigation.navigate('Appearance')}
                />
                <SettingsRow
                  title="Player settings"
                  icon="play-circle-outline"
                  onPress={() => navigation.navigate('PlayerSettings')}
                />
                {hideDownloadsTab && (
                  <SettingsRow
                    title="Downloads"
                    icon="download-circle-outline"
                    onPress={() => navigation.navigate('DownloadsStack')}
                  />
                )}
                <SettingsRow
                  title="Preferences"
                  icon="tune-variant"
                  divider={false}
                  onPress={() => navigation.navigate('Preferences')}
                />
              </SettingsSection>
            </AnimatedSection>

            {/* Data Management section */}
            <AnimatedSection delay={300}>
              <SettingsSection title="Data Management">
                <SettingsRow
                  title="Data management"
                  description="Backups, cache, watch progress, and sync"
                  icon="database-outline"
                  divider={false}
                  onPress={() => navigation.navigate('DataManagement')}
                />
              </SettingsSection>
            </AnimatedSection>

            {/* About & GitHub section */}
            <AnimatedSection delay={400}>
              <SettingsSection title="About">
                <SettingsRow
                  title="About Vega"
                  icon="information-outline"
                  onPress={() => navigation.navigate('About')}
                />
                <GitHubStarButton primary={colors.primary} />
              </SettingsSection>
            </AnimatedSection>
          </View>
        </ScrollContainer>
      </TVFocusGuide>
    </ScreenSafeArea>
  );
};

export default Settings;
