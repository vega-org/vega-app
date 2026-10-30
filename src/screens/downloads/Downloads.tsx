import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BackHandler,
  Dimensions,
  FlatList,
  findNodeHandle,
  View,
} from 'react-native';
import ReactNativeHapticFeedback, {
  HapticFeedbackTypes,
} from 'react-native-haptic-feedback';
import type {DownloadsStackParamList} from '../../App';
import MediaPosterCard from '../../components/MediaPosterCard';
import AppText from '../../components/ui/Text';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import useTVNavigationStore from '../../lib/zustand/tvNavigationStore';
import {
  DownloadedMediaGroup,
  groupCompletedDownloads,
} from '../../lib/downloadLibrary';
import {useDownloadsMaintenance} from '../../lib/hooks/useDownloadsMaintenance';
import {deleteLocalEpisodes} from '../../lib/localContent/delete';
import {localLibraryItem, localContentId} from '../../lib/localContent/library';
import {settingsStorage} from '../../lib/storage';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import useDownloadsStore, {
  selectCompletedDownloads,
  selectCurrentDownloads,
} from '../../lib/zustand/downloadsStore';
import useLocalContentStore from '../../lib/zustand/localContentStore';
import {useShallow} from 'zustand/react/shallow';
import {useM3Colors} from '../../theme/M3PaletteContext';
import CurrentDownloadsSection from '../settings/components/CurrentDownloadsSection';
import MissingDownloadsSection from '../settings/components/MissingDownloadsSection';
import DownloadsEmptyState from './components/DownloadsEmptyState';
import DownloadsSelectionBottomBar from './components/DownloadsSelectionBottomBar';
import DownloadsSelectionHeader from './components/DownloadsSelectionHeader';
import {deleteDownloadedMediaGroups} from './utils/deleteDownloadGroups';

const Downloads = () => {
  const insets = useSafeAreaInsets();
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const navigation =
    useNavigation<NativeStackNavigationProp<DownloadsStackParamList>>();
  const screenFocused = useIsFocused();
  useDownloadsMaintenance();
  const completed = useDownloadsStore(useShallow(selectCompletedDownloads));
  const currentDownloads = useDownloadsStore(useShallow(selectCurrentDownloads));
  const groups = useMemo(() => groupCompletedDownloads(completed), [completed]);
  const localTitles = useLocalContentStore(state => state.titles);
  // Imported local content, as listed in Library. It opens the same Info page.
  const localItems = useMemo(
    () =>
      localTitles
        .filter(title => title.inLibrary !== false)
        .map(localLibraryItem),
    [localTitles],
  );
  const allCardIds = [...groups.map(group => group.id), ...localItems.map(item => item.link)];
  // Without downloads, the first local card takes the first card's focus role.
  const hasCards = groups.length > 0 || localItems.length > 0;
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [isSelectionModeActive, setIsSelectionModeActive] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectButtonRef = useRef<View>(null);
  const firstCardRef = useRef<View>(null);
  const currentDownloadActionRef = useRef<View>(null);
  const exploreButtonRef = useRef<View>(null);
  const [selectButtonNode, setSelectButtonNode] = useState<number | null>(null);
  const [firstCardNode, setFirstCardNode] = useState<number | null>(null);
  const [currentDownloadActionNode, setCurrentDownloadActionNode] = useState<number | null>(null);
  const [exploreButtonNode, setExploreButtonNode] = useState<number | null>(null);

  const isSelectionMode = isSelectionModeActive || selectedGroupIds.size > 0;

  const screenWidth = Dimensions.get('window').width;
  const containerPadding = 12;
  const itemSpacing = 10;
  const railWidth = isTV ? 96 : 0;
  const availableWidth = screenWidth - railWidth - containerPadding * 2;
  const targetItemWidth = isTV ? 160 : 100;
  const columns = Math.max(
    2,
    Math.floor((availableWidth + itemSpacing) / (targetItemWidth + itemSpacing)),
  );
  const cardWidth = (availableWidth - itemSpacing * (columns - 1)) / columns;

  const updateSelectButtonNode = useCallback(() => {
    if (!isTV) return;
    if (selectButtonRef.current) {
      const handle = findNodeHandle(selectButtonRef.current);
      if (handle) setSelectButtonNode(handle);
    }
  }, []);

  const updateFirstCardNode = useCallback(() => {
    if (!isTV) return;
    if (firstCardRef.current) {
      const handle = findNodeHandle(firstCardRef.current);
      if (handle) {
        setFirstCardNode(handle);
        if (isTV && screenFocused && currentDownloads.length === 0) {
          useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
        }
      }
    }
  }, [screenFocused, currentDownloads.length]);

  const updateCurrentDownloadActionNode = useCallback(() => {
    if (!isTV) return;
    const handle = findNodeHandle(currentDownloadActionRef.current);
    setCurrentDownloadActionNode(handle);
    if (isTV && screenFocused && handle) {
      useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
    }
  }, [screenFocused]);

  useEffect(() => {
    if (!isTV || !screenFocused || currentDownloads.length === 0) return;
    const timer = setTimeout(updateCurrentDownloadActionNode, 250);
    return () => clearTimeout(timer);
  }, [currentDownloads.length, screenFocused, updateCurrentDownloadActionNode]);

  const updateExploreButtonNode = useCallback(() => {
    if (!isTV) return;
    if (exploreButtonRef.current) {
      const handle = findNodeHandle(exploreButtonRef.current);
      if (handle) {
        setExploreButtonNode(handle);
        if (isTV && screenFocused && currentDownloads.length === 0 && groups.length === 0) {
          useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
        }
      }
    }
  }, [screenFocused, currentDownloads.length, groups.length]);

  useEffect(() => {
    if (!isTV || !screenFocused) return;
    const t = setTimeout(() => {
      updateSelectButtonNode();
      updateFirstCardNode();
      updateExploreButtonNode();
    }, 150);
    return () => clearTimeout(t);
  }, [
    screenFocused,
    groups.length,
    isSelectionModeActive,
    selectedGroupIds.size,
    updateSelectButtonNode,
    updateFirstCardNode,
    updateExploreButtonNode,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      if (currentDownloads.length > 0 && currentDownloadActionNode) {
        useTVNavigationStore.getState().setActiveScreenFocusHandle(currentDownloadActionNode);
      } else if (hasCards && firstCardNode) {
        useTVNavigationStore.getState().setActiveScreenFocusHandle(firstCardNode);
      } else if (exploreButtonNode) {
        useTVNavigationStore.getState().setActiveScreenFocusHandle(exploreButtonNode);
      }
      // The card focused before opening details restores itself on return.
    }, [hasCards, firstCardNode, exploreButtonNode, currentDownloads.length, currentDownloadActionNode]),
  );


  const triggerHaptic = (
    type: HapticFeedbackTypes = HapticFeedbackTypes.effectTick,
  ) => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      ReactNativeHapticFeedback.trigger(type, {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
  };

  const handleCardPress = (groupId: string) => {
    if (isSelectionMode) {
      triggerHaptic(HapticFeedbackTypes.effectTick);
      setSelectedGroupIds(prev => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    } else {
      navigation.navigate('DownloadedDetails', {groupId});
    }
  };

  const handleCardLongPress = (groupId: string) => {
    triggerHaptic(HapticFeedbackTypes.impactMedium);
    setIsSelectionModeActive(true);
    setSelectedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleExitSelection = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    setSelectedGroupIds(new Set());
    setIsSelectionModeActive(false);
  };

  // Declared after handleExitSelection: React Compiler skips components that
  // read a value before its declaration.
  useEffect(() => {
    if (!isSelectionMode) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleExitSelection();
      return true;
    });
    return () => backSub.remove();
  }, [isSelectionMode]);

  const handleToggleSelectAll = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    if (selectedGroupIds.size === allCardIds.length) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(allCardIds));
    }
  };

  const handleInvertSelection = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    setSelectedGroupIds(prev => {
      const next = new Set<string>();
      allCardIds.forEach(id => {
        if (!prev.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  };

  // Promise chain instead of try/finally: React Compiler skips any component
  // that contains a finally clause.
  const deleteSelectedGroups = (targetGroups: DownloadedMediaGroup[]) => {
    setIsDeleting(true);
    return deleteDownloadedMediaGroups(targetGroups)
      .then(() => deleteLocalEpisodes(localTitles.filter(title => selectedGroupIds.has(localLibraryItem(title).link)).flatMap(title => title.episodes.map(episode => episode.uri))))
      .then(() => {
        setSelectedGroupIds(new Set());
        setIsSelectionModeActive(false);
      })
      .catch(err => {
        console.error('Error deleting selected download groups:', err);
        setSelectedGroupIds(new Set());
        setIsSelectionModeActive(false);
        showAppDialog({title: 'Could not delete all files', message: err instanceof Error ? err.message : String(err), actions: [{label: 'OK'}]});
      })
      .finally(() => {
        setIsDeleting(false);
      });
  };

  const handleDeletePress = () => {
    const selectedGroups = groups.filter(g => selectedGroupIds.has(g.id));
    const selectedLocal = localTitles.filter(title => selectedGroupIds.has(localLibraryItem(title).link));
    const selectedCount = selectedGroups.length + selectedLocal.length;
    if (selectedCount === 0) return;

    triggerHaptic(HapticFeedbackTypes.effectHeavyClick);
    const totalFiles = selectedGroups.reduce((acc, g) => acc + g.items.length, 0) + selectedLocal.reduce((sum, title) => sum + title.episodes.length, 0);
    const titleText =
      selectedCount === 1
        ? `"${selectedGroups[0]?.title || selectedLocal[0]?.metadata?.title || selectedLocal[0]?.name}"`
        : `${selectedCount} titles`;

    showAppDialog({
      title: `Delete ${selectedCount === 1 ? 'Title' : `${selectedCount} Titles`}?`,
      message: `Are you sure you want to permanently delete all downloaded files (${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}) for ${titleText} from your device storage?`,
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            deleteSelectedGroups(selectedGroups).catch(console.error);
          },
        },
      ],
    });
  };

  const isAllSelected =
    hasCards && selectedGroupIds.size === allCardIds.length;

  return (
    <TVFocusGuide
      key={isTV ? (screenFocused ? 'downloads-active' : 'downloads-inactive') : undefined}
      autoFocus={true}
      trapFocusRight={true}
      destinations={currentDownloads.length > 0
        ? [currentDownloadActionRef]
        : hasCards ? [firstCardRef] : [exploreButtonRef]}
      style={{flex: 1, backgroundColor: colors.background, paddingTop: isTV ? 0 : insets.top}}>
      <StatusBar />

      {isSelectionMode ? (
        <DownloadsSelectionHeader
          selectedCount={selectedGroupIds.size}
          isAllSelected={isAllSelected}
          onExitSelection={handleExitSelection}
          onInvertSelection={handleInvertSelection}
          onToggleSelectAll={handleToggleSelectAll}
        />
      ) : null}

      <FlatList
        data={groups}
        key={`downloads-cols-${columns}`}
        numColumns={columns}
        keyExtractor={item => item.id}
        columnWrapperStyle={{gap: itemSpacing, justifyContent: 'flex-start'}}
        contentContainerStyle={{
          paddingHorizontal: containerPadding,
          paddingTop: isSelectionMode ? 14 : 0,
          paddingBottom: isSelectionMode ? 120 : 80,
        }}
        ListHeaderComponent={
          !isSelectionMode ? (
            <View>
              <View
                style={{
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                  marginTop: isTV ? 16 : 8,
                  paddingLeft: isTV ? 12 : 6,
                  paddingRight: isTV ? 48 : 6,
                }}>
                <AppText
                  role="headlineLargeEmphasized"
                  className="text-m3-on-background">
                  Downloads
                </AppText>
                {hasCards ? (
                  <TVFocusable
                    ref={selectButtonRef}
                    onLayout={updateSelectButtonNode}
                    accessibilityRole="button"
                    accessibilityLabel="Select items"
                    nextFocusRight={selectButtonNode ?? undefined}
                    nextFocusUp={selectButtonNode ?? undefined}
                    nextFocusDown={firstCardNode ?? undefined}
                    nextFocusLeft={firstCardNode ?? undefined}
                    onPress={() => {
                      triggerHaptic(HapticFeedbackTypes.effectClick);
                      setIsSelectionModeActive(true);
                    }}
                    borderRadius={18}
                    focusScale={1.08}
                    focusBorderColor={focusBorderColor}
                    style={{
                      alignItems: 'center',
                      backgroundColor: colors.surfaceContainerHigh,
                      borderRadius: 18,
                      flexDirection: 'row',
                      gap: 6,
                      justifyContent: 'center',
                      minHeight: 36,
                      paddingHorizontal: 14,
                    }}>
                    <MaterialCommunityIcons
                      name="checkbox-multiple-marked-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <AppText
                      role="labelLargeEmphasized"
                      style={{color: colors.primary}}>
                      Select
                    </AppText>
                  </TVFocusable>
                ) : null}
              </View>
              <CurrentDownloadsSection
                primary={colors.primary}
                firstActionRef={currentDownloadActionRef}
                onFirstActionLayout={updateCurrentDownloadActionNode}
              />
              <MissingDownloadsSection primary={colors.primary} />
              {groups.length > 0 ? (
                <AppText
                  role="titleLargeEmphasized"
                  className="mb-4 text-m3-on-background"
                  style={{paddingLeft: isTV ? 12 : 6}}>
                  Downloaded
                </AppText>
              ) : null}
            </View>
          ) : null
        }
        renderItem={({item, index}) => {
          const isTopRow = index < columns;
          const isLastItem = index === groups.length - 1;
          const isRightmostInRow = (index + 1) % columns === 0;

          return (
            <MediaPosterCard
              ref={index === 0 ? firstCardRef : undefined}
              onLayout={index === 0 ? updateFirstCardNode : undefined}
              title={item.title}
              poster={item.poster}
              width={cardWidth}
              selected={selectedGroupIds.has(item.id)}
              selectionMode={isSelectionMode}
              subtitle={`${item.items.length} ${
                item.items.length === 1 ? 'Download' : 'Downloads'
              }`}
              hasTVPreferredFocus={isTV && screenFocused && !isSelectionMode && index === 0}
              nextFocusUp={
                isTopRow ? (selectButtonNode ?? undefined) : undefined
              }
              nextFocusRight={
                isLastItem || (isTopRow && isRightmostInRow)
                  ? (selectButtonNode ?? undefined)
                  : undefined
              }
              onFocus={() => {
                if (index === 0 && firstCardNode) {
                  useTVNavigationStore.getState().setActiveScreenFocusHandle(firstCardNode);
                }
              }}
              onPress={() => handleCardPress(item.id)}
              onLongPress={() => handleCardLongPress(item.id)}
            />
          );
        }}
        ListFooterComponent={
          localItems.length > 0 ? (
            <FlatList
              data={localItems}
              key={`local-cols-${columns}`}
              numColumns={columns}
              scrollEnabled={false}
              keyExtractor={item => item.link}
              columnWrapperStyle={{
                gap: itemSpacing,
                justifyContent: 'flex-start',
              }}
              ListHeaderComponent={
                <AppText
                  role="titleLargeEmphasized"
                  className="mb-4 text-m3-on-background"
                  style={{
                    marginTop: groups.length > 0 ? 16 : 0,
                    paddingLeft: isTV ? 12 : 6,
                  }}>
                  Local content
                </AppText>
              }
              renderItem={({item, index}) => {
                const isFirstCard = groups.length === 0 && index === 0;
                return (
                  <MediaPosterCard
                    ref={isFirstCard ? firstCardRef : undefined}
                    onLayout={isFirstCard ? updateFirstCardNode : undefined}
                    title={item.title}
                    poster={item.poster}
                    width={cardWidth}
                    hasTVPreferredFocus={isTV && screenFocused && !isSelectionMode && isFirstCard}
                    selected={selectedGroupIds.has(item.link)}
                    selectionMode={isSelectionMode}
                    onLongPress={() => handleCardLongPress(item.link)}
                    onPress={() => isSelectionMode ? handleCardPress(item.link) :
                      navigation.navigate('DownloadedDetails', {
                        localTitleId: localContentId(item.link)!,
                      })
                    }
                  />
                );
              }}
            />
          ) : null
        }
        ListEmptyComponent={
          localItems.length === 0 ? (
            <DownloadsEmptyState
              exploreButtonRef={exploreButtonRef}
              onExploreLayout={updateExploreButtonNode}
              preferredFocus={currentDownloads.length === 0}
              onExplore={() => {
                navigation.getParent<any>()?.navigate('HomeStack');
              }}
            />
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

      {isSelectionMode ? (
        <DownloadsSelectionBottomBar
          selectedCount={selectedGroupIds.size}
          isAllSelected={isAllSelected}
          isDeleting={isDeleting}
          onToggleSelectAll={handleToggleSelectAll}
          onInvertSelection={handleInvertSelection}
          onDeletePress={handleDeletePress}
        />
      ) : null}
    </TVFocusGuide>
  );
};

export default Downloads;
