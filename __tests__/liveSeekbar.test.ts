import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Seekbar} from '../src/components/media-console/components/Seekbar/Seekbar';
import {playbackTimeline} from '../src/lib/player/liveTimeline';

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', View: 'View', Image: 'Image',
  Pressable: 'Pressable', Text: 'Text', Platform: {isTV: false},
  StyleSheet: {create: (styles: unknown) => styles},
}), {virtual: true});

const props = {
  seekerFillWidth: 20, seekerPosition: 20, seekColor: '#fff', cachedPosition: 30,
  seekerPanHandlers: {onStartShouldSetResponder: jest.fn()},
  setSeekerWidth: jest.fn(), duration: 120, time: 20,
  showDuration: false, showTimeRemaining: false, showHours: false,
  toggleTimer: jest.fn(), resetControlTimeout: jest.fn(), seeking: false,
  previewTime: 20, thumbnailUri: null, thumbnailLoading: false, snapPosition: null,
};

describe('live seekbar controls', () => {
  it('keeps live status out of the seekbar and disables the track without DVR', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Seekbar, {
      ...props, timeline: playbackTimeline({isLive: true, isSeekable: false, seekableDuration: 120}),
    })); });
    const labels = tree!.root.findAllByType('Text' as any).map(node => node.props.children);
    expect(labels).toEqual([]);
    expect(tree!.root.findAllByType('Pressable' as any)).toHaveLength(0);
    const track = tree!.root.findAllByType('View' as any).find(node => node.props.collapsable === false)!;
    expect(track.props.pointerEvents).toBe('none');
    expect(track.props.onStartShouldSetResponder).toBeUndefined();
    act(() => tree.unmount());
  });

  it('keeps DVR seeking available without duplicate live labels or timer actions', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(Seekbar, {
      ...props,
      timeline: playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 120, liveEdge: 110}),
    })); });
    expect(tree!.root.findAllByType('Text' as any)).toHaveLength(0);
    expect(tree!.root.findAllByType('Pressable' as any)).toHaveLength(0);
    const track = tree!.root.findAllByType('View' as any).find(node => node.props.collapsable === false)!;
    expect(track.props.pointerEvents).toBe('auto');
    act(() => tree.unmount());
  });
});
