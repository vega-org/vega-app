import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {usePanResponders} from '../src/components/media-console/hooks/usePanResponders';

jest.mock('react-native', () => ({
  PanResponder: {create: (handlers: unknown) => ({panHandlers: handlers})},
}), {virtual: true});

const seek = jest.fn();
const onEnd = jest.fn();
let handlers: any;

function Harness({isLive, duration}: {isLive: boolean; duration: number}) {
  const responders = usePanResponders({
    isLive, duration, volumeOffset: 0, loading: false,
    seekerWidth: 100, seekerPosition: 50, seek,
    clearControlTimeout: jest.fn(), setVolumePosition: jest.fn(),
    setSeekerPosition: jest.fn(), setSeeking: jest.fn(),
    setSeekSnapPosition: jest.fn(), setControlTimeout: jest.fn(), onEnd,
  });
  handlers = responders.seekPanResponder.panHandlers;
  return null;
}

describe('live seekbar gestures', () => {
  beforeEach(() => { seek.mockClear(); onEnd.mockClear(); });

  it('does not claim scrubbing gestures without a seekable window', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Harness, {isLive: true, duration: 0})); });
    expect(handlers.onStartShouldSetPanResponder()).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder()).toBe(false);
    act(() => tree.unmount());
  });

  it.each([true, false])('reaching the right edge only ends VOD (live=%s)', isLive => {
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Harness, {isLive, duration: 120})); });
    act(() => handlers.onPanResponderGrant({nativeEvent: {locationX: 100, pageX: 100}}));
    act(() => handlers.onPanResponderRelease());
    expect(seek).toHaveBeenCalledWith(120);
    expect(onEnd).toHaveBeenCalledTimes(isLive ? 0 : 1);
    act(() => tree.unmount());
  });

  it('uses a refreshed window if it changes during a drag', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Harness, {isLive: true, duration: 120})); });
    act(() => handlers.onPanResponderGrant({nativeEvent: {locationX: 100, pageX: 100}}));
    act(() => tree.update(React.createElement(Harness, {isLive: true, duration: 60})));
    act(() => handlers.onPanResponderRelease());
    expect(seek).toHaveBeenLastCalledWith(60);
    expect(onEnd).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
