import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SettingsStackParamList} from '../../App';
import {
  MaterialCommunityIcons,
  Feather,
  FontAwesome6,
  MaterialIcons,
} from '@expo/vector-icons';
import useThemeStore from '../../lib/zustand/themeStore';
import useContentStore from '../../lib/zustand/contentStore';
import {
  extensionStorage,
  ProviderExtension,
  ProviderSource,
} from '../../lib/storage/extensionStorage';
import {extensionManager} from '../../lib/services/ExtensionManager';
import {
  updateProvidersService,
  UpdateInfo,
} from '../../lib/services/UpdateProviders';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {settingsStorage} from '../../lib/storage';
import RenderProviderFlagIcon from '../../components/RenderProviderFLagIcon';
import ProviderSourceManager from './components/ProviderSourceManager';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Extensions'>;

type TabType = 'installed' | 'available';

const Extensions = ({navigation}: Props) => {
  const {primary} = useThemeStore(state => state);
  const {
    provider: activeExtensionProvider,
    setProvider: setActiveExtensionProvider,
    installedProviders,
    availableProviders,
    setInstalledProviders,
    setAvailableProviders,
  } = useContentStore(state => state);
  const [activeTab, setActiveTab] = useState<TabType>(
    installedProviders?.length > 0 ? 'installed' : 'available',
  );
  const [installingProvider, setInstallingProvider] = useState<string | null>(
    null,
  );
  const [updatingProvider, setUpdatingProvider] = useState<string | null>(null);
  const [updateInfos, setUpdateInfos] = useState<UpdateInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSourceAuthor, setActiveSourceAuthor] = useState<string>(
    extensionStorage.getProviderSource()?.author || '',
  );
  // Load providers on component mount
  useEffect(() => {
    const initializeExtensions = async () => {
      try {
        await extensionManager.initialize();
        const source = extensionStorage.getProviderSource();
        const author = source?.author || '';
        setActiveSourceAuthor(author);
        loadProviders(author);
        await checkForUpdates();

        // Try to fetch latest providers if we don't have any
        if (
          author &&
          (!availableProviders || availableProviders.length === 0)
        ) {
          await refreshProviders(author);
        }
      } catch (error) {
        // Still try to load from cache if initialization fails
        loadProviders();
      }
    };

    initializeExtensions();
  }, []);

  const loadProviders = (author?: string) => {
    const selectedAuthor =
      author || extensionStorage.getProviderSource()?.author || '';
    const installed = extensionStorage.getInstalledProviders() || [];
    const available = selectedAuthor
      ? extensionStorage.getAvailableProviders(selectedAuthor)
      : [];
    setInstalledProviders(installed);
    setAvailableProviders(available.filter(item => item && !item.disabled));
    setActiveSourceAuthor(selectedAuthor);
  };

  const checkForUpdates = async () => {
    const source = extensionStorage.getProviderSource();
    if (!source) {
      setUpdateInfos([]);
      return;
    }

    try {
      const updates = await updateProvidersService.checkForUpdatesManual();
      setUpdateInfos(updates);
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  const handleUpdateProvider = async (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      Alert.alert('Error', 'Invalid provider data');
      return;
    }

    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }

    const providerKey = `${provider.source?.author || ''}:${provider.value}`;
    setUpdatingProvider(providerKey);
    try {
      const success = await updateProvidersService.updateProvider(provider);
      if (success) {
        loadProviders();
        await checkForUpdates();

        Alert.alert(
          'Success',
          `${provider.display_name} has been updated successfully!`,
        );

        // Update the active provider if it was the one being updated
        if (
          activeExtensionProvider?.value === provider.value &&
          activeExtensionProvider?.source?.author === provider.source?.author
        ) {
          setActiveExtensionProvider(provider);
        }
      } else {
        Alert.alert('Error', 'Failed to update provider. Please try again.');
      }
    } catch (error) {
      console.error('Update error:', error);
      Alert.alert('Error', 'Failed to update provider. Please try again.');
    } finally {
      setUpdatingProvider(null);
    }
  };

  const handleTabChange = (tab: TabType) => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    setActiveTab(tab);
  };
  const handleInstallProvider = async (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      Alert.alert('Error', 'Invalid provider data');
      return;
    }

    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }

    const providerKey = `${provider.source?.author || ''}:${provider.value}`;
    setInstallingProvider(providerKey);
    try {
      await extensionManager.installProvider(provider);
      loadProviders();

      Alert.alert(
        'Success',
        `${provider.display_name} has been installed successfully!`,
      );
      setInstalledProviders(extensionStorage.getInstalledProviders() || []);
      // Keep the current provider active. Switching here can immediately run
      // newly downloaded provider code in mounted screens and block the UI.
      if (!activeExtensionProvider?.value) {
        setActiveExtensionProvider(provider);
      }
    } catch (error) {
      console.error('Installation error:', error);
      Alert.alert('Error', 'Failed to install provider. Please try again.');
    } finally {
      setInstallingProvider(null);
    }
  };
  const handleUninstallProvider = (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      Alert.alert('Error', 'Invalid provider data');
      return;
    }

    Alert.alert(
      'Uninstall Provider',
      `Are you sure you want to uninstall ${
        provider.display_name || 'this provider'
      }?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Uninstall',
          style: 'destructive',
          onPress: () => {
            extensionStorage.uninstallProvider(
              provider.value,
              provider.source?.author,
            );
            loadProviders();
            setInstalledProviders(
              extensionStorage.getInstalledProviders() || [],
            );

            // If this was the active provider, clear it
            if (
              activeExtensionProvider?.value === provider?.value &&
              activeExtensionProvider?.source?.author ===
                provider?.source?.author
            ) {
              setActiveExtensionProvider(
                extensionStorage.getInstalledProviders()[0] || {
                  value: '',
                  display_name: '',
                  source: {author: '', url: ''},
                  type: '',
                  version: '',
                },
              );
            }
          },
        },
      ],
    );
  };
  const handleSetActiveProvider = (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      Alert.alert('Error', 'Invalid provider data');
      return;
    }

    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger('effectClick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    setActiveExtensionProvider(provider);
  };

  const refreshProviders = async (sourceAuthor: string) => {
    setRefreshing(true);
    try {
      if (!sourceAuthor) {
        setAvailableProviders([]);
        return;
      }

      const source = extensionStorage
        .getProviderSources()
        .find(item => item.author === sourceAuthor);

      if (!source) {
        setAvailableProviders([]);
        return;
      }

      const providers = await extensionManager.fetchManifest(source, true);

      setAvailableProviders(providers);

      loadProviders(sourceAuthor);
      await checkForUpdates();
    } catch (error) {
      console.error('Refresh error:', error);
      Alert.alert(
        'Error',
        'Failed to refresh providers list. Please check your internet connection.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    await refreshProviders(activeSourceAuthor);
  };
  const renderProviderCard = ({item}: {item: ProviderExtension}) => {
    if (!item || !item.value) return null;
    const itemKey = `${item.source?.author || ''}:${item.value}`;
    const isActive =
      activeExtensionProvider?.value === item.value &&
      activeExtensionProvider?.source?.author === item.source?.author;
    const isInstalled = extensionStorage.isProviderInstalled(
      item.value,
      item.source?.author,
    );
    const isInstalling = installingProvider === itemKey;
    const isUpdating = updatingProvider === itemKey;
    const updateInfo = updateInfos.find(
      info =>
        info.provider.value === item.value &&
        info.provider.source?.author === item.source?.author,
    );
    const hasUpdate = updateInfo?.hasUpdate || false;

    return (
      <View
        className="bg-tertiary rounded-2xl p-5 py-3 mb-4 mx-4 shadow-lg border border-quaternary"
        style={{elevation: 4}}>
        <View className="flex-row items-center mb-4 gap-4 justify-between">
          {/* Left: Icon */}
          {item.icon ? (
            <Image
              source={{uri: item.icon}}
              className="w-12 h-12 rounded-xl border-2 border-primary bg-quaternary"
              style={{resizeMode: 'cover'}}
            />
          ) : (
            <View className="px-3 py-2 bg-quaternary rounded-xl border border-gray-700">
              <RenderProviderFlagIcon type={item.type} />
            </View>
          )}
          {/* Middle: Info */}
          <View className="flex-1 mx-3">
            <View className="flex-row items-center flex-wrap">
              <Text className="text-white text-lg font-bold tracking-wide flex-1">
                {item.display_name || 'Unknown Provider'}{' '}
                <Text className="font-medium text-sm text-gray-400">
                  v{item.version || 'Unknown'}
                </Text>
              </Text>
              {hasUpdate && updateInfo && (
                <View
                  style={{backgroundColor: primary}}
                  className="px-2 py-0.5 rounded-full ml-1">
                  <Text className="text-xs text-white font-semibold bg-gray-800">
                    Update
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-gray-400 text-xs capitalize">
              • {item.type || 'Unknown'}
            </Text>
            {item?.source?.author && (
              <Text className="text-gray-400 text-xs" numberOfLines={1}>
                • {item.source.author}
              </Text>
            )}
          </View>
          {/* Right: Buttons */}
          <View className="flex-row gap-3 items-center">
            {activeTab === 'installed' ? (
              <>
                <TouchableOpacity
                  onPress={() => handleSetActiveProvider(item)}
                  className={`w-9 h-9 rounded-full items-center justify-center ${
                    isActive ? 'bg-green-600' : 'bg-gray-700'
                  }`}
                  style={{opacity: isActive ? 1 : 0.9}}>
                  <MaterialIcons
                    name={isActive ? 'check-circle' : 'radio-button-unchecked'}
                    size={20}
                    color="white"
                  />
                </TouchableOpacity>
                {hasUpdate && (
                  <TouchableOpacity
                    onPress={() => handleUpdateProvider(updateInfo!.provider)}
                    disabled={isUpdating}
                    className="w-9 h-9 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: primary,
                      opacity: isUpdating ? 0.7 : 1,
                    }}>
                    {isUpdating ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <MaterialCommunityIcons
                        name="update"
                        size={20}
                        color="white"
                      />
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => handleUninstallProvider(item)}
                  className="w-9 h-9 rounded-full items-center justify-center bg-red-600">
                  <MaterialCommunityIcons
                    name="delete"
                    size={20}
                    color="white"
                  />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                testID={`install-provider-${itemKey}`}
                onPress={() => handleInstallProvider(item)}
                disabled={isInstalled || isInstalling}
                className={'w-9 h-9 rounded-full items-center justify-center'}
                style={{
                  opacity: isInstalling ? 0.7 : 1,
                  backgroundColor: isInstalled ? 'gray' : primary,
                }}>
                {isInstalling ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <MaterialCommunityIcons
                    name={isInstalled ? 'check' : 'download'}
                    size={20}
                    color="white"
                  />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };
  const currentData =
    activeTab === 'installed'
      ? (installedProviders || []).filter(item => item && item.value)
      : (availableProviders || []).filter(item => item && item.value);

  return (
    <View className="flex-1 bg-black pt-10 pb-16">
      <StatusBar backgroundColor="black" barStyle="light-content" />
      {/* Header */}
      <View className="flex-row items-center justify-between p-4 border-b border-gray-800">
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <FontAwesome6 name="arrow-left" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-semibold">Providers</Text>
        <TouchableOpacity onPress={handleRefresh}>
          <Feather name="refresh-cw" size={24} color={primary} />
        </TouchableOpacity>
      </View>
      {/* Tabs */}
      <View className="flex-row bg-quaternary mx-4 mt-4 rounded-xl">
        <TouchableOpacity
          onPress={() => handleTabChange('installed')}
          className="flex-1 py-3 rounded-xl"
          style={{
            backgroundColor:
              activeTab === 'installed' ? primary : 'transparent',
          }}>
          <Text
            className={`text-center font-medium ${
              activeTab === 'installed' ? 'text-white' : 'text-gray-400'
            }`}>
            Installed ({(installedProviders || []).length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="available-providers-tab"
          onPress={() => handleTabChange('available')}
          className="flex-1 py-3 rounded-xl"
          style={{
            backgroundColor:
              activeTab === 'available' ? primary : 'transparent',
          }}>
          <Text
            className={`text-center font-medium ${
              activeTab === 'available' ? 'text-white' : 'text-gray-400'
            }`}>
            Available ({(availableProviders || []).length})
          </Text>
        </TouchableOpacity>
      </View>

      <ProviderSourceManager
        visible={activeTab === 'available'}
        primary={primary}
        onSourceChanged={async (source: ProviderSource | undefined) => {
          const author = source?.author || '';
          setActiveSourceAuthor(author);
          loadProviders(author);
          await refreshProviders(author);
        }}
      />

      {/* Provider list */}
      <FlatList
        data={currentData}
        keyExtractor={(item, index) =>
          `${item?.source?.author || 'none'}:${item?.value || `provider-${index}`}`
        }
        renderItem={renderProviderCard}
        className="flex-1 mt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[primary]}
            tintColor={primary}
            progressBackgroundColor="black"
          />
        }
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center py-20">
            <MaterialCommunityIcons
              name="package-variant"
              size={64}
              color="gray"
            />
            <Text className="text-gray-400 text-lg mt-4">
              {activeTab === 'installed'
                ? 'No providers installed'
                : 'No providers available'}
            </Text>
            <Text className="text-gray-500 text-sm mt-2 text-center px-8">
              {activeTab === 'installed'
                ? 'Install providers from the Available tab to get started'
                : 'Pull to refresh to check for available providers'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

export default Extensions;
