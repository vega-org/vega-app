import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {usePlayerProgress} from '../src/lib/hooks/usePlayerSettings';
import {watchProgressStorage} from '../src/lib/storage';

jest.mock('../src/lib/storage', () => ({watchProgressStorage: {setProgress: jest.fn()}}));

let progress: ReturnType<typeof usePlayerProgress>;
const onSaved = jest.fn();
const Harness = ({link}: {link: string}) => {
  progress = usePlayerProgress({activeEpisode: {link}, onProgressSaved: onSaved});
  return null;
};

beforeEach(() => jest.clearAllMocks());

it('flushes progress below the periodic save threshold on exit', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Harness link="episode-1" />); });
  act(() => progress.handleProgress({currentTime: 3, seekableDuration: 100}));
  expect(onSaved).not.toHaveBeenCalled();
  act(() => tree.unmount());
  expect(watchProgressStorage.setProgress).toHaveBeenCalledWith('episode-1', 3, 100);
  expect(onSaved).toHaveBeenCalledWith(3, 100);
});

it('saves the previous episode and resets position before the next episode', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Harness link="episode-1" />); });
  act(() => progress.handleProgress({currentTime: 100, seekableDuration: 200}));
  act(() => progress.handleProgress({currentTime: 102, seekableDuration: 200}));
  act(() => tree.update(<Harness link="episode-2" />));
  expect(watchProgressStorage.setProgress).toHaveBeenLastCalledWith('episode-1', 102, 200);
  expect(progress.videoPositionRef.current).toEqual({position: 0, duration: 0});
  expect(progress.hasProgressRef.current).toBe(false);
  act(() => progress.handleProgress({currentTime: 8, seekableDuration: 300}));
  expect(watchProgressStorage.setProgress).toHaveBeenLastCalledWith('episode-2', 8, 300);
  act(() => tree.unmount());
});

it('persists a rewind to zero instead of retaining the previous high position', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Harness link="episode-1" />); });
  act(() => progress.handleProgress({currentTime: 100, seekableDuration: 200}));
  act(() => progress.handleProgress({currentTime: 0, seekableDuration: 200}));
  expect(progress.hasProgressRef.current).toBe(true);
  expect(onSaved).toHaveBeenLastCalledWith(0, 200);
  act(() => tree.unmount());
});
