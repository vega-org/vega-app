export type RemoteDeviceType = 'cast' | 'dlna' | 'vega-cast';

export interface RemoteDevice {
  id: string;
  name: string;
  type: RemoteDeviceType;
  host?: string;
  port?: number;
  model?: string;
  manufacturer?: string;
  controlUrl?: string;
  renderingControlUrl?: string;
  icon?: string;
}

export type RemotePlaybackStatus =
  | 'idle'
  | 'connecting'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'error';

export interface RemoteAudioTrack {
  id: string;
  index: number;
  language: string;
  title?: string;
  codec?: string;
  channels?: number;
  isSelected?: boolean;
}

export interface RemoteSubtitleTrack {
  savedSubtitleId?: string;
  id: string;
  index?: number;
  language: string;
  title?: string;
  uri?: string;
  isEmbedded?: boolean;
  isSelected?: boolean;
}

export interface RemoteQuality {
  id: string;
  label: string;
  resolution?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  isSelected?: boolean;
}

export interface RemoteServer {
  id: string;
  name: string;
  quality?: string;
  tags?: string[];
  link: string;
  isSelected?: boolean;
}

export interface RemotePlaybackState {
  device: RemoteDevice | null;
  status: RemotePlaybackStatus;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  activeAudioTrackId?: string;
  activeSubtitleTrackId?: string;
  activeQualityId?: string;
  activeServerId?: string;
  audioTracks: RemoteAudioTrack[];
  subtitleTracks: RemoteSubtitleTrack[];
  qualities: RemoteQuality[];
  servers: RemoteServer[];
  errorMessage?: string;
}

export interface RemoteCapabilities {
  canSeek: boolean;
  canChangeSpeed: boolean;
  canChangeVolume: boolean;
  canChangeAudio: boolean;
  canChangeSubtitles: boolean;
  canChangeQuality: boolean;
}
