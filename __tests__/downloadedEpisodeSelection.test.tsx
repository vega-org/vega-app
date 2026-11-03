import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useTVRemote} from '../src/lib/tv/useTVRemote';
import DownloadedEpisodeRow from '../src/screens/downloads/components/DownloadedEpisodeRow';

jest.mock('@react-navigation/native', () => ({NavigationContext: require('react').createContext(null)}));
jest.mock('../src/lib/tv', () => ({isTV: true}));
jest.mock('../src/lib/tv/useTVRemote', () => ({useTVRemote: jest.fn()}));
jest.mock('../src/components/EpisodeRowContent', () => 'EpisodeRowContent');
jest.mock('../src/components/tv', () => ({TVFocusable: 'TVFocusable'}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Icon');
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({primary: '#123456'})}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({useTVFocusBorderColor: () => '#ffffff'}));
jest.mock('../src/lib/downloadThumbnailCache', () => ({getDownloadedVideoThumbnail: jest.fn(async () => null)}));
const item = {id: 'ep1', title: 'Episode 1', filePath: 'file:///episode.mkv', totalBytes: 100} as any;

it('starts selection on hold without starting playback', async () => {
  const onPlay = jest.fn(); const onStartSelection = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<DownloadedEpisodeRow item={item} isDeleting={false} onPlay={onPlay} onDelete={jest.fn()} onStartSelection={onStartSelection} />);});
  act(() => tree.root.findByProps({accessibilityLabel: 'Play Episode 1'}).props.onLongPress());
  expect(onStartSelection).toHaveBeenCalledWith(item);
  expect(onPlay).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
it('taps toggle selection and hide individual delete controls during selection', async () => {
  const onPlay = jest.fn(); const onToggleSelection = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<DownloadedEpisodeRow item={item} isDeleting={false} selecting selected onPlay={onPlay} onDelete={jest.fn()} onToggleSelection={onToggleSelection} />);});
  act(() => tree.root.findByProps({accessibilityLabel: 'Select Episode 1'}).props.onPress());
  expect(onToggleSelection).toHaveBeenCalledWith(item);
  expect(onPlay).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({accessibilityLabel: 'Delete Episode 1'})).toHaveLength(0);
  act(() => tree.unmount());
});

it('handles a focused TV remote hold once and ignores the release press', async () => {
  const onPlay = jest.fn(); const onStartSelection = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<DownloadedEpisodeRow item={item} isDeleting={false} onPlay={onPlay} onDelete={jest.fn()} onStartSelection={onStartSelection} />);});
  const control = () => tree.root.findByProps({accessibilityLabel: 'Play Episode 1'});
  act(() => control().props.onFocus());
  const remoteCalls = (useTVRemote as jest.Mock).mock.calls;
  const [handleRemote, enabled] = remoteCalls[remoteCalls.length - 1];
  expect(enabled).toBe(true);
  act(() => {handleRemote({eventType: 'longSelect', eventKeyAction: 1}); control().props.onLongPress(); control().props.onPress();});
  expect(onStartSelection).toHaveBeenCalledTimes(1);
  expect(onPlay).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
