import React, {memo, useCallback, useLayoutEffect, useState} from 'react';
import {LayoutChangeEvent, Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {MaterialIcons} from '@expo/vector-icons';
import type {ProviderExtension} from '../lib/storage/extensionStorage';
import {settingsStorage} from '../lib/storage/SettingsStorage';
import useContentStore from '../lib/zustand/contentStore';
import {
  moveItem,
  providerOrderKey,
  sortInstalledProviders,
} from '../lib/providerOrder';
import ProviderIcon from './ProviderIcon';
import ProviderAdultBadge from './ProviderAdultBadge';

const LONG_PRESS_MS = 300;
const SETTLE_MS = 120;

interface ReorderableProviderListProps {
  providers: ProviderExtension[];
  selectedValue: string;
  primary: string;
  onSelect: (provider: ProviderExtension) => void;
}

/**
 * Provider rows for the phone drawer. Tap selects; hold a row, then drag it
 * up or down to change the order. The order is saved and used everywhere the
 * installed providers are listed.
 */
const ReorderableProviderList = ({
  providers,
  selectedValue,
  primary,
  onSelect,
}: ReorderableProviderListProps) => {
  const [order, setOrder] = useState(providers);
  const rowHeight = useSharedValue(56);
  const dragFrom = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const [dragging, setDragging] = useState(false);

  // Follow installs, removals and updates made elsewhere. Not mid-drag: the
  // new order would reset the drag and drop the wrong row.
  useLayoutEffect(() => {
    if (!dragging) {
      setOrder(providers);
    }
  }, [providers, dragging]);

  // Rows already sit in their new places when the drag settles, so the
  // offsets are cleared only once the new order has rendered.
  useLayoutEffect(() => {
    dragFrom.set(-1);
    dragY.set(0);
  }, [order, dragFrom, dragY]);

  const commit = useCallback(
    (from: number, to: number) => {
      setDragging(false);
      if (from < 0 || from === to) {
        dragFrom.set(-1);
        dragY.set(0);
        return;
      }
      // Apply the move to the latest list, so changes made during the drag
      // are kept.
      const store = useContentStore.getState();
      const visible = new Set(providers.map(providerOrderKey));
      const next = sortInstalledProviders(providers, moveItem(order, from, to).map(providerOrderKey));
      const reorderedKeys = next.map(providerOrderKey).values();
      const fullOrder = store.installedProviders.map(provider => {
        const key = providerOrderKey(provider);
        return visible.has(key) ? reorderedKeys.next().value ?? key : key;
      });
      setOrder(next);
      settingsStorage.setProviderOrder(fullOrder);
      store.setInstalledProviders(store.installedProviders);
    },
    [providers, order, dragFrom, dragY],
  );

  const onRowLayout = useCallback(
    (event: LayoutChangeEvent) => {
      rowHeight.set(event.nativeEvent.layout.height);
    },
    [rowHeight],
  );

  return (
    <>
      {order.map((item, index) => (
        <ProviderRow
          key={providerOrderKey(item)}
          item={item}
          index={index}
          count={order.length}
          isSelected={item.value === selectedValue}
          primary={primary}
          rowHeight={rowHeight}
          dragFrom={dragFrom}
          dragY={dragY}
          onSelect={onSelect}
          onDrop={commit}
          onDragChange={setDragging}
          onLayout={index === 0 ? onRowLayout : undefined}
        />
      ))}
    </>
  );
};

interface ProviderRowProps {
  item: ProviderExtension;
  index: number;
  count: number;
  isSelected: boolean;
  primary: string;
  rowHeight: SharedValue<number>;
  dragFrom: SharedValue<number>;
  dragY: SharedValue<number>;
  onSelect: (provider: ProviderExtension) => void;
  onDrop: (from: number, to: number) => void;
  onDragChange: (dragging: boolean) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const triggerHaptic = () => {
  if (settingsStorage.isHapticFeedbackEnabled()) {
    ReactNativeHapticFeedback.trigger('effectHeavyClick', {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  }
};

const ProviderRow = memo(
  ({
    item,
    index,
    count,
    isSelected,
    primary,
    rowHeight,
    dragFrom,
    dragY,
    onSelect,
    onDrop,
    onDragChange,
    onLayout,
  }: ProviderRowProps) => {
    const pressed = useSharedValue(0);

    const targetIndex = () => {
      'worklet';
      const to = Math.round(dragFrom.get() + dragY.get() / rowHeight.get());
      return Math.max(0, Math.min(count - 1, to));
    };

    const pan = Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart(() => {
        dragFrom.set(index);
        dragY.set(0);
        runOnJS(onDragChange)(true);
        runOnJS(triggerHaptic)();
      })
      .onUpdate(event => {
        dragY.set(event.translationY);
      })
      .onEnd(() => {
        const from = dragFrom.get();
        if (from < 0) {
          // The drag was reset under us; drop nothing.
          dragY.set(0);
          runOnJS(onDrop)(-1, -1);
          return;
        }
        const to = targetIndex();
        // Slide into the free slot, then save the new order.
        dragY.set(
          withTiming(
            (to - from) * rowHeight.get(),
            {duration: SETTLE_MS},
            finished => {
              if (finished) runOnJS(onDrop)(from, to);
            },
          ),
        );
      })
      .onFinalize((_event, success) => {
        // A cancelled drag (another gesture took over) puts the row back.
        if (!success && dragFrom.get() === index) {
          dragFrom.set(-1);
          dragY.set(0);
          runOnJS(onDragChange)(false);
        }
      });

    const tap = Gesture.Tap()
      .onBegin(() => {
        pressed.set(1);
      })
      .onEnd(() => {
        runOnJS(onSelect)(item);
      })
      .onFinalize(() => {
        pressed.set(0);
      });

    // A hold that turns into a drag never also selects the row.
    const gesture = Gesture.Exclusive(pan, tap);

    const rowStyle = useAnimatedStyle(() => {
      const from = dragFrom.get();
      if (from < 0) {
        return {transform: [{translateY: 0}, {scale: 1}], zIndex: 0};
      }
      if (from === index) {
        return {
          transform: [{translateY: dragY.get()}, {scale: 1.02}],
          zIndex: 10,
        };
      }
      // Rows between the old and new slot make room for the dragged one.
      const to = targetIndex();
      let shift = 0;
      if (from < to && index > from && index <= to) shift = -rowHeight.get();
      if (from > to && index < from && index >= to) shift = rowHeight.get();
      return {
        transform: [
          {translateY: withTiming(shift, {duration: SETTLE_MS})},
          {scale: 1},
        ],
        zIndex: 0,
      };
    });

    const backgroundStyle = useAnimatedStyle(() => {
      const lifted = dragFrom.get() === index;
      let opacity = isSelected ? 0.1 : 0;
      if (pressed.get()) opacity = Math.max(opacity, 0.06);
      if (lifted) opacity = 0.16;
      return {backgroundColor: `rgba(255, 255, 255, ${opacity})`};
    });

    return (
      <GestureDetector gesture={gesture}>
        <Animated.View
          onLayout={onLayout}
          style={[{paddingVertical: 2}, rowStyle]}
          accessibilityRole="button"
          accessibilityLabel={item.display_name}
          accessibilityHint="Hold and drag to reorder"
          accessibilityState={{selected: isSelected}}>
          <Animated.View
            style={[
              {
                alignItems: 'center',
                borderRadius: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 14,
              },
              backgroundStyle,
            ]}>
            <View style={{alignItems: 'center', flexDirection: 'row', flex: 1}}>
              <ProviderIcon
                uri={item.icon}
                name={item.display_name}
                size={20}
                background="rgba(255, 255, 255, 0.08)"
                color={isSelected ? primary : '#888'}
              />
              <Text
                numberOfLines={1}
                className={`ml-2.5 text-[15.5px] ${
                  isSelected ? 'text-white font-medium' : 'text-gray-400'
                }`}
                style={{flexShrink: 1}}>
                {item.display_name}
              </Text>
              {item.adult === true && <ProviderAdultBadge />}
            </View>
            {isSelected && (
              <MaterialIcons name="check" size={20} color={primary} />
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    );
  },
);

export default memo(ReorderableProviderList);
