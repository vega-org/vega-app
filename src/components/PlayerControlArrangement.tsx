import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, Text, View, UIManager, findNodeHandle, useWindowDimensions} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {isTV} from '../lib/tv/constants';
import {TVFocusable} from './tv';
import {PlayerControl, PlayerControlIcon} from './PlayerControlBar';
import {MAX_TOP_CONTROLS, movePlayerControl, normalizePlayerControlLayout,
  PlayerControlBar, PlayerControlId, PlayerControlLayout} from '../lib/player/controlLayout';

const TOP_Y = 24;
const BOTTOM_Y = 96;
const CELL_HEIGHT = 50;
const BOTTOM_GAP = 12;
const BOTTOM_BARS = [
  {id: 'bottom', label: 'Bottom left'},
  {id: 'bottomRight', label: 'Bottom right'},
] as const;
const CONTROL_BARS = ['top', 'bottom', 'bottomRight', 'more'] as const;
const MENU_PADDING = 8;
const noop = () => {};
const EDITOR_LABELS: Record<PlayerControlId, string> = {
  sleep: 'Sleep',
  lock: 'Lock',
  cast: 'Cast',
  audio: 'Audio',
  subtitle: 'Subtitles',
  speed: 'Speed',
  pip: 'PiP',
  server: 'Quality',
  resize: 'Fit',
  rotate: 'Rotate',
  episodes: 'Episodes',
  next: 'Next',
  settings: 'Settings',
  decoder: 'Decoder',
};

type TokenProps = {
  control: PlayerControl;
  x: number;
  y: number;
  width: number;
  top: boolean;
  selected: boolean;
  hidden: boolean;
  epoch: number;
  color: string;
  onHandle: (id: PlayerControlId, handle: number) => void;
  nextFocusUp?: number;
  onSelect: (id: PlayerControlId) => void;
  onDragStart: (id: PlayerControlId) => void;
  onDrop: (id: PlayerControlId, x: number, y: number) => void;
};

function ControlToken({
  control,
  x,
  y,
  width,
  top,
  selected,
  hidden,
  epoch,
  color,
  onSelect,
  onHandle,
  nextFocusUp,
  onDragStart,
  onDrop,
}: TokenProps) {
  const id = control.id;
  const tokenRef = useRef<View>(null);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const active = useSharedValue(false);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  useEffect(() => {
    dx.set(0);
    dy.set(0);
    active.set(false);
  }, [x, y, epoch, dx, dy, active]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(250)
        .onStart(event => {
          originX.set(event.absoluteX - event.x - x);
          originY.set(event.absoluteY - event.y - y);
          active.set(true);
          runOnJS(onDragStart)(id);
        })
        .onUpdate(event => {
          dx.set(event.translationX);
          dy.set(event.translationY);
        })
        .onEnd(event => {
          runOnJS(onDrop)(
            id,
            event.absoluteX - originX.get(),
            event.absoluteY - originY.get(),
          );
        })
        .onFinalize((_event, success) => {
          if (!success) {
            dx.set(0);
            dy.set(0);
            active.set(false);
          }
        }),
    [id, x, y, dx, dy, active, originX, originY, onDragStart, onDrop],
  );
  const tap = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(onSelect)(id)),
    [id, onSelect],
  );
  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);
  const style = useAnimatedStyle(() => ({
    transform: [
      {translateX: dx.get()},
      {translateY: dy.get()},
      {scale: active.get() ? 1.08 : 1},
    ],
    zIndex: active.get() ? 100 : selected ? 2 : 1,
    opacity: hidden ? 0.4 : 1,
  }));
  const content = (
    <>
      <PlayerControlIcon control={control} size={20} />
      {!top && (
        <Text
          numberOfLines={1}
          style={{color: 'white', fontSize: 11, marginTop: 2}}>
          {EDITOR_LABELS[control.id]}
        </Text>
      )}
    </>
  );
  const tokenStyle = {
    width,
    height: top ? 42 : 44,
    paddingVertical: 4,
    borderRadius: top ? 21 : 10,
    borderWidth: 1,
    borderColor: selected ? color : 'transparent',
    backgroundColor: selected ? '#353535' : '#242424',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  if (isTV)
    return (
      <View style={{position: 'absolute', left: x, top: y}}>
        <TVFocusable
          ref={tokenRef}
          onLayout={() => { const handle = findNodeHandle(tokenRef.current); if (handle) onHandle(id, handle); }}
          nextFocusUp={nextFocusUp}
          accessibilityState={{selected}}
          registerScreenFocus={false}
          onPress={() => onSelect(control.id)}
          focusBorderColor={color}
          accessibilityLabel={`Move ${control.title}`}
          borderRadius={12}
          style={tokenStyle}>
          {content}
        </TVFocusable>
      </View>
    );
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Move ${control.title}`}
        accessibilityHint="Hold and drag, or tap and use the move buttons"
        accessibilityActions={[{name: 'activate', label: 'Select control'}]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'activate') onSelect(control.id);
        }}
        onAccessibilityTap={() => onSelect(control.id)}
        style={[{position: 'absolute', left: x, top: y}, tokenStyle, style]}>
        {content}
      </Animated.View>
    </GestureDetector>
  );
}

export type PlayerControlArrangementProps = {
  layout: PlayerControlLayout;
  hiddenControls?: PlayerControlId[];
  controls: PlayerControl[];
  color: string;
  limit?: number;
  page?: boolean;
  exitUpHandle?: number;
  onEntryHandle?: (handle: number) => void;
  onChange: (layout: PlayerControlLayout, hidden: PlayerControlId[]) => void;
  onHaptic?: () => void;
};
export default function PlayerControlArrangement({layout, hiddenControls, controls, color,
  limit = MAX_TOP_CONTROLS, page = false, exitUpHandle, onEntryHandle, onChange, onHaptic = noop}: PlayerControlArrangementProps) {
  const {width} = useWindowDimensions();
  const firstActionRef = useRef<View>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tokenHandles, setTokenHandles] = useState<Partial<Record<PlayerControlId, number>>>({});
  const registerToken = useCallback((id: PlayerControlId, handle: number) => {
    setTokenHandles(previous => previous[id] === handle ? previous : {...previous, [id]: handle});
  }, []);
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const draft = useMemo(() => normalizePlayerControlLayout(layout, limit), [layout, limit]);
  const hidden = hiddenControls || [];
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const first = draft.top[0] ?? draft.bottom[0] ?? draft.bottomRight[0] ?? draft.more[0];
    const handle = first ? tokenHandles[first] : undefined;
    if (handle) onEntryHandle?.(handle);
  }, [draft, tokenHandles, onEntryHandle]);
  const [selected, setSelected] = useState<PlayerControlId | null>(
    isTV ? 'sleep' : null,
  );
  const selectControl = useCallback((id: PlayerControlId) => {
    setSelected(id);
    if (!isTV) return;
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      const handle = findNodeHandle(firstActionRef.current);
      if (handle) UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
    }, 50);
  }, []);
  const [canvasWidth, setCanvasWidth] = useState(
    Math.max(240, Math.min(600, width - 32) - 28),
  );
  const [epoch, setEpoch] = useState(0);
  const [message, setMessage] = useState(
    isTV ? 'Select a control to open its move actions. Press Up to return to the selected control.' : 'Hold and drag to rearrange. Tap a control for more options.',
  );
  const columns = Math.max(2, Math.floor(canvasWidth / 96));
  const menuCellWidth = (canvasWidth - MENU_PADDING * 2) / columns;
  const bottomWidth = Math.max(1, (canvasWidth - BOTTOM_GAP) / 2);
  const bottomColumns = Math.max(1, Math.floor(bottomWidth / 68));
  const bottomCellWidth = bottomWidth / bottomColumns;
  const bottomRows = Math.max(
    1,
    Math.ceil(Math.max(draft.bottom.length, draft.bottomRight.length) / bottomColumns),
  );
  const moreY = BOTTOM_Y + bottomRows * CELL_HEIGHT + 34;
  const canvasHeight =
    moreY + Math.max(1, Math.ceil(draft.more.length / columns)) * CELL_HEIGHT + MENU_PADDING * 2;
  const startDrag = useCallback(
    (id: PlayerControlId) => {
      setSelected(id);
      onHaptic();
    },
    [onHaptic],
  );
  const move = useCallback(
    (id: PlayerControlId, bar: PlayerControlBar, index: number) => {
      const current = draftRef.current;
      const next = movePlayerControl(current, id, bar, index, limit);
      if (
        CONTROL_BARS.some(lane => current[lane].indexOf(id) !== next[lane].indexOf(id))
      ) {
        onHaptic();
      }
      draftRef.current = next;
      onChange(next, hidden);
      setMessage(
        next === current
          ? id === 'settings' && bar === 'more'
            ? 'Settings stays last in its row'
            : `Top bar is full (${limit} controls maximum)`
          : isTV ? 'Select a control to open its move actions. Press Up to return to the selected control.' : 'Hold and drag to rearrange. Tap a control for more options.',
      );
      setEpoch(value => value + 1);
    },
    [limit, onHaptic, onChange, hidden],
  );
  const drop = useCallback(
    (id: PlayerControlId, x: number, y: number) => {
      if (x < 0 || x > canvasWidth || y < TOP_Y - 8 || y > canvasHeight) {
        setEpoch(value => value + 1);
        return;
      }
      if (y < BOTTOM_Y - 18) {
        move(id, 'top', Math.floor(x / 48));
        return;
      }
      if (y >= moreY - 18) {
        const row = Math.max(0, Math.floor((y - moreY - MENU_PADDING) / CELL_HEIGHT));
        const column = Math.max(0, Math.min(columns - 1, Math.floor((x - MENU_PADDING) / menuCellWidth)));
        move(id, 'more', row * columns + column);
        return;
      }
      const right = x >= canvasWidth / 2;
      const leftEdge = right ? bottomWidth + BOTTOM_GAP : 0;
      const row = Math.max(0, Math.floor((y - BOTTOM_Y) / CELL_HEIGHT));
      const column = Math.max(0, Math.min(bottomColumns - 1, Math.floor((x - leftEdge) / bottomCellWidth)));
      move(id, right ? 'bottomRight' : 'bottom', row * bottomColumns + column);
    },
    [canvasWidth, canvasHeight, columns, menuCellWidth, moreY, bottomWidth, bottomColumns, bottomCellWidth, move],
  );
  const activeId = selected ?? 'sleep';
  const bar = CONTROL_BARS.find(lane => draft[lane].includes(activeId)) ?? 'bottom';
  const index = draft[bar].indexOf(activeId);
  const selectedTitle =
    controls.find(control => control.id === activeId)?.title || activeId;
  const action = (
    title: string,
    onPress: () => void,
    icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
    filled = false,
  ) => (
    <TVFocusable
      ref={title === (activeId === 'settings' ? 'Move left' : hidden.includes(activeId) ? 'Show control' : 'Hide control') ? firstActionRef : undefined}
      nextFocusUp={isTV ? tokenHandles[activeId] : undefined}
      registerScreenFocus={page}
      hasTVPreferredFocus={filled}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      borderRadius={14}
      focusBorderColor={color}
      style={{
        minWidth: icon ? 44 : 56,
        height: 44,
        paddingHorizontal: icon ? 6 : 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? color : '#242424',
        borderRadius: 16,
      }}>
      {icon ? (
        <MaterialCommunityIcons name={icon} size={19} color="#bbbbbb" />
      ) : (
        <Text
          style={{
            color: filled ? '#111111' : '#bbbbbb',
            fontSize: 13,
            fontWeight: '600',
          }}>
          {title}
        </Text>
      )}
    </TVFocusable>
  );
  return (
    <View style={page ? {flex: 1} : {flexShrink: 1}}>
      <ScrollView style={{flexShrink: 1}} contentContainerStyle={{paddingBottom: 8}}
        showsVerticalScrollIndicator={false}>
              <>
                <Text
                  numberOfLines={2}
                  style={{color: '#999', fontSize: 11, marginBottom: 10}}>
                  {message}
                </Text>
                <View
                  onLayout={event =>
                    setCanvasWidth(event.nativeEvent.layout.width)
                  }
                  style={{height: canvasHeight}}>
                  <Text style={{color: '#aaa', fontSize: 11}}>
                    Top row · {draft.top.length}/{limit}
                  </Text>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: TOP_Y - 2,
                      left: 0,
                      right: 0,
                      height: 50,
                      borderRadius: 12,
                      backgroundColor: '#1c1c1c',
                    }}
                  />
                  {Array.from({length: limit}, (_, slot) => (
                    <View
                      key={slot}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: TOP_Y,
                        left: slot * 48 + 4,
                        width: 42,
                        height: 42,
                        borderRadius: 21,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: '#3b3b3b',
                      }}
                    />
                  ))}
                  {BOTTOM_BARS.map(({id, label}, index) => {
                    const left = index * (bottomWidth + BOTTOM_GAP);
                    return (
                      <React.Fragment key={id}>
                        <Text style={{
                          position: 'absolute', top: BOTTOM_Y - 18, left,
                          color: '#aaa', fontSize: 11,
                        }}>
                          {label}
                        </Text>
                        <View
                          pointerEvents="none"
                          style={{
                            position: 'absolute', top: BOTTOM_Y - 2, left,
                            width: bottomWidth, height: bottomRows * CELL_HEIGHT,
                            borderRadius: 12, borderWidth: 1, borderStyle: 'dashed',
                            borderColor: '#3b3b3b',
                          }}
                        />
                      </React.Fragment>
                    );
                  })}
                  <Text
                    style={{
                      position: 'absolute',
                      top: moreY - 20,
                      color: '#aaa',
                      fontSize: 11,
                    }}>
                    Settings menu ·{' '}
                    {draft.more.length === 0
                      ? 'Move controls here to enable'
                      : `${draft.more.length} controls`}
                  </Text>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: moreY,
                      left: 0,
                      right: 0,
                      height:
                        Math.max(1, Math.ceil(draft.more.length / columns)) *
                        CELL_HEIGHT + MENU_PADDING * 2,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: '#3b3b3b',
                    }}
                  />
                  {CONTROL_BARS.flatMap(lane =>
                    draft[lane].map((id, slot) => {
                      const control = controls.find(item => item.id === id);
                      if (!control) return null;
                      const top = lane === 'top';
                      const menu = lane === 'more';
                      const laneColumns = menu ? columns : bottomColumns;
                      const laneCellWidth = menu ? menuCellWidth : bottomCellWidth;
                      const start = menu ? MENU_PADDING : lane === 'bottomRight' ? bottomWidth + BOTTOM_GAP : 0;
                      const x = top ? slot * 48 + 4 : start + (slot % laneColumns) * laneCellWidth;
                      const y = top ? TOP_Y : (menu ? moreY + MENU_PADDING : BOTTOM_Y) +
                        Math.floor(slot / laneColumns) * CELL_HEIGHT;
                      const previousRow = draft[lane][slot - laneColumns];
                      const topAbove = draft.top[Math.min(Math.floor(x / 48), draft.top.length - 1)];
                      const bottomAbove = x < canvasWidth / 2
                        ? draft.bottom.at(-1) ?? draft.bottomRight.at(-1)
                        : draft.bottomRight.at(-1) ?? draft.bottom.at(-1);
                      const above = previousRow ?? (menu ? bottomAbove ?? topAbove : topAbove);
                      return (
                        <ControlToken
                          key={id}
                          control={control}
                          x={x}
                          y={y}
                          width={top ? 42 : laneCellWidth - 6}
                          top={top}
                          selected={selected === id}
                          hidden={hidden.includes(id)}
                          epoch={epoch}
                          color={color}
                          onSelect={selectControl}
                          onHandle={registerToken}
                          nextFocusUp={isTV ? (top || !above ? exitUpHandle : tokenHandles[above] ?? exitUpHandle) : undefined}
                          onDragStart={startDrag}
                          onDrop={drop}
                        />
                      );
                    }),
                  )}
                </View>
              </>
      </ScrollView>
          <View style={{marginTop: 8, padding: 12, borderRadius: 16, backgroundColor: '#171717'}}>
            {selected ? (
              <>
                <Text
                  numberOfLines={1}
                  style={{color: '#bbbbbb', fontSize: 12, marginBottom: 10}}>
                  {selectedTitle}
                </Text>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                {activeId !== 'settings' &&
                  action(
                    hidden.includes(activeId) ? 'Show control' : 'Hide control',
                    () =>
                      onChange(draft, hidden.includes(activeId)
                        ? hidden.filter(id => id !== activeId)
                        : [...hidden, activeId]),
                    hidden.includes(activeId)
                      ? 'eye-outline'
                      : 'eye-off-outline',
                  )}
                {action(
                  'Move left',
                  () => move(activeId, bar, Math.max(0, index - 1)),
                  'arrow-left',
                )}
                {action(
                  'Move right',
                  () => move(activeId, bar, index + 1),
                  'arrow-right',
                )}
                {action(
                  'To top',
                  () => move(activeId, 'top', draft.top.length),
                  'arrow-up',
                )}
                {BOTTOM_BARS.map(({id, label}) => (
                  <React.Fragment key={id}>
                    {action(`To ${label.toLowerCase()}`, () => move(activeId, id, draft[id].length))}
                  </React.Fragment>
                ))}
                {activeId !== 'settings' &&
                  action(
                    'To menu',
                    () => move(activeId, 'more', draft.more.length),
                    'cog-outline',
                  )}
                </View>
              </>
            ) : (
              <Text style={{color: '#777777', fontSize: 11}}>
                Fill both bottom sides to split the bar.
              </Text>
            )}
          </View>
    </View>
  );
}
