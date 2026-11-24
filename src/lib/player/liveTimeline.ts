export interface LiveTimelineEvent {
  isLive?: boolean;
  isSeekable?: boolean;
  seekableDuration?: number;
  liveEdge?: number;
}

export interface PlaybackTimeline {
  isLive: boolean;
  canSeek: boolean;
  duration: number;
  liveEdge: number;
}

const seconds = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

// Native live positions are relative to the current window, starting at zero.
export function playbackTimeline(event: LiveTimelineEvent, vodDuration = 0): PlaybackTimeline {
  const isLive = event.isLive === true;
  const duration = seconds(isLive ? event.seekableDuration : vodDuration);
  return {
    isLive,
    duration,
    canSeek: duration > 0 && (!isLive || event.isSeekable === true),
    liveEdge: isLive && typeof event.liveEdge === 'number' && Number.isFinite(event.liveEdge)
      ? Math.max(0, Math.min(duration, event.liveEdge)) : duration,
  };
}

export function clampTimelineSeek(time: number, timeline: PlaybackTimeline): number | undefined {
  if (!timeline.canSeek || !Number.isFinite(time)) return undefined;
  return Math.max(0, Math.min(timeline.duration, time));
}

export function liveTimeLabel(time: number, timeline: PlaybackTimeline): string {
  const behind = Math.max(0, Math.round(timeline.liveEdge - time));
  if (!timeline.canSeek || behind <= 5) return 'LIVE';
  const minutes = Math.floor(behind / 60);
  return `-${minutes}:${String(behind % 60).padStart(2, '0')}`;
}
