import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useMemo, useState} from 'react';
import {FlatList, TouchableOpacity, View} from 'react-native';
import ReactNativeHapticFeedback, {
  HapticFeedbackTypes,
} from 'react-native-haptic-feedback';
import type {HomeStackParamList} from '../App';
import {useImageAccent} from '../lib/hooks/useImageAccent';
import {getContinueWatchingRow} from '../lib/player/upNext';
import {settingsStorage} from '../lib/storage';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../lib/zustand/continueWatchingStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import MediaPosterCard from './MediaPosterCard';
import AppText from './ui/Text';
import {isTV} from '../lib/tv/constants';
import {TVFocusable} from './tv';
import useLocalContentStore from '../lib/zustand/localContentStore';
import {localContentId, localContentInfo, localContentLink} from '../lib/localContent/library';
import {getLocalContinueWatching} from '../lib/localContent/playback';
import {watchProgressStorage} from '../lib/storage';

interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
  width?: number;
  selected?: boolean;
  selectionMode?: boolean;
  onOpen: (item: ContinueWatchingItem) => void;
  onLongPress: (item: ContinueWatchingItem) => void;
}

const ContinueWatchingCard = ({
  item,
  width = 124,
  selected = false,
  selectionMode = false,
  onOpen,
  onLongPress,
}: ContinueWatchingCardProps) => {
  const colors = useM3Colors();
  const poster = item.poster || item.background;
  const episodeTitle =
    item.episodeTitle ||
    (item.episode?.title && item.episode.title !== item.title
      ? item.episode.title
      : undefined);
  const progressColor = useImageAccent(poster, colors.primary);
  const progress =
    item.duration > 0
      ? Math.min(100, Math.max(0, (item.position / item.duration) * 100))
      : 0;

  return (
    <View style={{width, overflow: 'visible'}}>
      <MediaPosterCard
        title={item.title}
        subtitle={episodeTitle}
        poster={poster}
        width={width}
        selected={selected}
        selectionMode={selectionMode}
        onPress={() => onOpen(item)}
        onLongPress={() => onLongPress(item)}
      />
      <View
        style={{
          backgroundColor: colors.surfaceContainerHighest,
          borderRadius: 2,
          height: 3,
          marginTop: selected ? 4 : 7,
          overflow: 'hidden',
          width: '100%',
        }}>
        <View
          style={{
            backgroundColor: progressColor,
            height: 3,
            width: `${progress}%`,
          }}
        />
      </View>
    </View>
  );
};

const ContinueWatching = ({localOnly = false}: {localOnly?: boolean}) => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const storedItems = useContinueWatchingStore(state => state.items);
  const localTitles = useLocalContentStore(state => state.titles);
  const removeItem = useContinueWatchingStore(state => state.removeItem);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isSelectionMode = selectedIds.size > 0;

  // Watched movies stay in the store (and synced history), only the row
  // leaves them out.
  const items = useMemo(
    () => {
      const localItems: ContinueWatchingItem[] = localTitles.flatMap(title => {
        const target = getLocalContinueWatching(title, uri => {
          return watchProgressStorage.getProgress(uri) || undefined;
        });
        if (!target) return [];
        const link = localContentLink(title.id);
        return [{id: link, infoUrl: link, providerValue: 'local',
          title: title.metadata?.title || title.name, episodeTitle: target.title, seasonTitle: target.seasonTitle,
          episode: {id: target.episode.uri, link: target.episode.uri, title: target.title},
          type: localContentInfo(title).type || 'series', poster: title.metadata?.poster, background: title.metadata?.background,
          position: target.position, duration: target.duration, updatedAt: target.updatedAt}];
      });
      return getContinueWatchingRow([...(localOnly ? [] : storedItems), ...localItems]);
    },
    [storedItems, localTitles, localOnly],
  );

  const triggerHaptic = useCallback(
    (type: HapticFeedbackTypes = HapticFeedbackTypes.effectTick) => {
      if (settingsStorage.isHapticFeedbackEnabled()) {
        ReactNativeHapticFeedback.trigger(type, {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
    },
    [],
  );

  const handleCardPress = useCallback(
    (item: ContinueWatchingItem) => {
      if (isSelectionMode) {
        triggerHaptic(HapticFeedbackTypes.effectTick);
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(item.id)) {
            next.delete(item.id);
          } else {
            next.add(item.id);
          }
          return next;
        });
      } else {
        navigation.navigate('Info', {
          link: item.infoUrl,
          provider: item.providerValue,
          poster: item.poster || item.background,
        });
      }
    },
    [isSelectionMode, navigation, triggerHaptic],
  );

  const handleCardLongPress = useCallback(
    (item: ContinueWatchingItem) => {
      triggerHaptic(HapticFeedbackTypes.impactMedium);
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    },
    [triggerHaptic],
  );

  const handleExitSelection = useCallback(() => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    setSelectedIds(new Set());
  }, [triggerHaptic]);

  const handleStartSelection = useCallback(() => {
    if (items[0]) handleCardLongPress(items[0]);
  }, [items, handleCardLongPress]);

  const handleToggleSelectAll = useCallback(() => {
    triggerHaptic(HapticFeedbackTypes.effectClick);
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(item => item.id)));
    }
  }, [items, selectedIds.size, triggerHaptic]);

  const handleDeletePress = useCallback(() => {
    if (selectedIds.size === 0) return;

    triggerHaptic(HapticFeedbackTypes.effectHeavyClick);
    const count = selectedIds.size;

    showAppDialog({
      title: `Clear History?`,
      message: `Are you sure you want to remove ${count} ${
        count === 1 ? 'title' : 'titles'
      } from your continue watching history?`,
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Clear',
          variant: 'destructive',
          onPress: () => {
            selectedIds.forEach(id => {
              const localId = localContentId(id);
              if (localId) useLocalContentStore.getState().clearPlayback(localId);
              else removeItem(id);
            });
            setSelectedIds(new Set());
          },
        },
      ],
    });
  }, [selectedIds, removeItem, triggerHaptic]);

  if (items.length === 0) {
    return null;
  }

  const isAllSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <View style={{gap: 14, marginTop: 28}}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
        }}>
        {isSelectionMode ? (
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              gap: 8,
              flex: 1,
              marginRight: 8,
            }}>
            {isTV ? (
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Exit Continue Watching selection"
                onPress={handleExitSelection}
                style={{padding: 6}}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={colors.onBackground}
                />
              </TVFocusable>
            ) : (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleExitSelection}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={colors.onBackground}
                />
              </TouchableOpacity>
            )}
            <AppText
              role="titleLargeEmphasized"
              numberOfLines={1}
              style={{color: colors.onBackground, flex: 1}}>
              Continue watching
            </AppText>
          </View>
        ) : (
          <AppText
            role="titleLargeEmphasized"
            numberOfLines={1}
            style={{color: colors.onBackground, flex: 1}}>
            Continue watching
          </AppText>
        )}

        {/* Delete button where the see all button appears in slider */}
        {isSelectionMode ? (
          <View style={{alignItems: 'center', flexDirection: 'row', gap: 6}}>
            {isTV ? (
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Select all Continue Watching items"
                onPress={handleToggleSelectAll}
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                }}>
                <MaterialIcons
                  name="select-all"
                  size={22}
                  color={
                    isAllSelected ? colors.primary : colors.onSurfaceVariant
                  }
                />
              </TVFocusable>
            ) : (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleToggleSelectAll}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                }}>
                <MaterialIcons
                  name="select-all"
                  size={22}
                  color={
                    isAllSelected ? colors.primary : colors.onSurfaceVariant
                  }
                />
              </TouchableOpacity>
            )}
            {isTV ? (
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Clear selected Continue Watching items"
                disabled={selectedIds.size === 0}
                onPress={handleDeletePress}
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.errorContainer,
                  borderRadius: 10,
                  width: 32,
                  height: 32,
                }}>
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={18}
                  color={colors.onErrorContainer}
                />
              </TVFocusable>
            ) : (
              <TouchableOpacity
                activeOpacity={0.75}
                disabled={selectedIds.size === 0}
                onPress={handleDeletePress}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.errorContainer,
                  borderRadius: 10,
                  width: 32,
                  height: 32,
                }}>
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={18}
                  color={colors.onErrorContainer}
                />
              </TouchableOpacity>
            )}
          </View>
        ) : isTV ? (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Select Continue Watching items"
            onPress={handleStartSelection}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: colors.surfaceContainerHigh,
              borderRadius: 12,
            }}>
            <AppText
              role="labelMediumEmphasized"
              style={{color: colors.onSurface}}>
              Select items
            </AppText>
          </TVFocusable>
        ) : null}
      </View>

      <FlatList
        initialNumToRender={isTV ? 10 : 6}
        windowSize={isTV ? 21 : 5}
        maxToRenderPerBatch={8}
        horizontal
        data={items}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        style={{overflow: 'visible'}}
        contentContainerStyle={{
          paddingVertical: 12,
          paddingHorizontal: 20,
          overflow: 'visible',
        }}
        ItemSeparatorComponent={() => <View style={{width: 14}} />}
        renderItem={({item}) => (
          <ContinueWatchingCard
            item={item}
            selected={selectedIds.has(item.id)}
            selectionMode={isSelectionMode}
            onOpen={handleCardPress}
            onLongPress={handleCardLongPress}
          />
        )}
      />
    </View>
  );
};

export default ContinueWatching;
