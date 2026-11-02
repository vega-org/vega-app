import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ScrollView, StyleSheet, Text, TouchableOpacity} from 'react-native';
import type {PlayerControlId} from '../src/lib/player/controlLayout';
import PlayerControlBar, {
  PlayerControl,
} from '../src/components/PlayerControlBar';
import {normalizePlayerControlStyle, defaultPlayerControlStyle} from '../src/lib/player/controlStyle';

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@expo/vector-icons/MaterialIcons', () => 'Icon');
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
let mockIsTV = false;
jest.mock('../src/lib/tv/constants', () => ({get isTV() { return mockIsTV; }}));
beforeEach(() => { mockIsTV = false; });

const controls: PlayerControl[] = [
  {
    id: 'speed',
    title: 'Speed',
    label: '1.5x',
    icon: 'speedometer',
    visible: true,
    onPress: jest.fn(),
  },
  {
    id: 'sleep',
    title: 'Sleep',
    label: '25m',
    icon: 'power-sleep',
    visible: true,
    onPress: jest.fn(),
  },
  {
    id: 'cast',
    title: 'Cast',
    label: 'Cast',
    icon: 'cast',
    visible: false,
    onPress: jest.fn(),
  },
];

it('shows decoder mode in the icon slot and switches on press', () => {
  const change = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  const decoder: PlayerControl = {id: 'decoder', title: 'Video decoder', label: 'Decoder', shortLabel: 'Decoder', icon: 'memory', iconText: 'SW', visible: true, onPress: change};
  act(() => {tree = renderer.create(<PlayerControlBar top ids={['decoder']} controls={[decoder]} onEdit={jest.fn()} getTVFocusProps={() => ({})} />);});
  expect(tree.root.findByType(Text).props.children).toBe('SW');
  act(() => tree.root.findByType(TouchableOpacity).props.onPress());
  expect(change).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('shows only icons on top and preserves status labels on the bottom', () => {
  let tree!: renderer.ReactTestRenderer;
  const props = {
    ids: ['speed', 'sleep', 'cast'] as const,
    controls,
    onEdit: jest.fn(),
    getTVFocusProps: () => ({}),
  };
  act(() => {
    tree = renderer.create(
      <PlayerControlBar {...props} ids={[...props.ids]} top />,
    );
  });
  expect(tree.root.findAllByType(Text)).toHaveLength(0);
  expect(
    tree.root.findAllByProps({accessibilityLabel: 'Cast, Cast'}),
  ).toHaveLength(0);
  act(() =>
    tree.update(
      <PlayerControlBar {...props} ids={[...props.ids]} />,
    ),
  );
  expect(
    tree.root.findAllByType(Text).map(node => node.props.children),
  ).toEqual(['1.5x', '25m']);
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.horizontal).toBe(true);
  expect(scroll.props.showsHorizontalScrollIndicator).toBe(false);
  act(() => tree.unmount());
});

it('provides a long-press editor entry without attaching drag gestures during playback', () => {
  const onEdit = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PlayerControlBar
        ids={['speed']}
        controls={controls}
        top
        onEdit={onEdit}
        getTVFocusProps={() => ({})}
      />,
    );
  });
  act(() =>
    tree.root
      .findAllByProps({accessibilityLabel: 'Speed, 1.5x'})[0]
      .props.onLongPress(),
  );
  expect(onEdit).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('uses content-sized controls with even gaps and matching end padding', () => {
  const ids: PlayerControlId[] = ['pip', 'resize', 'episodes', 'sleep', 'cast', 'lock'];
  const items: PlayerControl[] = ids.map(id => ({id, title: id, label: id, icon: 'cast', visible: true, onPress: jest.fn()}));
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<PlayerControlBar ids={ids} controls={items} onEdit={() => {}} getTVFocusProps={() => ({})} />); });
  const buttons = tree.root.findAllByType(TouchableOpacity);
  expect(buttons).toHaveLength(6);
  for (const button of buttons) {
    const style = StyleSheet.flatten(button.props.style);
    expect(style.width).toBeUndefined();
    expect(style.justifyContent).toBeUndefined();
    expect(style.flexShrink).toBe(0);
  }
  const scroll = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(tree.root.findByProps({testID: 'player-control-row'}).props.style)).toEqual(expect.objectContaining({justifyContent: 'space-between', columnGap: 20, paddingHorizontal: 12, flexGrow: 1}));
  expect(scroll.props.onScroll).toBeUndefined();
  act(() => tree.update(<PlayerControlBar ids={['sleep']} controls={items} onEdit={() => {}} getTVFocusProps={() => ({})} />));
  expect(tree.root.findByType(ScrollView).props.contentContainerStyle.justifyContent).toBe('center');
  act(() => tree.unmount());
});

it('supports short and hidden labels, all alignments, scaling and a transparent background by default', () => {
  const items: PlayerControl[] = [{...controls[0], id: 'audio', label: 'Japanese', shortLabel: 'Ja'}];
  let tree!: renderer.ReactTestRenderer;
  const render = (labels: 'full' | 'short' | 'hidden', alignment: 'distributed' | 'center' | 'left' | 'right') =>
    <PlayerControlBar ids={['audio']} controls={items} onEdit={() => {}} getTVFocusProps={() => ({})}
      appearance={{...defaultPlayerControlStyle(), labels, alignment, scale: 1.2, backgroundOpacity: 0.5}} />;
  act(() => {tree = renderer.create(render('short', 'left'));});
  expect(tree.root.findByType(Text).props.children).toBe('Ja');
  expect(tree.root.findByType(Text).props.style.fontSize).toBeCloseTo(14.4);
  expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.style).backgroundColor).toBeUndefined();
  const rowStyle = () => StyleSheet.flatten(tree.root.findByProps({testID: 'player-control-row'}).props.style);
  const viewport = tree.root.findByProps({testID: 'player-control-row-background'});
  expect(StyleSheet.flatten(viewport.props.style)).toEqual(expect.objectContaining({
    backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden', borderRadius: 33.6,
  }));
  expect(rowStyle().backgroundColor).toBeUndefined();
  expect(rowStyle().flexGrow).toBe(0);
  expect(rowStyle().width).toBeUndefined();
  expect(tree.root.findByType(ScrollView).props.contentContainerStyle.justifyContent).toBe('flex-start');
  act(() => tree.update(render('full', 'right')));
  expect(tree.root.findByType(Text).props.children).toBe('Japanese');
  expect(tree.root.findByType(ScrollView).props.contentContainerStyle.justifyContent).toBe('flex-end');
  expect(rowStyle().flexGrow).toBe(0);
  act(() => tree.update(render('hidden', 'center')));
  expect(tree.root.findAllByType(Text)).toHaveLength(0);
  expect(tree.root.findByType(ScrollView).props.contentContainerStyle.justifyContent).toBe('center');
  act(() => tree.unmount());
});


it('ignores obsolete saved blur settings and keeps the chosen tint', () => {
  const appearance = normalizePlayerControlStyle({backgroundBlur: 100, backgroundOpacity: 0.4});
  expect(appearance).not.toHaveProperty('backgroundBlur');
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<PlayerControlBar ids={['speed']} controls={controls}
    onEdit={() => {}} getTVFocusProps={() => ({})} appearance={appearance} />);});
  const viewport = tree.root.findByProps({testID: 'player-control-row-background'});
  expect(StyleSheet.flatten(viewport.props.style).backgroundColor).toBe('rgba(0,0,0,0.4)');
  act(() => tree.unmount());
});

it.each([false, true])('preserves the full top focus border for TV=%s without changing phone clipping', tv => {
  mockIsTV = tv;
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<PlayerControlBar top ids={['sleep', 'speed']} controls={controls}
    appearance={{...defaultPlayerControlStyle(), backgroundOpacity: 0.5}}
    onEdit={() => {}} getTVFocusProps={() => ({style: {borderWidth: 2.5, borderColor: '#fff'}})} />);});
  const row = tree.root.findByProps({testID: 'player-top-control-row'});
  expect(StyleSheet.flatten(row.props.style).overflow).toBe(tv ? 'visible' : 'hidden');
  expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe('rgba(0,0,0,0.5)');
  for (const button of tree.root.findAllByType(TouchableOpacity)) {
    expect(StyleSheet.flatten(button.props.style).borderWidth).toBe(2.5);
  }
  act(() => tree.unmount());
});
