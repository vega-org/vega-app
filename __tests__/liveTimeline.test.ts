import {playbackTimeline, clampTimelineSeek, liveTimeLabel} from '../src/lib/player/liveTimeline';

describe('live playback timeline', () => {
  it('preserves finite VOD timelines', () => {
    const timeline = playbackTimeline({}, 120);
    expect(timeline).toEqual({isLive: false, canSeek: true, duration: 120, liveEdge: 120});
    expect(clampTimelineSeek(200, timeline)).toBe(120);
  });

  it('uses the latest DVR window instead of the initial load duration', () => {
    const first = playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 120, liveEdge: 110}, 900);
    const latest = playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 60, liveEdge: 50}, 900);
    expect(first.duration).toBe(120);
    expect(latest.duration).toBe(60);
    expect(clampTimelineSeek(110, latest)).toBe(60);
    expect(clampTimelineSeek(-20, latest)).toBe(0);
  });

  it('disables seeking when native playback has no DVR support', () => {
    const timeline = playbackTimeline({isLive: true, isSeekable: false, seekableDuration: 120});
    expect(clampTimelineSeek(30, timeline)).toBeUndefined();
    expect(liveTimeLabel(0, timeline)).toBe('LIVE');
  });

  it('does not infer DVR support from duration alone', () => {
    expect(playbackTimeline({isLive: true, seekableDuration: 120}).canSeek).toBe(false);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, undefined])('ignores invalid live duration %s', duration => {
    const timeline = playbackTimeline({isLive: true, isSeekable: true, seekableDuration: duration});
    expect(timeline.duration).toBe(0);
    expect(timeline.canSeek).toBe(false);
  });

  it('shows delay relative to the live target, including at the live edge', () => {
    const timeline = playbackTimeline({isLive: true, isSeekable: true, seekableDuration: 300, liveEdge: 290});
    expect(liveTimeLabel(200, timeline)).toBe('-1:30');
    expect(liveTimeLabel(285, timeline)).toBe('LIVE');
    expect(liveTimeLabel(299, timeline)).toBe('LIVE');
    expect(timeline.liveEdge).toBe(290);
  });

  it('keeps the live target within the current window', () => {
    expect(playbackTimeline({isLive: true, seekableDuration: 100, liveEdge: 200}).liveEdge).toBe(100);
    expect(playbackTimeline({isLive: true, seekableDuration: 100, liveEdge: 0}).liveEdge).toBe(0);
  });

  it('does not carry live state into a subsequent VOD source', () => {
    expect(playbackTimeline({}, 60)).toEqual({isLive: false, canSeek: true, duration: 60, liveEdge: 60});
  });

  it.each([NaN, Infinity, -Infinity])('ignores invalid seek %s', time => {
    expect(clampTimelineSeek(time, playbackTimeline({}, 100))).toBeUndefined();
  });
});
