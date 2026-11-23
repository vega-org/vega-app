import React, {memo, useCallback, useState, useRef, useEffect, useMemo} from 'react';
import {View, ScrollView, Pressable, findNodeHandle, UIManager} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import Button from '../ui/Button';
import {isTV} from '../../lib/tv/constants';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';
import {useFloatingTabBarInset} from '../navigation/FloatingTabBarInsetContext';

interface SearchHistoryProps {
  history: string[];
  onSelectSearch: (text: string) => void;
  onRemoveSearch: (text: string) => void;
  onClearHistory: () => void;
  searchFieldNodeHandle?: number | null;
  onFirstItemNodeHandle?: (node: number | null) => void;
}

interface HistoryRowProps {
  search: string;
  index: number;
  onPress: (search: string) => void;
  onRemove: (search: string) => void;
  onItemFocus: (index: number) => void;
  focusBorderColor: string;
  nextFocusUp?: number | null;
  nextFocusDown?: number | null;
  itemRef?: (el: View | null) => void;
}

const HistoryRow = memo(
  ({
    search,
    index,
    onPress,
    onRemove,
    onItemFocus,
    focusBorderColor,
    nextFocusUp,
    nextFocusDown,
    itemRef,
  }: HistoryRowProps) => {
    const colors = useM3Colors();
    const [isFocused, setIsFocused] = useState(false);
    const [removeFocused, setRemoveFocused] = useState(false);
    const [rowNode, setRowNode] = useState<number | null>(null);
    const [removeNode, setRemoveNode] = useState<number | null>(null);
    const setRowRef = useCallback((el: View | null) => {
      itemRef?.(el);
      if (isTV) setRowNode(el ? findNodeHandle(el) : null);
    }, [itemRef]);
    const setRemoveRef = useCallback((el: View | null) => {
      setRemoveNode(el ? findNodeHandle(el) : null);
    }, []);

    const handlePress = useCallback(() => {
      onPress(search);
    }, [search, onPress]);

    const handleRemove = useCallback(() => {
      onRemove(search);
    }, [search, onRemove]);

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onItemFocus(index);
    }, [onItemFocus, index]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
    }, []);

    return (
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
        <Pressable
          ref={setRowRef}
          focusable={true}
          isTVSelectable={true}
          nextFocusRight={isTV ? removeNode ?? undefined : undefined}
          nextFocusUp={nextFocusUp ?? undefined}
          nextFocusDown={nextFocusDown ?? undefined}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPress={handlePress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Search ${search} from history`}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: 20,
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: isFocused
              ? colors.surfaceContainerHigh
              : colors.surfaceContainerLow,
            borderWidth: 2.5,
            borderColor: isFocused ? focusBorderColor : 'transparent',
          }}>
          <MaterialCommunityIcons
            name="history"
            size={22}
            color={isFocused ? colors.primary : colors.onSurfaceVariant}
          />
          <AppText
            role="bodyLarge"
            numberOfLines={1}
            style={{
              flex: 1,
              marginLeft: 12,
              color: colors.onSurface,
              fontWeight: isFocused ? '700' : '500',
            }}>
            {search}
          </AppText>
          {!isTV && (
            <Pressable
              onPress={handleRemove}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${search} from recent searches`}
              style={({pressed}) => ({
                marginLeft: 8,
                padding: 4,
                borderRadius: 16,
                backgroundColor: pressed
                  ? colors.surfaceContainerHighest
                  : 'transparent',
              })}>
              <MaterialCommunityIcons
                name="close"
                size={20}
                color={colors.onSurfaceVariant}
              />
            </Pressable>
          )}
        </Pressable>
        {isTV && (
          <Pressable
            ref={setRemoveRef}
            focusable
            isTVSelectable
            nextFocusLeft={rowNode ?? undefined}
            nextFocusUp={nextFocusUp ?? undefined}
            nextFocusDown={nextFocusDown ?? undefined}
            onFocus={() => {
              setRemoveFocused(true);
              onItemFocus(index);
            }}
            onBlur={() => setRemoveFocused(false)}
            onPress={handleRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${search} from recent searches`}
            style={{
              marginLeft: 8,
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: removeFocused
                ? colors.surfaceContainerHigh
                : colors.surfaceContainerLow,
              borderWidth: 2.5,
              borderColor: removeFocused ? focusBorderColor : 'transparent',
            }}>
            <MaterialCommunityIcons
              name="close"
              size={22}
              color={removeFocused ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>
        )}
      </View>
    );
  },
);

const SearchHistory: React.FC<SearchHistoryProps> = ({
  history,
  onSelectSearch,
  onRemoveSearch,
  onClearHistory,
  searchFieldNodeHandle,
  onFirstItemNodeHandle,
}) => {
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const focusBorderColor = useTVFocusBorderColor();
  const scrollViewRef = useRef<ScrollView>(null);
  const itemRefs = useRef<(View | null)[]>([]);
  const [nodeHandles, setNodeHandles] = useState<(number | null)[]>([]);

  const [clearNode, setClearNode] = useState<number | null>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const visibleHistory = useMemo(
    () => isTV ? history.slice(0, 10) : history,
    [history],
  );
  const setClearRef = useCallback((el: View | null) => {
    if (isTV) setClearNode(el ? findNodeHandle(el) : null);
  }, []);
  const rowRefs = useMemo(() => visibleHistory.map((_, index) =>
    (el: View | null) => { itemRefs.current[index] = el; },
  ), [visibleHistory]);
  const handleRemove = useCallback((text: string) => {
    if (isTV && history.length > 1) {
      pendingFocusIndex.current = Math.max(0, visibleHistory.indexOf(text));
    }
    onRemoveSearch(text);
  }, [history.length, visibleHistory, onRemoveSearch]);

  useEffect(() => {
    if (!isTV) return;
    const handles = visibleHistory.map((_, i) =>
      itemRefs.current[i] ? findNodeHandle(itemRefs.current[i]) : null,
    );
    setNodeHandles(handles);
    onFirstItemNodeHandle?.(handles[0] ?? null);
    if (pendingFocusIndex.current !== null) {
      const index = Math.min(pendingFocusIndex.current, handles.length - 1);
      const target = handles[index] ?? searchFieldNodeHandle;
      pendingFocusIndex.current = null;
      if (target) {
        const frame = requestAnimationFrame(() => {
          UIManager.dispatchViewManagerCommand(target, 'requestTVFocus', []);
        });
        return () => cancelAnimationFrame(frame);
      }
    }
  }, [visibleHistory, onFirstItemNodeHandle, searchFieldNodeHandle]);

  const handleSelect = useCallback(
    (text: string) => {
      onSelectSearch(text);
    },
    [onSelectSearch],
  );

  const handleItemFocus = useCallback((index: number) => {
    scrollViewRef.current?.scrollTo({
      y: index * 60,
      animated: true,
    });
  }, []);

  if (history.length === 0) {
    return null;
  }

  return (
    <View style={{flex: 1, paddingHorizontal: 16, paddingTop: 16}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
        <AppText role="titleMediumEmphasized" style={{color: colors.onSurface}}>
          Recent Searches
        </AppText>
        <Button
          ref={setClearRef}
          compact
          variant="text"
          nextFocusUp={searchFieldNodeHandle}
          nextFocusDown={nodeHandles[0]}
          onPress={onClearHistory}>
          Clear all
        </Button>
      </View>

      {isTV ? (
        <View style={{paddingBottom: 20}}>
          {visibleHistory.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === visibleHistory.length - 1;
            const nextUp = isFirst
              ? clearNode ?? searchFieldNodeHandle
              : nodeHandles[index - 1];
            const nextDown = isLast
              ? nodeHandles[index]
              : nodeHandles[index + 1];

            return (
              <HistoryRow
                key={`history-${item}`}
                search={item}
                index={index}
                itemRef={rowRefs[index]}
                nextFocusUp={nextUp}
                nextFocusDown={nextDown}
                onPress={handleSelect}
                onRemove={handleRemove}
                onItemFocus={handleItemFocus}
                focusBorderColor={focusBorderColor}
              />
            );
          })}
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{paddingBottom: 20 + floatingTabBarInset}}>
          {visibleHistory.map((item, index) => (
            <HistoryRow
              key={`history-${item}`}
              search={item}
              index={index}
              onPress={handleSelect}
              onRemove={handleRemove}
              onItemFocus={handleItemFocus}
              focusBorderColor={focusBorderColor}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export default memo(SearchHistory);

