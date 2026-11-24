import React from 'react';
import renderer, {act} from 'react-test-renderer';
import * as RN from 'react-native';
import AmbientBackground from '../src/components/media-console/components/AmbientBackground';

jest.mock('../src/components/media-console/components/NativeAmbientGlow', () => 'NativeAmbientGlow');
const colors = ['#112233', '#334455', '#556677', '#778899'];
const props = {videoView: {current: {} as RN.View}, bars: {top: 80, bottom: 80, left: 0, right: 0}, paused: false, intensity: 0.35, spread: 1, responseMs: 220};
let listener: (state: RN.AppStateStatus) => void;
let nativeSample: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(RN.Platform, 'OS', {value: 'android', configurable: true});
  RN.AppState.currentState = 'active';
  jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(42);
  jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_type, callback) => {
    listener = callback;
    return {remove: jest.fn()};
  });
  jest.spyOn(RN.Animated, 'timing').mockReturnValue({start: jest.fn(), stop: jest.fn(), reset: jest.fn()});
  nativeSample = jest.fn().mockResolvedValue({colors, bars: props.bars, durationMs: 2});
  RN.NativeModules.AmbientVideo = {sample: nativeSample};
});
afterEach(() => {jest.restoreAllMocks(); jest.useRealTimers(); delete RN.NativeModules.AmbientVideo;});
const advance = async (ms: number) => act(async () => {jest.advanceTimersByTime(ms); await Promise.resolve();});

it('samples without overlap and ignores a capture completed after pausing', async () => {
  let finish!: (value: unknown) => void;
  nativeSample.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  await advance(300);
  expect(nativeSample).toHaveBeenCalledWith(42);
  await advance(10000);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  act(() => tree.update(<AmbientBackground {...props} paused />));
  await act(async () => {finish({colors, bars: props.bars, durationMs: 2}); await Promise.resolve();});
  expect(RN.Animated.timing).not.toHaveBeenCalled();
  await advance(10000);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('updates targets every 250ms without resetting a JS opacity animation', async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  await advance(300);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  expect(RN.Animated.timing).not.toHaveBeenCalled();
  expect(tree.root.findByType('NativeAmbientGlow' as any).props.palette).toEqual(colors);
  await advance(249);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(nativeSample).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it('backs off when asynchronous surface capture is slow', async () => {
  let finish!: (result: unknown) => void;
  nativeSample.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  await advance(300);
  await advance(120);
  await act(async () => {finish({colors, bars: props.bars, durationMs: 0}); await Promise.resolve();});
  await advance(359);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(nativeSample).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it('stops background sampling and does not intercept touch or accessibility focus', async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  await advance(300);
  expect(RN.Animated.timing).not.toHaveBeenCalled();
  const root = tree.root.findAllByType(RN.View).find(view => view.props.importantForAccessibility === 'no-hide-descendants')!;
  expect(root.props.pointerEvents).toBe('none');
  act(() => listener('background'));
  await advance(10000);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  expect(tree.toJSON()).toBeNull();
  act(() => tree.unmount());
});

it('does not poll without black bars or intensity, and stops expensive captures', async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} intensity={0} />);});
  await advance(5000);
  expect(nativeSample).not.toHaveBeenCalled();
  nativeSample.mockResolvedValueOnce({bars: {top: 0, bottom: 0, left: 0, right: 0}});
  act(() => tree.update(<AmbientBackground {...props} bars={{top: 0, bottom: 0, left: 0, right: 0}} />));
  await advance(300);
  await advance(5000);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  expect(RN.Animated.timing).not.toHaveBeenCalled();
  nativeSample.mockResolvedValue({colors, bars: props.bars, durationMs: 100});
  act(() => tree.update(<AmbientBackground {...props} />));
  await advance(300);
  await advance(10000);
  expect(nativeSample).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it('draws nothing until native bounds are confirmed and hides stale masks after resizing', async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  expect(Object.values(tree.root.findByType('NativeAmbientGlow' as any).props.bars)).toEqual([0, 0, 0, 0]);
  await advance(300);
  expect(tree.root.findByType('NativeAmbientGlow' as any).props.bars).toEqual(props.bars);
  act(() => tree.update(<AmbientBackground {...props} paused bars={{top: 0, bottom: 0, left: 90, right: 90}} />));
  expect(Object.values(tree.root.findByType('NativeAmbientGlow' as any).props.bars)).toEqual([0, 0, 0, 0]);
  act(() => tree.unmount());
});

it('changes spread and response without restarting captures or changing intensity', async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} />);});
  await advance(300);
  act(() => tree.update(<AmbientBackground {...props} spread={0.25} responseMs={80} />));
  const glow = tree.root.findByType('NativeAmbientGlow' as any);
  expect(glow.props.spread).toBe(0.25);
  expect(glow.props.responseMs).toBe(80);
  expect(glow.props.intensity).toBe(props.intensity);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  await advance(250);
  expect(nativeSample).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it.each([[16, 33], [50, 57], [220, 250], [1000, 1000]])(
  'uses response %ims for native smoothing and %ims between completed captures', async (responseMs, interval) => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {tree = renderer.create(<AmbientBackground {...props} responseMs={responseMs} />);});
    await advance(300);
    expect(tree.root.findByType('NativeAmbientGlow' as any).props.responseMs).toBe(responseMs);
    expect(nativeSample).toHaveBeenCalledTimes(1);
    await advance(interval - 1);
    expect(nativeSample).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(nativeSample).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  },
);

it('overrides the fastest setting when capture is expensive', async () => {
  nativeSample.mockResolvedValue({colors, bars: props.bars, durationMs: 30});
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<AmbientBackground {...props} responseMs={16} />);});
  await advance(300);
  await advance(1499);
  expect(nativeSample).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(nativeSample).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});
