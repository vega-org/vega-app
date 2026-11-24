import {playbackTimeline, type PlaybackTimeline} from '../src/lib/player/liveTimeline';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {usePlayerTVControls} from '../src/lib/tv/usePlayerTVControls';

let mockSeekInterval = 10;
let mockTimeline: {current: PlaybackTimeline} | undefined;
let mockRemoteHandler: ((event: {eventType: string}) => void) | undefined;

jest.mock('../src/lib/tv/constants', () => ({isTV: true}));
jest.mock('../src/lib/tv/useTVRemote', () => ({
  useTVRemote: (handler: (event: {eventType: string}) => void) => {
    mockRemoteHandler = handler;
  },
}));
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getSeekInterval: () => mockSeekInterval},
}));

const seek = jest.fn();

const Harness = () => {
  usePlayerTVControls({
    playerRef: {current: {seek}},
    timelineRef: mockTimeline,
    videoPositionRef: {current: {position: 100, duration: 1000}},
    showSettings: false,
    setShowSettings: jest.fn(),
    showControls: false,
    setShowControls: jest.fn(),
    primaryColor: '#fff',
  });
  return null;
};

const seekAfterRemoteEvent = (eventType: string) => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(React.createElement(Harness));
  });
  act(() => mockRemoteHandler?.({eventType}));
  act(() => {
    jest.advanceTimersByTime(400);
  });
  act(() => tree.unmount());
};

describe('TV seek interval', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    seek.mockClear();
    mockTimeline = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('seeks by ten seconds by default', () => {
    mockSeekInterval = 10;
    seekAfterRemoteEvent('right');
    expect(seek).toHaveBeenCalledWith(110);
  });

  it('uses the saved seek interval for the D-pad and media keys', () => {
    mockSeekInterval = 85;
    seekAfterRemoteEvent('right');
    expect(seek).toHaveBeenLastCalledWith(185);

    seekAfterRemoteEvent('rewind');
    expect(seek).toHaveBeenLastCalledWith(15);
  });
});

describe('TV live window seeking', () => {
  beforeEach(() => { jest.useFakeTimers(); seek.mockClear(); mockSeekInterval = 10; });
  afterEach(() => { jest.useRealTimers(); mockTimeline = undefined; });

  it('ignores media and D-pad seeks without DVR', () => {
    mockTimeline = {current: playbackTimeline({isLive: true, isSeekable: false, seekableDuration: 120})};
    seekAfterRemoteEvent('right');
    seekAfterRemoteEvent('rewind');
    expect(seek).not.toHaveBeenCalled();
  });

  it('clamps DVR seeks to the current window', () => {
    mockTimeline = {current: playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 105})};
    seekAfterRemoteEvent('right');
    expect(seek).toHaveBeenLastCalledWith(105);
  });

  it('rechecks the window when a delayed remote seek lands', () => {
    mockTimeline = {current: playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 120})};
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Harness)); });
    act(() => mockRemoteHandler?.({eventType: 'right'}));
    mockTimeline.current = playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 90});
    act(() => jest.advanceTimersByTime(400));
    expect(seek).toHaveBeenLastCalledWith(90);
    act(() => tree.unmount());
  });

  it('cancels a pending seek if the stream becomes unseekable', () => {
    mockTimeline = {current: playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 120})};
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Harness)); });
    act(() => mockRemoteHandler?.({eventType: 'right'}));
    mockTimeline.current = playbackTimeline({isLive: true, isSeekable: false, seekableDuration: 120});
    act(() => jest.advanceTimersByTime(400));
    expect(seek).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
