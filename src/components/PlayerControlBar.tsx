import {topControlPillStyle} from '../lib/player/topControlPillStyle';
import React, {useCallback} from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  StyleProp,
  ViewStyle,
  findNodeHandle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {isTV} from '../lib/tv/constants';
import TVFocusPressable from './tv/TVFocusPressable';
import {PlayerControlId} from '../lib/player/controlLayout';
import {
  defaultPlayerControlStyle,
  PlayerControlStyle,
} from '../lib/player/controlStyle';

export type PlayerControl = {
  id: PlayerControlId;
  title: string;
  label: string;
  shortLabel?: string;
  icon: string;
  iconText?: string;
  materialIcon?: boolean;
  visible: boolean;
  onPress: () => void;
};
export const PLAYER_CONTROL_COLOR = 'rgba(255,255,255,0.6)';
const Button = isTV ? TVFocusPressable : TouchableOpacity;
const BOTTOM_EDGE_PADDING = 12;

// Match the visible glyphs to the usual 20dp artwork inside a 24dp slot.
// These fonts have different built-in margins; keep the slot and touch target fixed.
const COMMUNITY_ICON_SCALE: Record<string, number> = {
  'screen-rotation': 20 / 24,
  'playlist-play': 24.2 / 19,
  'picture-in-picture-bottom-right-outline': 20 / 22.2,
};
const MATERIAL_ICON_SCALE: Record<string, number> = {
  hd: 20 / 18,
  sd: 20 / 18,
  '2k': 20 / 18,
  '4k': 20 / 18,
  '8k': 20 / 18,
  'high-quality': 20 / 18,
};

export function PlayerControlIcon({
  control,
  size = 24,
}: {
  control: PlayerControl;
  size?: number;
}) {
  if (control.iconText)
    return (
      <View style={{width: size, height: size, alignItems: 'center', justifyContent: 'center'}}>
        <View style={{width: size * (20 / 24), height: size * (20 / 24), borderRadius: size / 12,
          backgroundColor: PLAYER_CONTROL_COLOR, alignItems: 'center', justifyContent: 'center'}}>
          <Text allowFontScaling={false} style={{color: '#000', fontSize: size * 0.32,
            fontWeight: '800', includeFontPadding: false, textAlign: 'center'}}>
            {control.iconText}
          </Text>
        </View>
      </View>
    );
  const glyphScale = (control.materialIcon ? MATERIAL_ICON_SCALE : COMMUNITY_ICON_SCALE)[control.icon] ?? 1;
  return (
    <View style={{width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center'}}>
      {control.materialIcon ? (
        <MaterialIcons
          name={control.icon as any}
          size={size}
          style={{transform: [{scale: glyphScale}]}}
          color={PLAYER_CONTROL_COLOR}
        />
      ) : (
        <MaterialCommunityIcons
          name={control.icon as any}
          size={size}
          style={{transform: [{scale: glyphScale}]}}
          color={PLAYER_CONTROL_COLOR}
        />
      )}
    </View>
  );
}

type Props = {
  ids: PlayerControlId[];
  controls: PlayerControl[];
  top?: boolean;
  compact?: boolean;
  appearance?: PlayerControlStyle;
  onEdit: () => void;
  getTVFocusProps: (id: string) => {style?: StyleProp<ViewStyle>};
  nextFocusDown?: number;
  nextFocusUp?: number;
  onEntryHandle?: (handle: number | null) => void;
};

export default function PlayerControlBar({
  ids,
  controls,
  top,
  compact,
  appearance = defaultPlayerControlStyle(),
  onEdit,
  getTVFocusProps,
  nextFocusDown,
  nextFocusUp,
  onEntryHandle,
}: Props) {
  const entryRef = useCallback(
    (node: View | React.ElementRef<typeof TouchableOpacity> | null) => {
      onEntryHandle?.(findNodeHandle(node));
    },
    [onEntryHandle],
  );
  const visible = ids
    .map(id => controls.find(control => control.id === id))
    .filter((control): control is PlayerControl => Boolean(control?.visible));
  const children = visible.map((control, index) => {
    const focusProps = getTVFocusProps(control.id);
    return (
      <Button
        key={control.id}
        ref={isTV && index === 0 ? entryRef : undefined}
        {...focusProps}
        nextFocusDown={isTV ? nextFocusDown : undefined}
        nextFocusUp={isTV ? nextFocusUp : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${control.title}, ${control.label}`}
        accessibilityHint="Hold to edit player controls"
        onPress={control.onPress}
        onLongPress={onEdit}
        delayLongPress={500}
        style={[
          focusProps.style,
          top && {...topControlPillStyle(appearance.scale), width: 24 * appearance.scale + 8},
          !top && {
            minHeight: Math.max(44, 44 * appearance.scale),
            flexShrink: 0,
          },
        ]}
        className={
          top
            ? 'p-2 items-center justify-center rounded-full'
            : 'flex-row items-center justify-center gap-1 px-1 py-1'
        }>
        <PlayerControlIcon control={control} size={24 * appearance.scale} />
        {!top && appearance.labels !== 'hidden' && (
          <Text
            numberOfLines={1}
            style={{
              color: PLAYER_CONTROL_COLOR,
              fontSize: 12 * appearance.scale,
              fontWeight: '300',
              flexShrink: 0,
            }}>
            {appearance.labels === 'short'
              ? control.shortLabel || control.label
              : control.label}
          </Text>
        )}
      </Button>
    );
  });
  const backgroundStyle = {
    backgroundColor: `rgba(0,0,0,${appearance.backgroundOpacity})`,
    overflow: 'hidden' as const,
    borderRadius: 28 * appearance.scale,
  };
  if (top)
    return (
      <View testID="player-top-control-row" collapsable={false}
        style={[{flexDirection: 'row', alignItems: 'center', gap: 20 * appearance.scale, paddingHorizontal: BOTTOM_EDGE_PADDING}, backgroundStyle,
          {height: 40 * appearance.scale, borderRadius: 20 * appearance.scale}, isTV && {overflow: 'visible'}]}>
        {children}
      </View>
    );
  return (
    <View
      testID="player-control-row-background"
      style={[backgroundStyle, compact ? {maxWidth: '100%'} : {width: '100%'}]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        bounces={false}
        style={compact ? {flexGrow: 0} : {width: '100%'}}
        contentContainerStyle={{
          alignItems: 'center',
          justifyContent:
            compact || appearance.alignment === 'left'
              ? 'flex-start'
              : appearance.alignment === 'right'
                ? 'flex-end'
                : appearance.alignment === 'center' || visible.length === 1
                  ? 'center'
                  : 'space-between',
          flexGrow: compact ? undefined : 1,
          minWidth: compact ? undefined : '100%',
        }}>
        <View
          testID="player-control-row"
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              flexShrink: 0,
              flexGrow: !compact && appearance.alignment === 'distributed' ? 1 : 0,
              justifyContent: visible.length === 1 ? 'center' : 'space-between',
              columnGap: 20 * appearance.scale,
              paddingHorizontal: BOTTOM_EDGE_PADDING,
            },
          ]}>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}


type BottomBarProps = Omit<Props, 'ids' | 'top' | 'compact'> & {
  left: PlayerControlId[];
  right: PlayerControlId[];
};

const SPLIT_ALIGNMENT: Record<
  PlayerControlStyle['alignment'],
  ViewStyle['justifyContent']
> = {
  distributed: 'space-between',
  center: 'center',
  left: 'flex-start',
  right: 'flex-end',
};

export function PlayerBottomControlBar({left, right, ...props}: BottomBarProps) {
  const hasVisibleControls = (ids: PlayerControlId[]) =>
    props.controls.some(control => control.visible && ids.includes(control.id));
  const leftVisible = hasVisibleControls(left);
  const rightVisible = hasVisibleControls(right);

  if (!leftVisible && !rightVisible) return null;
  const rightAppearance = props.appearance && {
    ...props.appearance,
    labels: props.appearance.rightLabels,
  };
  if (!leftVisible || !rightVisible) {
    return leftVisible
      ? <PlayerControlBar {...props} ids={left} />
      : <PlayerControlBar {...props} ids={right} appearance={rightAppearance} />;
  }

  const alignment = props.appearance?.alignment ?? 'distributed';
  return (
    <View
      testID="player-split-bottom-controls"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: SPLIT_ALIGNMENT[alignment],
        gap: 12,
        width: '100%',
      }}>
      <View style={{flexShrink: 1, minWidth: 0}}>
        <PlayerControlBar {...props} ids={left} compact />
      </View>
      <View style={{flexShrink: 1, minWidth: 0}}>
        <PlayerControlBar {...props} ids={right} appearance={rightAppearance} compact onEntryHandle={undefined} />
      </View>
    </View>
  );
}
