import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Pressable} from 'react-native';
import RemovableSubtitleRow from '../src/components/RemovableSubtitleRow';
import {TVFocusable} from '../src/components/tv';

jest.mock('@expo/vector-icons/MaterialIcons', () => 'Icon');
jest.mock('../src/components/tv', () => ({TVFocusable: 'FocusButton'}));

it('offers an independent, accessible remove button without selecting the subtitle', () => {
  const select = jest.fn(), remove = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<RemovableSubtitleRow title="English" onRemove={remove}>
    <Pressable onPress={select} />
  </RemovableSubtitleRow>);});
  const button = tree.root.findByType(TVFocusable);
  expect(button.props.accessibilityLabel).toBe('Remove subtitle English');
  act(() => button.props.onPress());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('does not show a remove action for embedded or provider tracks', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<RemovableSubtitleRow title="English"><Pressable /></RemovableSubtitleRow>);});
  expect(tree.root.findAllByType(TVFocusable)).toHaveLength(0);
  act(() => tree.unmount());
});
