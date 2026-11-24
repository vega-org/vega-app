import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {usePlayerSettings} from '../src/lib/hooks/usePlayerSettings';
import {settingsStorage} from '../src/lib/storage';

jest.mock('../src/lib/storage', () => ({
  cacheStorage: {setString: jest.fn()},
  settingsStorage: {
    getPlaybackSpeed: jest.fn(() => 1.5),
    setPlaybackSpeed: jest.fn(),
    getDefaultResizeMode: jest.fn(() => 'cover'),
  },
  PLAYER_RESIZE_MODES: [
    {mode: 'none', label: 'Fit'},
    {mode: 'cover', label: 'Cover'},
    {mode: 'stretch', label: 'Stretch'},
    {mode: 'contain', label: 'Contain'},
  ],
}));

let settings: ReturnType<typeof usePlayerSettings>;
const Harness = () => {
  settings = usePlayerSettings();
  return null;
};

beforeEach(() => jest.clearAllMocks());

it('starts the player at the saved playback speed', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness />);
  });
  expect(settings.playbackRate).toBe(1.5);
  act(() => tree.unmount());
});

it('saves the speed chosen in the picker', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness />);
  });
  act(() => settings.selectPlaybackRate(1.25));
  expect(settings.playbackRate).toBe(1.25);
  expect(settingsStorage.setPlaybackSpeed).toHaveBeenCalledWith(1.25);
  act(() => tree.unmount());
});

it('does not save temporary rate changes such as the 2x hold', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness />);
  });
  act(() => settings.setPlaybackRate(2));
  expect(settings.playbackRate).toBe(2);
  expect(settingsStorage.setPlaybackSpeed).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('starts with the default video fit and cycles without saving it', () => {
  jest.useFakeTimers();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness />);
  });
  expect(settings.resizeMode).toBe('cover');
  act(() => settings.handleResizeMode());
  expect(settings.resizeMode).toBe('stretch');
  expect(settings.toastMessage).toBe('Resize Mode: Stretch');
  act(() => jest.runOnlyPendingTimers());
  act(() => tree.unmount());
  jest.useRealTimers();
});
