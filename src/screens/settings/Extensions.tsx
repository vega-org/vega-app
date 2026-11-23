import {useFocusEffect} from '@react-navigation/native';
import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {
  View,
  StatusBar,
  ScrollView,
  FlatList,
  RefreshControl,
  BackHandler,
  findNodeHandle,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SettingsStackParamList} from '../../App';
import {MaterialCommunityIcons, FontAwesome6} from '@expo/vector-icons';
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
import ProviderSourceManager from './components/ProviderSourceManager';
import ProviderCard, {ProviderTestStatus} from './components/ProviderCard';
import {
  ProviderDiagnosticError,
  testProvider,
} from '../../lib/services/providerDiagnostics';
import AppDialog, {
  AppDialogAction,
  AppDialogVariant,
} from '../../components/AppDialog';
import ProviderTestProgressDialog, {
  ProviderTestStepState,
} from '../../components/ProviderTestProgressDialog';
import ProviderSettingsModal from './components/ProviderSettingsModal';
import type {ProviderDiagnosticProgress} from '../../lib/services/providerDiagnostics';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import useTVNavigationStore from '../../lib/zustand/tvNavigationStore';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Extensions'>;

interface DialogState {
  title: string;
  message: string;
  variant: AppDialogVariant;
  actions?: AppDialogAction[];
}

interface ProviderTestState {
  providerName: string;
  steps: ProviderTestStepState;
  resultMessage?: string;
}

const createProviderTestSteps = (): ProviderTestStepState => ({
  catalog: 'pending',
  posts: 'pending',
  metadata: 'pending',
  playback: 'pending',
  streams: 'pending',
});

const isSameProvider = (
  left: ProviderExtension | undefined,
  right: ProviderExtension,
) =>
  left?.value === right.value && left.source?.author === right.source?.author;

const providerListKey = (item: ProviderExtension) =>
  (item.source?.author || '') + ':' + item.value;

const Extensions = ({navigation, route}: Props) => {
  const isScreenFocused = useIsFocused();
  const backButtonRef = useRef<View>(null);
  const backFocusHandleRef = useRef<number | null>(null);
  const registerBackFocus = useCallback(() => {
    if (!isTV || !isScreenFocused) return;
    const handle = findNodeHandle(backButtonRef.current);
    if (handle) {
      backFocusHandleRef.current = handle;
      useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
    }
  }, [isScreenFocused]);

  useEffect(() => {
    registerBackFocus();
    return () => {
      const store = useTVNavigationStore.getState();
      if (store.activeScreenFocusHandle === backFocusHandleRef.current) {
        store.setActiveScreenFocusHandle(null);
      }
    };
  }, [registerBackFocus]);
  const colors = useM3Colors();
  const primary = colors.primary;
  const activeExtensionProvider = useContentStore(state => state.provider);
  const setActiveExtensionProvider = useContentStore(
    state => state.setProvider,
  );
  const installedProviders = useContentStore(state => state.installedProviders);
  const availableProviders = useContentStore(state => state.availableProviders);
  const setInstalledProviders = useContentStore(
    state => state.setInstalledProviders,
  );
  const setAvailableProviders = useContentStore(
    state => state.setAvailableProviders,
  );
  const [installingProvider, setInstallingProvider] = useState<string | null>(
    null,
  );
  const [updatingProvider, setUpdatingProvider] = useState<string | null>(null);
  const [updateInfos, setUpdateInfos] = useState<UpdateInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [providerTest, setProviderTest] = useState<ProviderTestState | null>(
    null,
  );
  const testAbortControllerRef = useRef<AbortController | null>(null);
  const activeTestProviderKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      testAbortControllerRef.current?.abort();
    };
  }, []);
  const [settingsProvider, setSettingsProvider] =
    useState<ProviderExtension | null>(null);
  const [providerTestStatuses, setProviderTestStatuses] = useState<
    Record<string, ProviderTestStatus>
  >({});
  const [activeSourceAuthor, setActiveSourceAuthor] = useState<string>(
    extensionStorage.getProviderSource()?.author || '',
  );
  const showDialog = (
    title: string,
    message: string,
    variant: AppDialogVariant = 'info',
    actions?: AppDialogAction[],
  ) => setDialog({title, message, variant, actions});

  const goBackToSettings = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('Settings');
    }
  }, [navigation]);

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackToSettings();
        return true;
      });
      return () => backSub.remove();
    }, [goBackToSettings]),
  );

  // Load providers immediately on component mount (synchronous 0ms load)
  useEffect(() => {
    const initialSource = extensionStorage.getProviderSource();
    const initialAuthor = initialSource?.author || '';
    setActiveSourceAuthor(initialAuthor);
    loadProviders(initialAuthor);

    const initializeExtensions = async () => {
      try {
        await extensionManager.initialize();
        const currentSource = extensionStorage.getProviderSource();
        const author = currentSource?.author || '';
        if (author !== initialAuthor) {
          setActiveSourceAuthor(author);
          loadProviders(author);
        }
        await checkForUpdates(false);

        // Fetch latest providers in background if cache is empty
        const cachedAvailable = author
          ? extensionStorage.getAvailableProviders(author)
          : [];
        if (author && cachedAvailable.length === 0) {
          await refreshProviders(author);
        }
      } catch (error) {
        console.warn('Background extensions initialization error:', error);
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

  const checkForUpdates = async (force = true) => {
    const source = extensionStorage.getProviderSource();
    if (!source) {
      setUpdateInfos([]);
      return;
    }

    try {
      const updates = await updateProvidersService.checkForUpdatesManual(force);
      setUpdateInfos(updates);
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  const handleUpdateProvider = async (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      showDialog('Error', 'Invalid provider data', 'error');
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
      const success = await updateProvidersService.updateProvider(provider, {throwOnError: true});
      if (success) {
        loadProviders();
        await checkForUpdates();

        // Update the active provider if it was the one being updated
        if (
          activeExtensionProvider?.value === provider.value &&
          activeExtensionProvider?.source?.author === provider.source?.author
        ) {
          setActiveExtensionProvider(provider);
        }
      } else {
        showDialog(
          'Error',
          'Failed to update provider. Please try again.',
          'error',
        );
      }
    } catch (error) {
      console.error('Update error:', error);
      showDialog(
        'Error',
        error instanceof Error
          ? error.message
          : 'Failed to update provider. Please try again.',
        'error',
      );
    } finally {
      setUpdatingProvider(null);
    }
  };

  const handleInstallProvider = async (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      showDialog('Error', 'Invalid provider data', 'error');
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

      const refreshedInstalledProviders =
        extensionStorage.getInstalledProviders() || [];
      setInstalledProviders(refreshedInstalledProviders);

      // Keep the current provider active. Switching here can immediately run
      // newly downloaded provider code in mounted screens and block the UI.
      // Read after the download so concurrent installs cannot act on a stale
      // provider captured when their handlers started.
      const currentProvider = useContentStore.getState().provider;
      const currentProviderIsInstalled = refreshedInstalledProviders.some(
        installedProvider => isSameProvider(installedProvider, currentProvider),
      );
      const installedSameValueFromAnotherSource =
        currentProvider?.value === provider.value &&
        currentProvider.source?.author !== provider.source?.author;

      if (
        !currentProvider?.value ||
        !currentProviderIsInstalled ||
        installedSameValueFromAnotherSource
      ) {
        setActiveExtensionProvider(provider);
      }
    } catch (error) {
      console.error('Installation error:', error);
      showDialog(
        'Error',
        error instanceof Error
          ? error.message
          : 'Failed to install provider. Please try again.',
        'error',
      );
    } finally {
      setInstallingProvider(null);
    }
  };
  const handleUninstallProvider = (provider: ProviderExtension) => {
    if (!provider || !provider.value) {
      showDialog('Error', 'Invalid provider data', 'error');
      return;
    }

    showDialog(
      'Uninstall Provider',
      `Are you sure you want to uninstall ${
        provider.display_name || 'this provider'
      }?`,
      'warning',
      [
        {label: 'Cancel'},
        {
          label: 'Uninstall',
          variant: 'destructive',
          testID: `confirm-uninstall-${provider.value}`,
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
      showDialog('Error', 'Invalid provider data', 'error');
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

  const handleCloseProviderTest = useCallback(() => {
    if (testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
    }
    if (activeTestProviderKeyRef.current) {
      const key = activeTestProviderKeyRef.current;
      setProviderTestStatuses(current => {
        if (current[key] === 'testing') {
          const next = {...current};
          delete next[key];
          return next;
        }
        return current;
      });
      activeTestProviderKeyRef.current = null;
    }
    setProviderTest(null);
  }, []);

  const handleTestProvider = async (provider: ProviderExtension) => {
    testAbortControllerRef.current?.abort();
    const controller = new AbortController();
    testAbortControllerRef.current = controller;

    const providerKey = `${provider.source?.author || ''}:${provider.value}`;
    activeTestProviderKeyRef.current = providerKey;
    setProviderTestStatuses(current => ({
      ...current,
      [providerKey]: 'testing',
    }));
    setProviderTest({
      providerName: provider.display_name,
      steps: createProviderTestSteps(),
    });
    const handleProgress = (progress: ProviderDiagnosticProgress) => {
      if (controller.signal.aborted) return;
      setProviderTest(current =>
        current
          ? {
              ...current,
              steps: {
                ...current.steps,
                [progress.stage]: progress.status,
              },
              resultMessage:
                progress.status === 'failed'
                  ? progress.detail
                  : current.resultMessage,
            }
          : current,
      );
    };
    try {
      const result = await testProvider(
        provider.value,
        handleProgress,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const playableTitle =
        result.episode?.title || result.directLink?.title || 'Direct stream';
      setProviderTest(current =>
        current
          ? {
              ...current,
              resultMessage: [
                `Provider: ${provider.display_name}`,
                `Catalog: ${result.catalog.title}`,
                `List: ${result.post.title}`,
                `Metadata: ${result.metadata.title}`,
                `Playback: ${playableTitle}`,
                `Streams: ${result.streams.length}`,
              ].join('\n'),
            }
          : current,
      );
      setProviderTestStatuses(current => ({
        ...current,
        [providerKey]: 'working',
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const stage =
        error instanceof ProviderDiagnosticError ? error.stage : 'unknown';
      const message = error instanceof Error ? error.message : String(error);
      setProviderTest(current =>
        current
          ? {
              ...current,
              resultMessage: `Stage: ${stage}\n${message}`,
            }
          : current,
      );
      setProviderTestStatuses(current => ({
        ...current,
        [providerKey]: 'failed',
      }));
    } finally {
      if (testAbortControllerRef.current === controller) {
        testAbortControllerRef.current = null;
        activeTestProviderKeyRef.current = null;
      }
    }
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
      showDialog(
        'Error',
        error instanceof Error
          ? error.message
          : 'Failed to refresh providers list. Please check your internet connection.',
        'error',
      );
    } finally {
      setTimeout(() => {
        setRefreshing(false);
      }, 50);
    }
  };

  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent?.contentOffset?.y ?? 0;
    setIsAtTop(offsetY <= 0);
  }, []);

  const handleRefresh = async () => {
    await refreshProviders(activeSourceAuthor);
  };
  const currentData = useMemo(() => {
    const allProviders = [
      ...(availableProviders || []),
      ...(installedProviders || []),
    ].filter(item => item && item.value);

    const providersMap = new Map<string, ProviderExtension>();
    for (const item of allProviders) {
      const key = `${item.source?.author || ''}:${item.value}`;
      const existing = providersMap.get(key);
      providersMap.set(key, {
        ...(existing || {}),
        ...item,
        hasSettings: Boolean(item.hasSettings || existing?.hasSettings),
      });
    }

    return Array.from(providersMap.values());
  }, [availableProviders, installedProviders]);

  const installedKeys = useMemo(
    () => new Set(installedProviders.map(providerListKey)),
    [installedProviders],
  );
  const updatesByKey = useMemo(
    () => new Map(updateInfos.map(info => [providerListKey(info.provider), info])),
    [updateInfos],
  );

  const renderProviderCard = useCallback(
    ({item}: {item: ProviderExtension}) => {
      if (!item || !item.value) {
        return null;
      }
      const itemKey = `${item.source?.author || ''}:${item.value}`;
      const isActive =
        activeExtensionProvider?.value === item.value &&
        activeExtensionProvider?.source?.author === item.source?.author;
      const isInstalled = installedKeys.has(itemKey);
      const isInstalling = installingProvider === itemKey;
      const isUpdating = updatingProvider === itemKey;
      const updateInfo = updatesByKey.get(itemKey);
      const hasUpdate = updateInfo?.hasUpdate || false;

      return (
        <ProviderCard
          provider={item}
          itemKey={itemKey}
          installed={isInstalled}
          active={isActive}
          installing={isInstalling}
          updating={isUpdating}
          testStatus={providerTestStatuses[itemKey] || 'untested'}
          hasUpdate={hasUpdate}
          hasSettings={item.hasSettings}
          primary={primary}
          onActivate={() => handleSetActiveProvider(item)}
          onInstall={() => handleInstallProvider(item)}
          onUpdate={() =>
            updateInfo && handleUpdateProvider(updateInfo.provider)
          }
          onTest={() => handleTestProvider(item)}
          onUninstall={() => handleUninstallProvider(item)}
          onOpenSettings={() => setSettingsProvider(item)}
        />
      );
    },
    [
      activeExtensionProvider,
      installedKeys,
      installingProvider,
      updatingProvider,
      updatesByKey,
      providerTestStatuses,
      primary,
    ],
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <View style={{flex: 1, height: '100%', width: '100%', backgroundColor: colors.background, paddingTop: isTV ? 40 : 20}}>
        <StatusBar backgroundColor={colors.background} barStyle="light-content" />
        <View className="flex-row items-center justify-between px-4 pb-4 pt-2">
          <TVFocusable
            ref={backButtonRef}
            onLayout={registerBackFocus}
            onFocus={registerBackFocus}
            hasTVPreferredFocus={isTV}
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            onPress={goBackToSettings}
            borderRadius={16}
            focusScale={1.12}
            style={{
              height: 48,
              width: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceContainerHigh,
              borderRadius: 16,
            }}>
            <FontAwesome6 name="arrow-left" size={20} color={colors.onSurface} />
          </TVFocusable>
          <View className="mx-4 flex-1">
            <AppText
              role="headlineSmallEmphasized"
            className="text-m3-on-background">
            Providers
          </AppText>
          <AppText role="bodySmall" className="text-m3-on-surface-variant">
            Install and test streaming sources
          </AppText>
        </View>
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel="Refresh providers"
          onPress={handleRefresh}
          borderRadius={16}
          focusScale={1.12}
          style={{
            height: 48,
            width: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceContainerHigh,
            borderRadius: 16,
          }}>
          <MaterialCommunityIcons
            name="refresh"
            size={22}
            color={colors.primary}
          />
        </TVFocusable>
      </View>
      <ProviderSourceManager
        visible
        primary={primary}
        pendingSource={route.params?.addSource}
        pendingSourceRequestId={route.params?.requestId}
        onSourceChanged={async (source: ProviderSource | undefined) => {
          const author = source?.author || '';
          setActiveSourceAuthor(author);
          loadProviders(author);
          await refreshProviders(author);
        }}
      />

      <View className="mb-1 mt-6 flex-row items-center justify-between px-5">
        <AppText role="titleLargeEmphasized" className="text-m3-on-background">
          Available providers
        </AppText>
        <View
          className="min-w-9 items-center px-2.5 py-1.5"
          style={{
            backgroundColor: colors.secondaryContainer,
            borderRadius: 14,
          }}>
          <AppText
            role="labelMediumEmphasized"
            style={{color: colors.onSecondaryContainer}}>
            {currentData.length}
          </AppText>
        </View>
      </View>

      {/* Keep all TV focus targets attached; window phone cards. */}
      {isTV ? (
<ScrollView
        focusable={false}
        accessible={false}
        style={{flex: 1, marginTop: 12}}
        contentContainerStyle={{paddingBottom: 48}}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[primary]}
            tintColor={primary}
            progressBackgroundColor={colors.surfaceContainerHigh}
            enabled={isAtTop || refreshing}
          />
        }>
        {currentData.length === 0 ? (
          <View className="flex-1 justify-center items-center py-20">
            <MaterialCommunityIcons
              name="package-variant"
              size={64}
              color={colors.onSecondaryContainer}
            />
            <AppText
              role="titleLargeEmphasized"
              className="mt-4 text-m3-on-surface">
              No providers available
            </AppText>
            <AppText
              role="bodyMedium"
              className="mt-2 px-8 text-center text-m3-on-surface-variant">
              Add or refresh a source to check for available providers
            </AppText>
          </View>
        ) : (
          currentData.map((item, index) => (
            <View
              key={`${item?.source?.author || 'none'}:${item?.value || index}`}>
              {renderProviderCard({item})}
            </View>
          ))
        )}
      </ScrollView>
      ) : (
      <FlatList
        style={{flex: 1, marginTop: 12}}
        contentContainerStyle={{paddingBottom: 48}}
        data={currentData}
        keyExtractor={providerListKey}
        renderItem={renderProviderCard}
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        windowSize={5}
        updateCellsBatchingPeriod={32}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        ListEmptyComponent={<View className="flex-1 justify-center items-center py-20">
            <MaterialCommunityIcons
              name="package-variant"
              size={64}
              color={colors.onSecondaryContainer}
            />
            <AppText
              role="titleLargeEmphasized"
              className="mt-4 text-m3-on-surface">
              No providers available
            </AppText>
            <AppText
              role="bodyMedium"
              className="mt-2 px-8 text-center text-m3-on-surface-variant">
              Add or refresh a source to check for available providers
            </AppText>
          </View>}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[primary]}
            tintColor={primary}
            progressBackgroundColor={colors.surfaceContainerHigh}
            enabled={isAtTop || refreshing}
          />
        }
      />
      )}
      <AppDialog
        visible={dialog !== null}
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        primary={primary}
        variant={dialog?.variant}
        actions={dialog?.actions}
        onDismiss={() => setDialog(null)}
      />
      <ProviderTestProgressDialog
        visible={providerTest !== null}
        providerName={providerTest?.providerName || ''}
        steps={providerTest?.steps || createProviderTestSteps()}
        resultMessage={providerTest?.resultMessage}
        primary={primary}
        onClose={handleCloseProviderTest}
      />
      <ProviderSettingsModal
        visible={settingsProvider !== null}
        provider={settingsProvider}
        onClose={() => setSettingsProvider(null)}
      />
    </View>
  </TVFocusGuide>
  );
};

export default Extensions;
