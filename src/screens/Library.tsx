import {scheduleWhenIdle} from '../lib/performance/idleWork';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
  findNodeHandle,
} from 'react-native';
import ReactNativeHapticFeedback, {
  HapticFeedbackTypes,
} from 'react-native-haptic-feedback';
import type {WatchListStackParamList} from '../App';
import MediaPosterCard from '../components/MediaPosterCard';
import LibraryCollectionDialog from '../components/library/LibraryCollectionDialog';
import LibraryIcon from '../components/library/LibraryIcon';
import SettingsChoiceDialog from '../components/ui/SettingsChoiceDialog';
import AppText from '../components/ui/Text';
import {
  getItemCollectionIds,
  mainStorage,
  settingsStorage,
  type LibraryCollection,
  type WatchListItem,
} from '../lib/storage';
import {syncFromSharedFolder} from '../lib/sync/syncService';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import useWatchListStore from '../lib/zustand/watchListStore';
import useLocalContentStore from '../lib/zustand/localContentStore';
import {localLibraryItem} from '../lib/localContent/library';
import {useM3Colors} from '../theme/M3PaletteContext';
import {isTV} from '../lib/tv';
import {TVFocusable, TVFocusGuide} from '../components/tv';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import useTVNavigationStore from '../lib/zustand/tvNavigationStore';
import {useFloatingTabBarInset} from '../components/navigation/FloatingTabBarInsetContext';

/** Chip id for every saved title, across categories. */
const ALL_FILTER = '__all__';
/** Last selected chip, kept on this device only (not synced). */
const SELECTED_FILTER_KEY = 'library-selected-filter';
const LIBRARY_SORT_KEY = 'library-sort-order';
const librarySortChoices = [
  {value: 'recent', label: 'Recently saved', description: 'Keep the default Library order'},
  {value: 'title-asc', label: 'Title A–Z', description: 'Sort alphabetically by title'},
  {value: 'title-desc', label: 'Title Z–A', description: 'Sort in reverse alphabetical order'},
] as const;
type LibrarySort = (typeof librarySortChoices)[number]['value'];
const titleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

type EditorState =
  | {visible: false}
  | {visible: true; collection?: LibraryCollection};

const Library = () => {
  const insets = useSafeAreaInsets();
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const focusBorderColor = useTVFocusBorderColor();
  const {width: screenWidth} = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(screenWidth);
  const navigation =
    useNavigation<NativeStackNavigationProp<WatchListStackParamList>>();
  const remoteWatchList = useWatchListStore(state => state.watchList);
  const localTitles = useLocalContentStore(state => state.titles);
  const watchList = useMemo(() => [...remoteWatchList, ...localTitles.filter(title => title.inLibrary !== false).map(localLibraryItem)], [remoteWatchList, localTitles]);
  const collections = useWatchListStore(state => state.collections);
  const removeItem = useWatchListStore(state => state.removeItem);
  const removeFromCollection = useWatchListStore(
    state => state.removeFromCollection,
  );
  const [filter, setFilter] = useState<string>(
    () => mainStorage.getString(SELECTED_FILTER_KEY) || ALL_FILTER,
  );
  const [sort, setSort] = useState<LibrarySort>(() => {
    const saved = mainStorage.getString(LIBRARY_SORT_KEY);
    return librarySortChoices.find(choice => choice.value === saved)?.value ?? 'recent';
  });
  const [sortPickerVisible, setSortPickerVisible] = useState(false);
  const [editor, setEditor] = useState<EditorState>({visible: false});
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  const [isSelectionModeActive, setIsSelectionModeActive] = useState(false);

  const selectButtonRef = React.useRef<View>(null);
  const firstCardRef = React.useRef<View>(null);
  const activeChipRef = React.useRef<View>(null);
  // Claim focus for the first card only until a card has had focus, so
  // leaving selection mode or a list remount does not pull focus back.
  const [initialCardFocused, setInitialCardFocused] = useState(false);
  const [selectButtonNode, setSelectButtonNode] = useState<number | null>(null);
  const [firstCardNode, setFirstCardNode] = useState<number | null>(null);
  const [activeChipNode, setActiveChipNode] = useState<number | null>(null);

  const updateNode = useCallback(
    (ref: React.RefObject<View | null>, setNode: (handle: number) => void) => {
      if (ref.current) {
        const handle = findNodeHandle(ref.current);
        if (handle) {
          setNode(handle);
        }
      }
    },
    [],
  );
  const updateSelectButtonNode = useCallback(
    () => updateNode(selectButtonRef, setSelectButtonNode),
    [updateNode],
  );
  const updateFirstCardNode = useCallback(
    () => updateNode(firstCardRef, setFirstCardNode),
    [updateNode],
  );
  const updateActiveChipNode = useCallback(
    () => updateNode(activeChipRef, setActiveChipNode),
    [updateNode],
  );

  // A deleted category (here or synced from another device) falls back to All.
  const activeCollection =
    filter === ALL_FILTER ? undefined : collections.find(c => c.id === filter);
  useEffect(() => {
    if (filter !== ALL_FILTER && !activeCollection) {
      setFilter(ALL_FILTER);
    }
  }, [filter, activeCollection]);
  useEffect(() => {
    mainStorage.setString(SELECTED_FILTER_KEY, filter);
  }, [filter]);

  const existingIds = useMemo(
    () => new Set(collections.map(c => c.id)),
    [collections],
  );
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of watchList) {
      for (const id of getItemCollectionIds(item, existingIds)) {
        result[id] = (result[id] || 0) + 1;
      }
    }
    return result;
  }, [watchList, existingIds]);
  const visibleItems = useMemo(() => {
    const items = activeCollection
      ? watchList.filter(item =>
          getItemCollectionIds(item, existingIds).includes(activeCollection.id),
        )
      : watchList;
    const sorted = [...items].reverse();
    if (sort === 'recent') return sorted;

    const direction = sort === 'title-asc' ? 1 : -1;
    return sorted.sort(
      (a, b) => direction * titleCollator.compare(a.title, b.title),
    );
  }, [watchList, activeCollection, existingIds, sort]);

  useEffect(() => {
    const t = setTimeout(() => {
      updateSelectButtonNode();
      updateFirstCardNode();
      updateActiveChipNode();
    }, 150);
    return () => clearTimeout(t);
  }, [
    visibleItems.length,
    sort,
    filter,
    collections.length,
    isSelectionModeActive,
    selectedLinks.size,
    updateSelectButtonNode,
    updateFirstCardNode,
    updateActiveChipNode,
  ]);

  const isSelectionMode = isSelectionModeActive || selectedLinks.size > 0;

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      const handle =
        visibleItems.length > 0
          ? (firstCardNode ?? activeChipNode)
          : activeChipNode;
      useTVNavigationStore.getState().setActiveScreenFocusHandle(handle);
      // The card focused before opening Info restores itself on return.
      return () => {
        const store = useTVNavigationStore.getState();
        if (store.activeScreenFocusHandle === handle) {
          store.setActiveScreenFocusHandle(null);
        }
      };
    }, [visibleItems.length, firstCardNode, activeChipNode]),
  );

  useFocusEffect(
    useCallback(() => {
      return scheduleWhenIdle(() => syncFromSharedFolder());
    }, []),
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

  const toggleSelected = (link: string) =>
    setSelectedLinks(prev => {
      const next = new Set(prev);
      if (next.has(link)) {
        next.delete(link);
      } else {
        next.add(link);
      }
      return next;
    });

  const handleCardPress = (item: WatchListItem) => {
    if (isSelectionMode) {
      triggerHaptic(HapticFeedbackTypes.effectTick);
      toggleSelected(item.link);
    } else {
      navigation.navigate('Info', {
        link: item.link,
        provider: item.provider,
        poster: item.poster,
      });
    }
  };

  const handleCardLongPress = (item: WatchListItem) => {
    triggerHaptic(HapticFeedbackTypes.impactMedium);
    setIsSelectionModeActive(true);
    toggleSelected(item.link);
  };

  const handleExitSelection = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    setSelectedLinks(new Set());
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

  const selectFilter = (id: string) => {
    if (id === filter) return;
    triggerHaptic(HapticFeedbackTypes.effectTick);
    setFilter(id);
    setSelectedLinks(new Set());
  };

  const handleToggleSelectAll = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    if (selectedLinks.size === visibleItems.length) {
      setSelectedLinks(new Set());
    } else {
      setSelectedLinks(new Set(visibleItems.map(item => item.link)));
    }
  };

  const handleInvertSelection = () => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    setSelectedLinks(prev => {
      const next = new Set<string>();
      visibleItems.forEach(item => {
        if (!prev.has(item.link)) {
          next.add(item.link);
        }
      });
      return next;
    });
  };

  const handleDeletePress = () => {
    if (selectedLinks.size === 0) return;

    triggerHaptic(HapticFeedbackTypes.effectHeavyClick);
    const count = selectedLinks.size;
    const titles = `${count} ${count === 1 ? 'title' : 'titles'}`;

    showAppDialog({
      title: activeCollection
        ? `Remove from ${activeCollection.name}?`
        : 'Remove from Library?',
      message: activeCollection
        ? `Remove ${titles} from ${activeCollection.name}? Titles in other categories stay in your library.`
        : `Remove ${titles} from your library and all categories?`,
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => {
            if (activeCollection) {
              removeFromCollection([...selectedLinks], activeCollection.id);
            } else {
              selectedLinks.forEach(link => removeItem(link));
            }
            setSelectedLinks(new Set());
            setIsSelectionModeActive(false);
          },
        },
      ],
    });
  };

  const isAllSelected =
    visibleItems.length > 0 && selectedLinks.size === visibleItems.length;

  // Calculate how many items can fit per row
  const containerPadding = 12;
  const itemSpacing = 10;
  const availableWidth = containerWidth - containerPadding * 2;
  const targetItemWidth = isTV ? 160 : 100;
  const numColumns = Math.max(
    1,
    Math.floor(
      (availableWidth + itemSpacing) / (targetItemWidth + itemSpacing),
    ),
  );
  const itemWidth =
    (availableWidth - itemSpacing * (numColumns - 1)) / numColumns;

  const iconButtonStyle = {
    alignItems: 'center' as const,
    borderRadius: 20,
    justifyContent: 'center' as const,
    minHeight: 40,
    minWidth: 40,
    padding: 4,
  };

  const chips: Array<{
    id: string;
    name: string;
    icon: string;
    color?: string;
    count: number;
  }> = [
    {
      id: ALL_FILTER,
      name: 'All',
      icon: 'list',
      count: watchList.length,
    },
    ...collections.map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      count: counts[c.id] || 0,
    })),
  ];

  const renderChips = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{flexGrow: 0, marginBottom: 14}}
      contentContainerStyle={{
        gap: 8,
        paddingLeft: isTV ? 12 : 6,
        paddingRight: isTV ? 48 : 6,
        paddingVertical: 4,
      }}>
      {chips.map(chip => {
        const selected = chip.id === filter;
        const isCategory = chip.id !== ALL_FILTER;
        return (
          <TVFocusable
            key={chip.id}
            ref={selected ? activeChipRef : undefined}
            onLayout={selected ? updateActiveChipNode : undefined}
            accessibilityRole="tab"
            accessibilityState={{selected}}
            accessibilityLabel={`${chip.name}, ${chip.count} titles`}
            onPress={() => selectFilter(chip.id)}
            onLongPress={
              isCategory
                ? () => {
                    triggerHaptic(HapticFeedbackTypes.impactMedium);
                    setEditor({
                      visible: true,
                      collection: collections.find(c => c.id === chip.id),
                    });
                  }
                : undefined
            }
            nextFocusDown={firstCardNode ?? undefined}
            borderRadius={18}
            focusScale={1.06}
            focusBorderColor={focusBorderColor}
            style={{
              alignItems: 'center',
              backgroundColor: selected
                ? colors.secondaryContainer
                : colors.surfaceContainerHigh,
              borderColor: selected ? colors.secondary : colors.outlineVariant,
              borderRadius: 18,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 7,
              height: isTV ? 44 : 38,
              paddingLeft: 10,
              paddingRight: 12,
            }}>
            <LibraryIcon
              icon={chip.icon}
              color={chip.color}
              size={isTV ? 19 : 17}
              glyphColor={
                chip.color ||
                (selected ? colors.onSecondaryContainer : colors.primary)
              }
            />
            <AppText
              role="labelLargeEmphasized"
              numberOfLines={1}
              style={{
                color: selected
                  ? colors.onSecondaryContainer
                  : colors.onSurface,
                maxWidth: 160,
              }}>
              {chip.name}
            </AppText>
            <AppText
              role="labelMedium"
              style={{
                color: selected
                  ? colors.onSecondaryContainer
                  : colors.onSurfaceVariant,
                opacity: 0.8,
              }}>
              {chip.count}
            </AppText>
          </TVFocusable>
        );
      })}
      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel="New category"
        onPress={() => setEditor({visible: true})}
        nextFocusDown={firstCardNode ?? undefined}
        borderRadius={18}
        focusScale={1.06}
        focusBorderColor={focusBorderColor}
        style={{
          alignItems: 'center',
          borderColor: colors.outlineVariant,
          borderRadius: 18,
          borderStyle: 'dashed',
          borderWidth: 1.5,
          flexDirection: 'row',
          gap: 6,
          height: isTV ? 44 : 38,
          paddingHorizontal: 12,
        }}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
        <AppText role="labelLargeEmphasized" style={{color: colors.primary}}>
          New
        </AppText>
      </TVFocusable>
    </ScrollView>
  );

  const renderLibraryCard = ({item, index}: {item: WatchListItem; index: number}) => {
    const isTopRow = index < numColumns;
    return (
      <MediaPosterCard
        ref={index === 0 ? firstCardRef : undefined}
        onLayout={index === 0 ? updateFirstCardNode : undefined}
        title={item.title}
        poster={item.poster}
        width={itemWidth}
        selected={selectedLinks.has(item.link)}
        selectionMode={isSelectionMode}
        hasTVPreferredFocus={
          isTV &&
          !isSelectionMode &&
          index === 0 &&
          !initialCardFocused
        }
        onFocus={
          initialCardFocused
            ? undefined
            : () => setInitialCardFocused(true)
        }
        nextFocusUp={
          isTopRow && !isSelectionMode
            ? (activeChipNode ?? undefined)
            : undefined
        }
        onPress={() => handleCardPress(item)}
        onLongPress={() => handleCardLongPress(item)}
      />
    );
  };

  const editableCollection = activeCollection;

  return (
    <TVFocusGuide
      trapFocusRight={true}
      trapFocusDown={true}
      trapFocusUp={true}
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: isTV ? 0 : insets.top,
      }}>
      <StatusBar />

      {/* Top Selection Header Toolbar */}
      {isSelectionMode ? (
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surfaceContainerHigh,
            borderBottomColor: colors.outlineVariant,
            borderBottomWidth: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingBottom: 12,
            paddingLeft: isTV ? 20 : 16,
            paddingRight: isTV ? 48 : 16,
            paddingTop: Platform.OS === 'android' ? (isTV ? 20 : 36) : 14,
            zIndex: 10,
          }}>
          <View style={{alignItems: 'center', flexDirection: 'row', gap: 16}}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityRole="button"
              accessibilityLabel="Exit selection"
              onPress={handleExitSelection}
              borderRadius={20}
              focusScale={1.1}
              focusBorderColor={focusBorderColor}
              style={iconButtonStyle}>
              <MaterialCommunityIcons
                name="close"
                size={26}
                color={colors.onSurface}
              />
            </TVFocusable>
            <AppText
              role="titleLargeEmphasized"
              style={{color: colors.onSurface}}>
              {selectedLinks.size} selected
            </AppText>
          </View>

          <View style={{alignItems: 'center', flexDirection: 'row', gap: 12}}>
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Invert selection"
              onPress={handleInvertSelection}
              borderRadius={20}
              focusScale={1.1}
              focusBorderColor={focusBorderColor}
              style={iconButtonStyle}>
              <MaterialCommunityIcons
                name="select-inverse"
                size={24}
                color={colors.onSurfaceVariant}
              />
            </TVFocusable>
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Select all"
              onPress={handleToggleSelectAll}
              borderRadius={20}
              focusScale={1.1}
              focusBorderColor={focusBorderColor}
              style={iconButtonStyle}>
              <MaterialIcons
                name="select-all"
                size={24}
                color={isAllSelected ? colors.primary : colors.onSurface}
              />
            </TVFocusable>
          </View>
        </View>
      ) : (
        <View
          className="w-full bg-m3-background"
          style={{
            paddingTop: Platform.OS === 'android' ? (isTV ? 4 : 15) : 0,
          }}
        />
      )}

      <View className="flex-1 w-full px-3" onLayout={event => {
        const width = event.nativeEvent.layout.width;
        if (width > 0) setContainerWidth(previous => previous === width ? previous : width);
      }}>
        {!isSelectionMode ? (
          <>
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 12,
                marginTop: isTV ? 16 : 8,
                paddingLeft: isTV ? 12 : 6,
                paddingRight: isTV ? 48 : 6,
              }}>
              <AppText
                role="headlineLargeEmphasized"
                className="text-m3-on-background">
                Library
              </AppText>
              <View
                style={{alignItems: 'center', flexDirection: 'row', gap: 8}}>
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel={
                    'Sort titles, ' +
                    librarySortChoices.find(choice => choice.value === sort)?.label
                  }
                  onPress={() => setSortPickerVisible(true)}
                  borderRadius={18}
                  focusBorderColor={focusBorderColor}
                  style={{
                    padding: 8,
                    borderRadius: 18,
                    backgroundColor: colors.surfaceContainerHigh,
                  }}>
                  <MaterialCommunityIcons name="sort" size={22} color={colors.primary} />
                </TVFocusable>
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="Local content"
                  onPress={() => navigation.navigate('LocalContent', {collectionId: activeCollection?.id})}
                  borderRadius={18}
                  focusBorderColor={focusBorderColor}
                  style={{padding: 8, borderRadius: 18, backgroundColor: colors.surfaceContainerHigh}}>
                  <MaterialCommunityIcons name="folder-play-outline" size={22} color={colors.primary} />
                </TVFocusable>
                {editableCollection ? (
                  <TVFocusable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${editableCollection.name}`}
                    onPress={() =>
                      setEditor({visible: true, collection: editableCollection})
                    }
                    borderRadius={18}
                    focusScale={1.08}
                    focusBorderColor={focusBorderColor}
                    style={{
                      alignItems: 'center',
                      backgroundColor: colors.surfaceContainerHigh,
                      borderRadius: 18,
                      height: 36,
                      justifyContent: 'center',
                      width: 36,
                    }}>
                    <MaterialCommunityIcons
                      name="pencil-outline"
                      size={18}
                      color={colors.primary}
                    />
                  </TVFocusable>
                ) : null}
                {visibleItems.length > 0 ? (
                  <TVFocusable
                    ref={selectButtonRef}
                    onLayout={updateSelectButtonNode}
                    accessibilityRole="button"
                    accessibilityLabel="Select items"
                    nextFocusRight={selectButtonNode ?? undefined}
                    nextFocusUp={selectButtonNode ?? undefined}
                    nextFocusDown={activeChipNode ?? undefined}
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
            </View>
            {renderChips()}
          </>
        ) : null}

        {visibleItems.length > 0 ? (isTV ? (
          <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}
            contentContainerStyle={{paddingTop: isSelectionMode ? 14 : 0, paddingBottom: isSelectionMode ? 120 : 50}}>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: itemSpacing}}>
              {visibleItems.map((item, index) => (
                <React.Fragment key={JSON.stringify([item.provider, item.link])}>
                  {renderLibraryCard({item, index})}
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            style={{flex: 1, minHeight: 0}}
            key={`library-cols-${numColumns}-${filter}`}
            data={visibleItems}
            renderItem={renderLibraryCard}
            keyExtractor={item => JSON.stringify([item.provider, item.link])}
            windowSize={isTV ? 21 : 7}
            maxToRenderPerBatch={isTV ? 10 : 8}
            initialNumToRender={isTV ? 10 : numColumns * 4}
            numColumns={numColumns}
            columnWrapperStyle={
              numColumns > 1
                ? {gap: itemSpacing, justifyContent: 'flex-start'}
                : undefined
            }
            contentContainerStyle={{
              paddingTop: isSelectionMode ? 14 : 0,
              paddingBottom: (isSelectionMode ? 120 : 50) + floatingTabBarInset,
            }}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
          />
        )) : (
          <View className="flex-1">
            <View className="items-center justify-center mt-16 mb-12 px-6">
              {activeCollection ? (
                <LibraryIcon
                  icon={activeCollection.icon}
                  color={activeCollection.color}
                  size={40}
                  tile
                />
              ) : (
                <MaterialCommunityIcons
                  name="bookmark-off-outline"
                  size={72}
                  color={colors.onSurfaceVariant}
                />
              )}
              <AppText
                role="titleMedium"
                className="mt-4 text-center"
                style={{color: colors.onSurface}}>
                {activeCollection
                  ? `${activeCollection.name} is empty`
                  : 'Your library is empty'}
              </AppText>
              <AppText
                role="bodyMedium"
                className="mt-2 text-center text-m3-on-surface-variant">
                Use Save on a title to add it here.
              </AppText>
            </View>
          </View>
        )}
      </View>

      {/* Bottom Action Bar in Selection Mode */}
      {isSelectionMode ? (
        <View
          style={{
            bottom: isTV ? 20 : 24 + floatingTabBarInset,
            left: isTV ? 24 : 16,
            position: 'absolute',
            right: isTV ? 48 : 16,
            zIndex: 20,
          }}>
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHighest,
              borderColor: colors.outlineVariant,
              borderRadius: 24,
              borderWidth: 1,
              elevation: 8,
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 10,
              shadowColor: '#000',
              shadowOffset: {width: 0, height: 4},
              shadowOpacity: 0.35,
              shadowRadius: 10,
            }}>
            <View style={{alignItems: 'center', flexDirection: 'row', gap: 16}}>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Select all"
                onPress={handleToggleSelectAll}
                borderRadius={18}
                focusScale={1.1}
                focusBorderColor={focusBorderColor}
                style={{
                  ...iconButtonStyle,
                  borderRadius: 18,
                  minHeight: 36,
                  minWidth: 36,
                }}>
                <MaterialIcons
                  name="select-all"
                  size={24}
                  color={
                    isAllSelected ? colors.primary : colors.onSurfaceVariant
                  }
                />
              </TVFocusable>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Invert selection"
                onPress={handleInvertSelection}
                borderRadius={18}
                focusScale={1.1}
                focusBorderColor={focusBorderColor}
                style={{
                  ...iconButtonStyle,
                  borderRadius: 18,
                  minHeight: 36,
                  minWidth: 36,
                }}>
                <MaterialCommunityIcons
                  name="select-inverse"
                  size={24}
                  color={colors.onSurfaceVariant}
                />
              </TVFocusable>
              <AppText
                role="labelMediumEmphasized"
                style={{color: colors.onSurfaceVariant}}>
                {selectedLinks.size} selected
              </AppText>
            </View>

            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Remove selected items"
              disabled={selectedLinks.size === 0}
              onPress={handleDeletePress}
              borderRadius={16}
              focusScale={1.06}
              focusBorderColor={focusBorderColor}
              style={{
                alignItems: 'center',
                backgroundColor:
                  selectedLinks.size > 0
                    ? colors.errorContainer
                    : colors.surfaceContainerHigh,
                borderRadius: 16,
                flexDirection: 'row',
                gap: 6,
                opacity: selectedLinks.size === 0 ? 0.45 : 1,
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}>
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={20}
                color={
                  selectedLinks.size > 0
                    ? colors.onErrorContainer
                    : colors.onSurfaceVariant
                }
              />
              <AppText
                role="labelLargeEmphasized"
                style={{
                  color:
                    selectedLinks.size > 0
                      ? colors.onErrorContainer
                      : colors.onSurfaceVariant,
                  fontWeight: '700',
                }}>
                Remove
              </AppText>
            </TVFocusable>
          </View>
        </View>
      ) : null}

      {sortPickerVisible && (
        <SettingsChoiceDialog
          title="Sort Library"
          choices={librarySortChoices}
          selected={sort}
          onSelect={value => {
            mainStorage.setString(LIBRARY_SORT_KEY, value);
            setSort(value);
            setSortPickerVisible(false);
          }}
          onDismiss={() => setSortPickerVisible(false)}
        />
      )}

      <LibraryCollectionDialog
        visible={editor.visible}
        collection={editor.visible ? editor.collection : undefined}
        onClose={() => setEditor({visible: false})}
        onSaved={collection => {
          if (!editor.visible || !editor.collection) {
            setFilter(collection.id);
          }
        }}
      />
    </TVFocusGuide>
  );
};

export default Library;
