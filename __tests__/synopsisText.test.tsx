import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import SynopsisText from '../src/screens/home/components/SynopsisText';
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({primary: '#fff', onSurfaceVariant: '#aaa'}),
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/components/tv', () => ({TVFocusable: 'TVFocusable'}));

it('renders a pressable inline link before any layout events and expands the complete synopsis', () => {
  const synopsis = 'A long synopsis. '.repeat(30);
  const toggle = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<SynopsisText synopsis={synopsis} expanded={false} onToggle={toggle} />);});
  const link = tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'button')!;
  expect(link.props.children).toBe(' Read more');
  act(() => link.props.onPress());
  expect(toggle).toHaveBeenCalledTimes(1);
  act(() => tree.update(<SynopsisText synopsis={synopsis} expanded onToggle={toggle} />));
  expect(tree.root.findAllByType(Text)[0].props.children[0]).toBe(synopsis);
  expect(JSON.stringify(tree.toJSON())).toContain(' Show less');
});

it('does not offer expansion for a short synopsis', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<SynopsisText synopsis="Short synopsis" expanded={false} onToggle={jest.fn()} />);});
  expect(tree.root.findAllByType(Text).some(node => node.props.accessibilityRole === 'button')).toBe(false);
});
