import React from 'react';
import renderer, {act} from 'react-test-renderer';
import * as RN from 'react-native';
import HdrBadge from '../src/components/media-console/components/HdrBadge';
import {hdrIconWidth} from '../src/components/media-console/components/HdrFormatIcon';

jest.mock('../src/components/tv', () => ({TVFocusable: 'FocusButton', TVFocusGuide: 'FocusGuide'}));
let query: jest.Mock;
const props = {videoView: {current: {} as RN.View}, source: 'movie', suspended: false, scale: 1, onInteract: jest.fn()};
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(RN.Platform, 'OS', {value: 'android', configurable: true});
  RN.AppState.currentState = 'active';
  jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(42);
  jest.spyOn(RN.AppState, 'addEventListener').mockReturnValue({remove: jest.fn()});
  query = jest.fn().mockResolvedValue(null);
  RN.NativeModules.AmbientVideo = {hdrStatus: query};
});
afterEach(() => {jest.restoreAllMocks(); jest.useRealTimers(); delete RN.NativeModules.AmbientVideo;});

it('shows no badge without confirmed HDR output and opens details when confirmed', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  expect(tree.root.findAllByProps({accessibilityLabel: 'HDR playback details'})).toHaveLength(0);
  query.mockResolvedValue({type: 'HDR10 / PQ', codec: 'video/hevc', resolution: '3840 × 2160', transfer: 'PQ', colorSpace: 'BT.2020', headroom: 3, displayTypes: 'HDR10', maxCllNits: 1000});
  await act(async () => {jest.advanceTimersByTime(2500); await Promise.resolve();});
  expect(tree.root.findAllByProps({type: 'HDR10 / PQ', height: 32 / hdrIconWidth('HDR10 / PQ', 1)}).length).toBeGreaterThan(0);
  expect(tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.style).toEqual(expect.objectContaining({width: 56, height: 40}));
  act(() => tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.onPress());
  expect(tree.root.findAllByType(RN.Modal)).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Video peak: ');
  expect(JSON.stringify(tree.toJSON())).toContain('metadata, MaxCLL');
  act(() => tree.root.findByProps({accessibilityLabel: 'Close HDR details'}).props.onPress());
  expect(tree.root.findAllByType(RN.Modal)).toHaveLength(0);
  act(() => tree.unmount());
});

it.each([undefined, 0, -1, NaN, Infinity, 65535])('hides missing or invalid video peak metadata (%s)', async maxCllNits => {
  query.mockResolvedValue({type: 'HDR', codec: 'video/hevc', resolution: '1920 × 1080', transfer: 'PQ', colorSpace: 'BT.2020', headroom: 2, displayTypes: 'HDR10', maxCllNits});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  act(() => tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.onPress());
  expect(JSON.stringify(tree.toJSON())).not.toContain('Video peak: ');
  act(() => tree.unmount());
});

it('preserves the cropped symbol aspect ratios and reserves the wider Dolby badge', () => {
  expect(hdrIconWidth('HDR10 / PQ', 20)).toBeCloseTo(20 * 162 / 60);
  expect(hdrIconWidth('HLG', 20)).toBeCloseTo(20 * 152 / 62);
  expect(hdrIconWidth('Dolby Vision', 20)).toBeCloseTo(20 * 298 / 80);
});

it('gives Dolby Vision enough width while keeping the control row height', async () => {
  query.mockResolvedValue({type: 'Dolby Vision', codec: 'video/dolby-vision', resolution: '1920 × 1080', transfer: 'Dolby Vision', colorSpace: 'Not reported', headroom: 2, displayTypes: 'Dolby Vision'});
  const onWidthChange = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} onWidthChange={onWidthChange} />);});
  expect(tree.root.findAllByProps({type: 'Dolby Vision', height: 14}).length).toBeGreaterThan(0);
  const style = tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.style;
  expect(style.height).toBe(40);
  expect(style.width).toBeCloseTo(hdrIconWidth('Dolby Vision', 16) + 16);
  expect(onWidthChange).toHaveBeenLastCalledWith(style.width + 12);
  act(() => tree.unmount());
});

it('ignores stale native replies after playback is suspended', async () => {
  let finish!: (result: unknown) => void;
  query.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<HdrBadge {...props} />);});
  act(() => tree.update(<HdrBadge {...props} suspended />));
  await act(async () => {finish({type: 'HDR10'}); await Promise.resolve();});
  expect(tree.root.findAllByProps({accessibilityLabel: 'HDR playback details'})).toHaveLength(0);
  await act(async () => {jest.advanceTimersByTime(10000);});
  expect(query).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

const confirmedHdr = {type: 'HDR', codec: 'video/hevc', resolution: '1920 × 1080', transfer: 'PQ', colorSpace: 'BT.2020', headroom: 2, displayTypes: 'HDR10'};
const badgeCount = (tree: renderer.ReactTestRenderer) => tree.root.findAllByProps({accessibilityLabel: 'HDR playback details'}).length;
const poll = async () => { await act(async () => {jest.advanceTimersByTime(2500); await Promise.resolve();}); };

it('keeps confirmed HDR across a single missing sample, but clears sustained loss', async () => {
  query.mockResolvedValue(confirmedHdr);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  query.mockResolvedValueOnce(null).mockResolvedValue(confirmedHdr);
  await poll();
  expect(badgeCount(tree)).toBe(1);
  await poll();
  expect(badgeCount(tree)).toBe(1);
  query.mockResolvedValue(null);
  await poll();
  expect(badgeCount(tree)).toBe(1);
  await poll();
  expect(badgeCount(tree)).toBe(0);
  act(() => tree.unmount());
});

it('preserves confirmed HDR while polling is suspended and resumes without flashing', async () => {
  query.mockResolvedValue(confirmedHdr);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  act(() => tree.update(<HdrBadge {...props} suspended />));
  expect(badgeCount(tree)).toBe(1);
  const calls = query.mock.calls.length;
  await poll();
  expect(query).toHaveBeenCalledTimes(calls);
  query.mockResolvedValueOnce(null).mockResolvedValue(confirmedHdr);
  await act(async () => {tree.update(<HdrBadge {...props} />);});
  expect(badgeCount(tree)).toBe(1);
  await poll();
  expect(badgeCount(tree)).toBe(1);
  act(() => tree.unmount());
});

it('clears the previous video badge immediately when the source changes', async () => {
  query.mockResolvedValue(confirmedHdr);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  expect(badgeCount(tree)).toBe(1);
  query.mockResolvedValue(null);
  await act(async () => {tree.update(<HdrBadge {...props} source="sdr-video" />);});
  expect(badgeCount(tree)).toBe(0);
  act(() => tree.unmount());
});

it('tolerates one failed native query without latching through repeated failures', async () => {
  query.mockResolvedValue(confirmedHdr);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  query.mockRejectedValue(new Error('Surface unavailable'));
  await poll();
  expect(badgeCount(tree)).toBe(1);
  await poll();
  expect(badgeCount(tree)).toBe(0);
  act(() => tree.unmount());
});
it.each([1, undefined])('shows Dolby details without brightness commentary when ratio is %s', async headroom => {
  query.mockResolvedValue({type: 'Dolby Vision', codec: 'video/dolby-vision', resolution: '3840 × 2160',
    transfer: 'Dolby Vision', colorSpace: 'Managed by Dolby Vision decoder', headroom,
    displayTypes: 'Dolby Vision'});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  act(() => tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.onPress());
  expect(JSON.stringify(tree.toJSON())).not.toContain('does not confirm its display headroom');
  expect(JSON.stringify(tree.toJSON())).toContain('HDR/SDR brightness ratio');
  if (headroom === undefined) expect(JSON.stringify(tree.toJSON())).toContain('Not reported');
  act(() => tree.unmount());
});
it.each(['HDR', 'HLG'])('keeps the %s badge with a reported ratio of one', async type => {
  query.mockResolvedValue({...confirmedHdr, type, headroom: 1});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} />);});
  act(() => tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.onPress());
  expect(JSON.stringify(tree.toJSON())).not.toContain('does not measure the video');
  expect(JSON.stringify(tree.toJSON())).toContain('1.00');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Dolby Vision hardware output is active');
  act(() => tree.unmount());
});

it.each(['HDR', 'HLG', 'Dolby Vision'])('scales the entire %s pill and its title inset proportionally', async type => {
  query.mockResolvedValue({...confirmedHdr, type});
  const inset = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {tree = renderer.create(<HdrBadge {...props} onWidthChange={inset} />);});
  const normal = tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.style;
  await act(async () => {tree.update(<HdrBadge {...props} scale={0.75} onWidthChange={inset} />);});
  const small = tree.root.findByProps({accessibilityLabel: 'HDR playback details'}).props.style;
  expect(small.width).toBeCloseTo(normal.width * 0.75);
  expect(small.height).toBeCloseTo(normal.height * 0.75);
  expect(inset).toHaveBeenLastCalledWith(small.width + 12 * 0.75);
  act(() => tree.unmount());
});
