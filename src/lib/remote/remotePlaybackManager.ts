import {RemotePlaybackCanceledError, isRemotePlaybackCanceled} from './remotePlaybackErrors';
import GoogleCast, {
  MediaPlayerIdleReason,
  MediaPlayerState,
  MediaStatus,
  RemoteMediaClient,
} from 'react-native-google-cast';
import * as Crypto from 'expo-crypto';
import {DeviceEventEmitter, NativeModules} from 'react-native';
import {remoteDeliveryService} from './remoteDeliveryService';
import {dlnaService} from './dlnaService';
import {vegaCastService} from './vegaCastService';
import {useRemoteStore} from './remoteStore';
import {
  RemoteAudioTrack,
  RemoteDevice,
  RemotePlaybackStatus,
  RemoteQuality,
  RemoteServer,
  RemoteSubtitleTrack,
} from './types';
import {isTV} from '../tv';
import {getCookieHeader} from '../services/cookieManager';
import {mainStorage} from '../storage/StorageService';
import {torrentManager} from '../torrentManager';
import type {Stream} from '../providers/types';

const CAST_HLS_KEY = 'remote.castHlsOutput';
const VOLUME_KEYS_KEY = 'remote.volumeKeys';
const VOLUME_KEY_STEP = 0.05;
/** Emitted with the new level (0 to 1) when a volume key changes the receiver. */
export const REMOTE_VOLUME_SHOWN_EVENT = 'vegaRemoteVolumeShown';
const {VegaVolumeKeys} = NativeModules;

interface AmbiguousSessionState {
  playUrl: string;
  mimeType?: string;
  timelineOffset: number;
  sourceDuration: number;
  engine: 'ffmpeg' | 'hls' | null;
  byteRangeSeek: boolean;
  subtitleTrackId?: string | null;
  audioTrackId?: string;
  status?: RemotePlaybackStatus;
}

interface AmbiguousSessionPair {
  device: RemoteDevice;
  previousSessionId: string;
  nextSessionId: string;
  previousState: AmbiguousSessionState;
  nextState?: AmbiguousSessionState;
}

export interface RemoteMediaPayload {
  servers?:RemoteServer[];
  serverId?:string;
  providerStream?:Stream;
  sourceUrl: string;
  sourceType?: string;
  isLocal?: boolean;
  title: string;
  subtitle?: string;
  artwork?: string;
  headers?: Record<string, string>;
  qualities?: RemoteQuality[];
  audioTracks?: RemoteAudioTrack[];
  subtitles?: RemoteSubtitleTrack[];
  initialPosition?: number;
  duration?: number;
}

function sanitizeUrlForLog(url?: string): string {
  return url || '';
}

// Servers on the phone's loopback, such as the torrent stream server.
/** External subtitles the phone server can fetch: web files and picked files in the app cache. */
function isServableExternalSubtitle(uri?: string): uri is string {
  return Boolean(uri && /^(?:https?|file):\/\//i.test(uri));
}

/** Adds the user subtitle delay to a phone server subtitle URL. */
function withSubtitleDelay(url: string): string {
  const delayMs = Math.round(useRemoteStore.getState().subtitleDelayMs);
  if (!delayMs) return url;
  return `${url}${url.includes('?') ? '&' : '?'}delay=${delayMs}`;
}

function isLoopbackUrl(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(url);
}

class RemotePlaybackManager {
  private activePayload: RemoteMediaPayload | null = null;
  private currentSessionId = '';
  private castClient: RemoteMediaClient | null = null;
  private activePlayUrl = '';
  private activeMimeType: string | undefined;
  private timelineOffset = 0;
  private sourceDuration = 0;
  private changingAudio = false;
  // True when the active stream is packaged on the phone with one selected audio track.
  private activeRemux = false;
  // True when that packaged stream serves byte ranges, so the receiver seeks it itself.
  private activeByteRangeSeek = false;
  // Set by stop(); receiver events that follow a deliberate stop are not errors.
  private ending = false;
  // Remux engine used by the active session. 'hls' is Cast only: the receiver
  // gets a VOD playlist and seeks by itself.
  private activeRemuxEngine: 'ffmpeg' | 'hls' | null = null;
  // The active source is an HLS or DASH manifest, which never gets HLS output.
  private activeIsManifest = false;
  // Inspected container format (e.g. 'matroska', 'mov,mp4,m4a,3gp,3g2,mj2')
  private activeContainer: string | undefined;
  // Last requested media, kept even when the load failed so it can be retried.
  private lastRequest: {
    device: RemoteDevice;
    payload: RemoteMediaPayload;
  } | null = null;
  private lastCastStreamPosition: number | null = null;
  private lastCastStreamPositionTime = 0;
  private ignoreCastReceiverSeekUntil = 0;
  private lastSupportedMediaCommands: number | null = null;
  private playbackGeneration = 0;
  private loadGeneration = 0;
  // Torrent kept running for the receiver after the player that added it closed.
  private ownedTorrentHash: string | null = null;

  private operationSessions = new Map<number, Set<string>>();
  // Wakes loads waiting in awaitCancelableOperation when a newer load or a stop arrives.
  private supersedeWaiters = new Set<() => void>();

  private assertPlaybackOperation(token: number): void {
    if (token !== this.loadGeneration || this.ending) {
      throw new RemotePlaybackCanceledError();
    }
  }

  private async preparePlaybackStream(
    options: Parameters<typeof remoteDeliveryService.prepareStream>[0],
    token: number,
  ) {
    const owned = this.operationSessions.get(token) || new Set<string>();
    owned.add(options.sessionId);
    this.operationSessions.set(token, owned);
    return remoteDeliveryService.prepareStream({
      ...options,
      audioDelayMs:
        options.audioDelayMs ?? useRemoteStore.getState().audioDelayMs,
    });
  }

  private async cleanupCanceledOperation(token: number): Promise<void> {
    if (token === this.loadGeneration && !this.ending) {
      this.operationSessions.delete(token);
      return;
    }
    const owned = this.operationSessions.get(token);
    this.operationSessions.delete(token);
    if (owned)
      for (const id of owned)
        await remoteDeliveryService.cleanupSession(id).catch(() => {});
  }

  private wakeSupersededOperations(): void {
    for (const wake of [...this.supersedeWaiters]) wake();
  }

  /**
   * Like awaitPlaybackOperation, but stops waiting as soon as the load is
   * superseded. Only for work without side effects, such as track inspection,
   * which can take minutes on a torrent with no peers and would otherwise hold
   * the queue the next load waits in.
   */
  private async awaitCancelableOperation<T>(
    work: Promise<T>,
    token: number,
  ): Promise<T> {
    let wake = () => {};
    const superseded = new Promise<never>((_, reject) => {
      wake = () => {
        if (token !== this.loadGeneration || this.ending) {
          reject(new RemotePlaybackCanceledError());
        }
      };
    });
    this.supersedeWaiters.add(wake);
    // The abandoned work may still fail later; nothing waits on it then.
    work.catch(() => {});
    try {
      return await Promise.race([work, superseded]);
    } finally {
      this.supersedeWaiters.delete(wake);
      this.assertPlaybackOperation(token);
    }
  }

  private async awaitPlaybackOperation<T>(
    work: Promise<T>,
    token: number,
  ): Promise<T> {
    try {
      return await work;
    } finally {
      this.assertPlaybackOperation(token);
    }
  }

  private seekRequestId = 0;
  private seekQueue: Promise<void> = Promise.resolve();
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private resolutionQueue: Promise<void> = Promise.resolve();
  private ambiguousSessions: AmbiguousSessionPair[] = [];
  private ambiguousTimer: ReturnType<typeof setInterval> | null = null;
  private lastReceiverUri = '';
  private pendingRetirements = new Map<string, Set<string>>();

  private confirmSessionHandover(uri: string): void {
    if (!uri || this.ending) return;
    this.lastReceiverUri = uri;
    for (const [nextId, previousIds] of this.pendingRetirements) {
      if (!this.uriMatchesSessionOrUrl(uri, nextId, '')) continue;
      this.pendingRetirements.delete(nextId);
      for (const previousId of previousIds) {
        remoteDeliveryService.retireSessionWhenReady(previousId, nextId).catch(() => {});
      }
    }
  }

  constructor() {
    remoteDeliveryService.onMediaAction(event => {
      this.handleMediaAction(event);
    });
    dlnaService.setOnUriObserved(uri => {
      this.confirmSessionHandover(uri);
      this.resolveAmbiguousSessions(uri).catch(() => {});
    });
  }

  private handleMediaAction(event: {action: string; value?: number}): void {
    switch (event.action) {
      case 'play':
        this.play().catch(() => {});
        break;
      case 'pause':
        this.pause().catch(() => {});
        break;
      case 'stop':
        this.stop().catch(() => {});
        break;
      case 'seek':
        if (typeof event.value === 'number') {
          this.seekNow(event.value).catch(() => {});
        }
        break;
      case 'skip':
        // Native side already merged rapid taps, and JS timers are paused while
        // the app is backgrounded, so seek right away instead of debouncing.
        if (typeof event.value === 'number') {
          const cur = useRemoteStore.getState().currentTime;
          this.seekNow(Math.max(0, cur + event.value)).catch(() => {});
        }
        break;
      case 'rewind': {
        const cur = useRemoteStore.getState().currentTime;
        this.seek(Math.max(0, cur - 10)).catch(() => {});
        break;
      }
      case 'forward': {
        const cur = useRemoteStore.getState().currentTime;
        this.seek(cur + 10).catch(() => {});
        break;
      }
    }
  }

  isEnding(): boolean {
    return this.ending;
  }


  /** Called when the user starts over (opens a player or picks a device) after a stop. */
  clearEnding(): void {
    this.ending = false;
  }

  /**
   * Connects a Cast device from the in-app list. The Player loads media once the
   * session is up, so the store is not touched here.
   */
  async connectCast(deviceId: string): Promise<void> {
    const current = useRemoteStore.getState().connectedDevice;
    if (current?.type === 'dlna' || current?.type === 'vega-cast') {
      await this.stop();
    }
    this.clearEnding();
    useRemoteStore.getState().setErrorMessage(undefined);
    const started = await GoogleCast.getSessionManager().startSession(deviceId);
    if (!started) throw new Error('That Cast device is no longer available');
  }

  /** Switches to a DLNA renderer, ending any Cast session first. */
  async connectDlna(device: RemoteDevice): Promise<void> {
    const current = useRemoteStore.getState().connectedDevice;
    if (current?.id === device.id) return;
    const session = await GoogleCast.getSessionManager().getCurrentCastSession().catch(() => null);
    if (current || session) await this.stop();
    this.clearEnding();
    useRemoteStore.getState().setErrorMessage(undefined);
    useRemoteStore.getState().setConnectedDevice(device);
  }

  async connectVegaCast(receiverId:string):Promise<void> {
    const current=useRemoteStore.getState().connectedDevice;
    if(current)await this.stop();
    const session=await GoogleCast.getSessionManager().getCurrentCastSession().catch(()=>null);
    if(session)await GoogleCast.getSessionManager().endCurrentSession(true);
    this.clearEnding();await vegaCastService.connect(receiverId);
  }

  private async loadVegaCast(device:RemoteDevice,payload:RemoteMediaPayload):Promise<void> {
    this.activePayload=payload;this.lastRequest={device,payload};this.ending=false;
    try {await vegaCastService.load(payload);}
    catch(error){
      if(this.activePayload===payload&&useRemoteStore.getState().connectedDevice?.id===device.id){
        useRemoteStore.getState().setStatus('error');
        useRemoteStore.getState().setErrorMessage(error instanceof Error?error.message:'Vega Cast playback failed');
      }
      throw error;
    }
  }

  private detectAndHandleCastReceiverSeek(
    streamPosition?: number,
    playerState?: MediaPlayerState | null,
  ): boolean {
    if (
      typeof streamPosition !== 'number' ||
      !Number.isFinite(streamPosition) ||
      streamPosition < 0
    ) {
      return false;
    }
    const device = useRemoteStore.getState().connectedDevice;
    if (device?.type !== 'cast') return false;
    if (
      !this.activeRemux ||
      (this.activeByteRangeSeek && this.activeRemuxEngine === 'hls')
    ) {
      return false;
    }
    if (
      this.changingAudio ||
      this.ending ||
      useRemoteStore.getState().pendingSeek ||
      Date.now() < this.ignoreCastReceiverSeekUntil
    ) {
      this.lastCastStreamPosition = streamPosition;
      this.lastCastStreamPositionTime = Date.now();
      return false;
    }

    if (this.lastCastStreamPosition !== null) {
      const elapsedSec = (Date.now() - this.lastCastStreamPositionTime) / 1000;
      const isPaused =
        playerState === MediaPlayerState.PAUSED ||
        useRemoteStore.getState().status === 'paused';
      const expected = isPaused
        ? this.lastCastStreamPosition
        : this.lastCastStreamPosition + elapsedSec;
      const delta = Math.abs(streamPosition - expected);

      if (delta > 3.5) {
        const targetMovieSeconds = Math.max(
          0,
          Math.min(
            streamPosition + this.timelineOffset,
            this.sourceDuration || Number.MAX_SAFE_INTEGER,
          ),
        );
        console.info('[Cast] Receiver-initiated seek detected:', {
          from: expected,
          to: streamPosition,
          targetMovieSeconds,
        });
        this.ignoreCastReceiverSeekUntil = Date.now() + 4000;
        this.lastCastStreamPosition = streamPosition;
        this.lastCastStreamPositionTime = Date.now();
        this.seek(targetMovieSeconds).catch(err => {
          console.warn('[Cast] Receiver seek reload failed:', err);
        });
        return true;
      }
    }

    this.lastCastStreamPosition = streamPosition;
    this.lastCastStreamPositionTime = Date.now();
    return false;
  }

  /** Single mapping from Cast receiver state to the remote store. */
  private lastCastDiagnosticKey = '';

  handleCastStatus(status: MediaStatus | null, sourceLabel?: string): void {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return;
    if (!status || this.ending) return;
    const diagnosticKey = JSON.stringify([this.currentSessionId, status.playerState, status.idleReason]);
    if (diagnosticKey !== this.lastCastDiagnosticKey) {
      this.lastCastDiagnosticKey = diagnosticKey;
      console.info('[CastStatus] transition', {
        sessionId: this.currentSessionId,
        playerState: status.playerState, idleReason: status.idleReason,
        position: status.streamPosition, contentType: status.mediaInfo?.contentType,
        timelineOffset: this.timelineOffset, sourceDuration: this.sourceDuration,
        changingAudio: this.changingAudio,
      });
    }

    const supportedCmds =
      typeof status.supportedMediaCommands === 'number'
        ? status.supportedMediaCommands
        : undefined;
    if (
      supportedCmds !== undefined &&
      this.lastSupportedMediaCommands !== supportedCmds
    ) {
      this.lastSupportedMediaCommands = supportedCmds;
      console.info('[Cast] supportedMediaCommands updated:', {
        supportedMediaCommands: supportedCmds,
        canSeek: Boolean(supportedCmds & 2),
        canPause: Boolean(supportedCmds & 1),
      });
    }

    this.detectAndHandleCastReceiverSeek(
      status.streamPosition,
      status.playerState,
    );
    const store = useRemoteStore.getState();
    if (
      status.playerState === MediaPlayerState.IDLE &&
      status.idleReason === MediaPlayerIdleReason.FINISHED
    ) {
      const duration = this.sourceDuration || store.duration;
      if (duration > 0) store.setTimeline(duration, duration);
    } else if (
      !this.changingAudio &&
      typeof status.streamPosition === 'number'
    ) {
      store.setTimeline(
        status.streamPosition + this.timelineOffset,
        this.sourceDuration || store.duration,
      );
    }
    switch (status.playerState) {
      case MediaPlayerState.PLAYING:
        if (status.mediaInfo?.contentUrl) this.confirmSessionHandover(status.mediaInfo.contentUrl);
        store.setStatus('playing');
        store.setErrorMessage(undefined);
        remoteDeliveryService
          .updateMediaPlayback({isPlaying: true})
          .catch(() => {});
        return;
      case MediaPlayerState.PAUSED:
        store.setStatus('paused');
        remoteDeliveryService
          .updateMediaPlayback({isPlaying: false})
          .catch(() => {});
        return;
      case MediaPlayerState.BUFFERING:
      case MediaPlayerState.LOADING:
        store.setStatus('buffering');
        return;
      case MediaPlayerState.IDLE:
        break;
      default:
        return;
    }
    // A load we issued replaces the old media; its INTERRUPTED/ERROR idle is not ours to show.
    if (
      this.changingAudio ||
      status.idleReason === MediaPlayerIdleReason.INTERRUPTED
    )
      return;
    if (status.idleReason === MediaPlayerIdleReason.ERROR) {
      const failedSessionId = this.currentSessionId;
      console.warn('[CastStatus] receiver playback failed', {
        sessionId: failedSessionId, idleReason: status.idleReason, position: status.streamPosition,
        contentType: status.mediaInfo?.contentType,
      });
      store.setStatus('error');
      store.cancelSeek();
      this.getLastDeliveryError().then(deliveryError => {
        if (this.ending || this.currentSessionId !== failedSessionId) return;
        console.warn('[CastStatus] delivery diagnosis', {sessionId: failedSessionId, deliveryError: deliveryError?.replace(/https?:\/\/\S+/g, '[media URL]').slice(0, 240) || 'none recorded'});
        useRemoteStore
          .getState()
          .setErrorMessage(
            deliveryError
              ? `Couldn't deliver the video: ${deliveryError}`
              : `The TV couldn't play this ${sourceLabel || 'stream'}. Try another server.`,
          );
      });
      return;
    }
    store.setStatus(
      status.idleReason === MediaPlayerIdleReason.FINISHED ? 'stopped' : 'idle',
    );
  }

  /** Reloads the last requested media at the current position. */
  async retry(): Promise<void> {
    if (!this.lastRequest) return;
    const {device, payload} = this.lastRequest;
    const position = useRemoteStore.getState().currentTime;
    await this.queueLoad(
      device,
      {
        ...payload,
        initialPosition: position > 0 ? position : payload.initialPosition,
      },
      true,
    );
  }

  /**
   * Applies new subtitle and audio delays by reloading the stream at the
   * current position. The phone shifts the cues and remuxes the sound, so this
   * works whatever the receiver supports. Restores the old delays on failure.
   */
  async applyDelays(subtitleDelayMs: number, audioDelayMs: number): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast'){
      const store=useRemoteStore.getState();
      if(audioDelayMs!==store.audioDelayMs)throw new Error('Audio delay adjustment is not available on this receiver');
      await vegaCastService.command('SUBTITLE_DELAY',subtitleDelayMs/1000);store.setDelays(subtitleDelayMs,audioDelayMs);return;
    }
    if (isTV || !this.lastRequest) return;
    const store = useRemoteStore.getState();
    const previous = {sub: store.subtitleDelayMs, audio: store.audioDelayMs};
    if (previous.sub === subtitleDelayMs && previous.audio === audioDelayMs) return;
    store.setDelays(subtitleDelayMs, audioDelayMs);
    try {
      await this.retry();
    } catch (e) {
      if (!isRemotePlaybackCanceled(e)) {
        useRemoteStore.getState().setDelays(previous.sub, previous.audio);
      }
      throw e;
    }
  }

  /**
   * True while a load or reload swaps the stream. Receiver progress in this window
   * may belong to either stream, so it cannot be mapped with the current offset.
   */
  isReloading(): boolean {
    return this.changingAudio;
  }

  mapTimeline(position: number, duration: number) {
    this.detectAndHandleCastReceiverSeek(position);
    const pos = position + this.timelineOffset;
    const dur = this.sourceDuration || duration;
    remoteDeliveryService.updateMediaPlayback({position: pos, duration: dur}).catch(() => {});
    return {position: pos, duration: dur};
  }

  initCastClient(client: RemoteMediaClient): void {
    if (isTV) return;
    this.castClient = client;
  }

  getCastClient(): RemoteMediaClient | null {
    return this.castClient;
  }

  getLastDeliveryError(): Promise<string | undefined> {
    return remoteDeliveryService.getSessionError(this.currentSessionId);
  }

  startRemotePlayback(
    device: RemoteDevice,
    payload: RemoteMediaPayload,
  ): Promise<void> {
    if(device.type==='vega-cast'){
      return this.loadVegaCast(device,payload);
    }
    return this.queueLoad(device, payload, false);
  }

  /** Reloads of the same media pass keepDelays so the user's delays survive. */
  private queueLoad(
    device: RemoteDevice,
    payload: RemoteMediaPayload,
    keepDelays: boolean,
  ): Promise<void> {
    if(device.type==='vega-cast'){
      return this.loadVegaCast(device,payload);
    }
    if (isTV) return Promise.resolve();
    this.cancelQueuedSeek();
    const operationToken = ++this.loadGeneration;
    this.wakeSupersededOperations();
    // Source changes supersede old work immediately, then wait for its cleanup.
    return this.enqueueOperation(() =>
      this.loadRemotePlayback(device, payload, operationToken, keepDelays),
    );
  }

  private async loadRemotePlayback(
    device: RemoteDevice,
    payload: RemoteMediaPayload,
    operationToken: number,
    keepDelays: boolean,
  ): Promise<void> {
    if (operationToken !== this.loadGeneration)
      throw new RemotePlaybackCanceledError();
    this.ending = false;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekRequestId++;
    useRemoteStore.getState().cancelSeek();
    this.changingAudio = true;
    this.ending = false;
    this.playbackGeneration++;
    this.lastRequest = {device, payload};

    const previousPayload = this.activePayload;
    const previousSessionId = this.currentSessionId;
    // Delays belong to one source; a quality, audio or delay reload keeps them.
    if (
      !keepDelays &&
      (!previousPayload ||
        previousPayload.sourceUrl !== payload.sourceUrl ||
        previousPayload.title !== payload.title ||
        previousPayload.subtitle !== payload.subtitle)
    ) {
      useRemoteStore.getState().setDelays(0, 0);
    }
    this.activePayload = payload;
    this.releaseOwnedTorrent(payload.sourceUrl);
    const operationSessionId = `session_${Crypto.randomUUID()}`;
    useRemoteStore.getState().setConnectedDevice(device);
    useRemoteStore.getState().setStatus('loading');
    useRemoteStore.setState({errorMessage: undefined, preparingSubtitle: false});

    try {
      const isLocalFile = Boolean(
        payload.isLocal ||
        payload.sourceUrl.startsWith('file://') ||
        payload.sourceUrl.startsWith('content://') ||
        payload.sourceUrl.startsWith('/'),
      );
      // Only the phone can reach a loopback server, so the receiver gets it
      // through the delivery server.
      const isLoopbackSource = isLoopbackUrl(payload.sourceUrl);
      let resolvedHeaders: Record<string, string> = {};
      if (payload.headers) {
        if (Array.isArray(payload.headers)) {
          for (const item of payload.headers) {
            if (Array.isArray(item) && item.length >= 2) {
              resolvedHeaders[String(item[0])] = String(item[1]);
            }
          }
        } else if (typeof payload.headers === 'object') {
          for (const [k, v] of Object.entries(payload.headers)) {
            if (v != null) {
              resolvedHeaders[k] = String(v);
            }
          }
        }
      }
      if (
        !isLocalFile &&
        !isLoopbackSource &&
        !Object.keys(resolvedHeaders).some(k => k.toLowerCase() === 'cookie')
      ) {
        try {
          const cookieHeader = await this.awaitPlaybackOperation(
            getCookieHeader(payload.sourceUrl),
            operationToken,
          );
          if (cookieHeader) {
            resolvedHeaders['Cookie'] = cookieHeader;
          }
        } catch {
          this.assertPlaybackOperation(operationToken);
        }
      }
      console.log(
        '[RemotePlayback] Forwarding stream headers:',
        Object.keys(resolvedHeaders),
      );
      this.activePayload = {...payload, headers: resolvedHeaders};

      // 1. Inspect tracks if MKV or local file
      const sourceType = payload.sourceType?.toLowerCase();
      const inspected = await this.awaitCancelableOperation(
        remoteDeliveryService.inspectTracks(
          payload.sourceUrl,
          payload.isLocal,
          resolvedHeaders,
          payload.sourceType,
        ),
        operationToken,
      );
      this.activeContainer = inspected.container;
      const isMkv =
        sourceType === 'mkv' ||
        inspected.container === 'matroska' ||
        inspected.container === 'mkv' ||
        /\.mkv(?:[?#]|$)/i.test(payload.sourceUrl);

      const audioTracks: RemoteAudioTrack[] =
        inspected.audioTracks.length > 0
          ? inspected.audioTracks
          : payload.audioTracks && payload.audioTracks.length > 0
            ? payload.audioTracks
            : [];

      const selectedAudio =
        audioTracks.find(track => track.isSelected) || audioTracks[0];
      useRemoteStore.getState().setAudioTracks(audioTracks, selectedAudio?.id);

      // Populate subtitles (embedded + external, deduplicated)
      const allSubs: RemoteSubtitleTrack[] = [];
      const seenSubIds = new Set<string>();
      for (const s of [
        ...inspected.subtitleTracks,
        ...(payload.subtitles || []),
      ]) {
        if (!seenSubIds.has(s.id)) {
          seenSubIds.add(s.id);
          allSubs.push(s);
        }
      }
      useRemoteStore.getState().setSubtitleTracks(allSubs);

      // Quality = video variants of this server's stream. Servers are listed separately.
      const qualities: RemoteQuality[] = inspected.videoQualities?.length
        ? inspected.videoQualities
        : payload.qualities || [];
      useRemoteStore.getState().setQualities(qualities, qualities[0]?.id);

      // 2. Prepare media URL depending on target device
      let playUrl = payload.sourceUrl;
      const hasCustomHeaders = Boolean(
        resolvedHeaders && Object.keys(resolvedHeaders).length > 0,
      );

      const isManifest =
        sourceType === 'm3u8' ||
        sourceType === 'hls' ||
        sourceType === 'mpd' ||
        sourceType === 'dash' ||
        payload.sourceUrl.toLowerCase().includes('.m3u8') ||
        payload.sourceUrl.toLowerCase().includes('.mpd') ||
        payload.sourceUrl.toLowerCase().includes('/hls/') ||
        payload.sourceUrl.toLowerCase().includes('/dash/') ||
        /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(payload.sourceUrl);
      const isDlna = device.type === 'dlna';
      const isWebm =
        sourceType === 'webm' || /\.webm(?:[?#]|$)/i.test(payload.sourceUrl);
      // A raw manifest proxy breaks relative segments and drops the source headers
      // on segment fetches, so header-dependent manifests are remuxed on Cast too.
      const needsRemux =
        isMkv ||
        (isDlna && (isManifest || isWebm)) ||
        (device.type === 'cast' && isManifest && hasCustomHeaders) ||
        audioTracks.length > 1 ||
        Boolean(selectedAudio && selectedAudio.index > 0) ||
        // The sound can only be shifted while it is re-encoded.
        useRemoteStore.getState().audioDelayMs !== 0;
      // Shifted subtitles are served by the phone, so the stream needs a session.
      const hasSubtitleDelay = useRemoteStore.getState().subtitleDelayMs !== 0;
      console.info('Remote delivery route', {
        device: device.type,
        sourceType: sourceType || 'unknown',
        container: inspected.container || 'unknown',
        audioTrackCount: audioTracks.length,
        delivery: needsRemux ? 'on-demand-fragmented-mp4' : 'direct-or-proxy',
      });
      let subtitleDeliveryUrl: string | undefined;
      let preparedMimeType: string | undefined;
      let timelineOffset = 0;
      let sourceDuration = 0;
      let byteRangeSeek = false;
      let activeEngine: 'ffmpeg' | 'hls' | null = null;
      const mediaDuration = inspected.durationSeconds || payload.duration || 0;
      if (device.type === 'cast') {
        let usedEngine: 'hls' | 'ffmpeg' | null = null;
        if (
          needsRemux ||
          isLocalFile ||
          isLoopbackSource ||
          hasCustomHeaders ||
          hasSubtitleDelay
        ) {
          const preferredMode: 'hls' | 'ffmpeg' =
            this.isCastHlsEnabled() && !isManifest ? 'hls' : 'ffmpeg';

          let prep: any;
          if (needsRemux && preferredMode === 'hls') {
            try {
              prep = await this.awaitPlaybackOperation(
                this.preparePlaybackStream(
                  {
                    sessionId: operationSessionId,
                    sourceUrl: payload.sourceUrl,
                    isLocal: isLocalFile,
                    headers: resolvedHeaders,
                    audioTrackIndex: selectedAudio?.index ?? 0,
                    mode: 'hls',
                    startPositionSeconds: payload.initialPosition,
                    audioCodec: selectedAudio?.codec,
                    durationSeconds: mediaDuration,
                    mimeType: 'video/mp4',
                  },
                  operationToken,
                ),
                operationToken,
              );
              if (!prep.byteRangeSeek) {
                console.info(
                  '[Cast] HLS output unavailable, falling back to ffmpeg',
                );
                await this.awaitPlaybackOperation(
                  remoteDeliveryService
                    .cleanupSession(operationSessionId)
                    .catch(() => {}),
                  operationToken,
                );
                prep = await this.awaitPlaybackOperation(
                  this.preparePlaybackStream(
                    {
                      sessionId: operationSessionId,
                      sourceUrl: payload.sourceUrl,
                      isLocal: isLocalFile,
                      headers: resolvedHeaders,
                      audioTrackIndex: selectedAudio?.index ?? 0,
                      mode: 'ffmpeg',
                      startPositionSeconds: payload.initialPosition,
                      audioCodec: selectedAudio?.codec,
                      durationSeconds: mediaDuration,
                      mimeType: 'video/mp4',
                    },
                    operationToken,
                  ),
                  operationToken,
                );
                usedEngine = 'ffmpeg';
              } else {
                usedEngine = 'hls';
              }
            } catch (err) {
              this.assertPlaybackOperation(operationToken);
              console.warn(
                '[Cast] HLS output failed, falling back to ffmpeg:',
                err,
              );
              await this.awaitPlaybackOperation(
                remoteDeliveryService
                  .cleanupSession(operationSessionId)
                  .catch(() => {}),
                operationToken,
              );
              prep = await this.awaitPlaybackOperation(
                this.preparePlaybackStream(
                  {
                    sessionId: operationSessionId,
                    sourceUrl: payload.sourceUrl,
                    isLocal: isLocalFile,
                    headers: resolvedHeaders,
                    audioTrackIndex: selectedAudio?.index ?? 0,
                    mode: 'ffmpeg',
                    startPositionSeconds: payload.initialPosition,
                    audioCodec: selectedAudio?.codec,
                    durationSeconds: mediaDuration,
                    mimeType: 'video/mp4',
                  },
                  operationToken,
                ),
                operationToken,
              );
              usedEngine = 'ffmpeg';
            }
          } else {
            prep = await this.awaitPlaybackOperation(
              this.preparePlaybackStream(
                {
                  sessionId: operationSessionId,
                  sourceUrl: payload.sourceUrl,
                  isLocal: isLocalFile,
                  headers: resolvedHeaders,
                  audioTrackIndex: selectedAudio?.index ?? 0,
                  mode: needsRemux ? preferredMode : 'proxy',
                  startPositionSeconds: payload.initialPosition,
                  audioCodec: selectedAudio?.codec,
                  durationSeconds: mediaDuration,
                  mimeType:
                    sourceType === 'webm' ||
                    /\.webm(?:[?#]|$)/i.test(payload.sourceUrl)
                      ? 'video/webm'
                      : sourceType === 'm3u8' ||
                          sourceType === 'hls' ||
                          /\.m3u8(?:[?#]|$)/i.test(payload.sourceUrl)
                        ? 'application/vnd.apple.mpegurl'
                        : sourceType === 'mpd' ||
                            sourceType === 'dash' ||
                            /\.mpd(?:[?#]|$)/i.test(payload.sourceUrl)
                          ? 'application/dash+xml'
                          : 'video/mp4',
                },
                operationToken,
              ),
              operationToken,
            );
            usedEngine = needsRemux ? preferredMode : null;
          }
          playUrl = prep.streamUrl;
          preparedMimeType = prep.mimeType;
          timelineOffset = prep.timelineOffsetSeconds || 0;
          sourceDuration = prep.durationSeconds || mediaDuration;
          byteRangeSeek = Boolean(prep.byteRangeSeek);
        }

        // Direct video still needs a registered phone session for external subtitles.
        if (playUrl === payload.sourceUrl && allSubs.some(sub => !sub.isEmbedded && isServableExternalSubtitle(sub.uri))) {
          const subtitleSession = await this.awaitPlaybackOperation(
            this.preparePlaybackStream({
              sessionId: operationSessionId,
              sourceUrl: payload.sourceUrl,
              headers: resolvedHeaders,
              mode: 'proxy',
              durationSeconds: mediaDuration,
            }, operationToken), operationToken,
          );
          subtitleDeliveryUrl = subtitleSession.streamUrl;
        }

        await this.awaitPlaybackOperation(
          this.loadOnCast(
            playUrl,
            payload,
            preparedMimeType,
            timelineOffset,
            sourceDuration,
            subtitleDeliveryUrl,
          ),
          operationToken,
        );
        activeEngine = needsRemux ? usedEngine : null;
      } else {
        if (needsRemux) {
          const prep = await this.awaitPlaybackOperation(
            this.preparePlaybackStream(
              {
                sessionId: operationSessionId,
                sourceUrl: payload.sourceUrl,
                isLocal: isLocalFile,
                headers: resolvedHeaders,
                audioTrackIndex: selectedAudio?.index ?? 0,
                mode: 'ffmpeg',
                startPositionSeconds: payload.initialPosition,
                audioCodec: selectedAudio?.codec,
                durationSeconds: mediaDuration,
              },
              operationToken,
            ),
            operationToken,
          );
          playUrl = prep.streamUrl;
          preparedMimeType = prep.mimeType;
          timelineOffset = prep.timelineOffsetSeconds || 0;
          sourceDuration = prep.durationSeconds || mediaDuration;
          byteRangeSeek = Boolean(prep.byteRangeSeek);
          const dlnaSubUrl = this.resolveActiveSubtitleUrl(playUrl);
          await this.awaitPlaybackOperation(
            this.loadOnDlna(
              device,
              playUrl,
              payload.title,
              dlnaSubUrl,
              timelineOffset,
              sourceDuration,
              () => operationToken === this.loadGeneration && !this.ending,
            ),
            operationToken,
          );
          // Only send renderer seek if stream URL wasn't already seek-offset
          if (
            !timelineOffset &&
            payload.initialPosition &&
            payload.initialPosition > 0
          ) {
            await this.awaitPlaybackOperation(
              dlnaService.seek(device, payload.initialPosition).catch(() => {}),
              operationToken,
            );
          }
          activeEngine = 'ffmpeg';
        } else {
          const prep = await this.awaitPlaybackOperation(
            this.preparePlaybackStream(
              {
                sessionId: operationSessionId,
                sourceUrl: payload.sourceUrl,
                isLocal: isLocalFile,
                headers: resolvedHeaders,
                audioTrackIndex: 0,
                mode: 'progressive',
                durationSeconds: mediaDuration,
              },
              operationToken,
            ),
            operationToken,
          );
          playUrl = prep.streamUrl;
          preparedMimeType = prep.mimeType;
          timelineOffset = prep.timelineOffsetSeconds || 0;
          sourceDuration = prep.durationSeconds || mediaDuration;
          byteRangeSeek = Boolean(prep.byteRangeSeek);
          const dlnaSubUrl = this.resolveActiveSubtitleUrl(playUrl);
          await this.awaitPlaybackOperation(
            this.loadOnDlna(
              device,
              playUrl,
              payload.title,
              dlnaSubUrl,
              0,
              sourceDuration,
              () => operationToken === this.loadGeneration && !this.ending,
            ),
            operationToken,
          );
          if (payload.initialPosition && payload.initialPosition > 0) {
            await this.awaitPlaybackOperation(
              dlnaService.seek(device, payload.initialPosition),
              operationToken,
            );
          }
          activeEngine = null;
        }
      }

      const targetSubtitle =
        payload.subtitle ||
        (device.type === 'cast'
          ? `Casting to ${device.name || 'Chromecast'}`
          : `Streaming to ${device.name || 'DLNA'}`);
      await this.awaitPlaybackOperation(
        remoteDeliveryService
          .startForegroundService({
            title: payload.title || 'Vega Media',
            subtitle: targetSubtitle,
            artwork: payload.artwork,
            isPlaying: true,
            position: payload.initialPosition || 0,
            duration: sourceDuration || 0,
          })
          .catch(() => {}),
        operationToken,
      );

      this.assertPlaybackOperation(operationToken);
      this.currentSessionId = operationSessionId;
      this.operationSessions.delete(operationToken);
      this.activeRemuxEngine = activeEngine;
      this.activePlayUrl = playUrl;
      this.activeMimeType = preparedMimeType;
      this.activeRemux = needsRemux;
      this.activeIsManifest = isManifest;
      this.activeByteRangeSeek = byteRangeSeek;
      this.timelineOffset = timelineOffset;
      this.sourceDuration = sourceDuration;

      useRemoteStore.getState().setErrorMessage(undefined);
      if (device.type === 'dlna')
        useRemoteStore.getState().setStatus('playing');
      else if (useRemoteStore.getState().status === 'loading')
        useRemoteStore.getState().setStatus('buffering');
      if (previousSessionId && previousSessionId !== this.currentSessionId) {
        await this.awaitPlaybackOperation(
          remoteDeliveryService.cleanupSession(previousSessionId),
          operationToken,
        );
      }
      this.stopAmbiguousSessionPolling();
      for (const pair of this.ambiguousSessions) {
        if (
          pair.previousSessionId &&
          pair.previousSessionId !== this.currentSessionId
        ) {
          await this.awaitPlaybackOperation(
            remoteDeliveryService
              .cleanupSession(pair.previousSessionId)
              .catch(() => {}),
            operationToken,
          );
        }
        if (
          pair.nextSessionId &&
          pair.nextSessionId !== this.currentSessionId
        ) {
          await this.awaitPlaybackOperation(
            remoteDeliveryService
              .cleanupSession(pair.nextSessionId)
              .catch(() => {}),
            operationToken,
          );
        }
      }
      this.ambiguousSessions = [];
    } catch (e: any) {
      this.assertPlaybackOperation(operationToken);
      console.error('Remote playback initiation failed:', e);
      await this.awaitPlaybackOperation(
        remoteDeliveryService.cleanupSession(operationSessionId),
        operationToken,
      );
      this.currentSessionId = previousSessionId;
      this.activePayload = previousPayload;
      if (!this.ending && !isRemotePlaybackCanceled(e)) {
        useRemoteStore.getState().setStatus('error');
        useRemoteStore
          .getState()
          .setErrorMessage(e.message || 'Failed to start remote playback');
      }
      throw e;
    } finally {
      await this.cleanupCanceledOperation(operationToken);
      if (operationToken !== this.loadGeneration && this.currentSessionId === previousSessionId) {
        this.activePayload = previousPayload;
      }
      if (operationToken === this.loadGeneration) this.changingAudio = false;
    }
  }

  /** Cast only: serve remuxed streams as HLS so the receiver seeks by itself. */
  /** Whether the phone volume keys change the receiver volume while Vega is open. */
  isVolumeKeysEnabled(): boolean {
    return mainStorage.getBool(VOLUME_KEYS_KEY, false);
  }

  setVolumeKeysEnabled(enabled: boolean): void {
    mainStorage.setBool(VOLUME_KEYS_KEY, enabled);
    this.updateVolumeKeyCapture();
  }

  private volumeKeysStarted = false;

  /** Starts following the setting and the connection; safe to call repeatedly. */
  startVolumeKeys(): void {
    // The TV app has no cast screen and its volume keys stay with the TV.
    if (this.volumeKeysStarted || !VegaVolumeKeys || isTV) return;
    this.volumeKeysStarted = true;
    DeviceEventEmitter.addListener('onVegaVolumeKey', ({direction}) =>
      this.handleVolumeKey(direction).catch(() => {}),
    );
    const setCastSession = (active: boolean) => {
      this.castSessionActive = active;
      this.updateVolumeKeyCapture();
    };
    try {
      const sessions = GoogleCast.getSessionManager();
      sessions.onSessionStarted(() => setCastSession(true));
      sessions.onSessionResumed(() => setCastSession(true));
      sessions.onSessionSuspended(() => setCastSession(false));
      sessions.onSessionEnded(() => setCastSession(false));
      sessions
        .getCurrentCastSession()
        .then(session => setCastSession(Boolean(session)))
        .catch(() => {});
    } catch (e) {
      // Devices without Google Play services have no Cast framework.
      console.warn('Cast session tracking unavailable:', e);
    }
    useRemoteStore.subscribe((state, previous) => {
      if (state.connectedDevice !== previous.connectedDevice) {
        this.updateVolumeKeyCapture();
        // Start from the receiver level, not the store default of 100%.
        if (state.connectedDevice) this.refreshVolume().catch(() => {});
      }
    });
    this.updateVolumeKeyCapture();
  }

  private castSessionActive = false;
  private volumeKeyTarget = 0;
  private lastVolumeKeyAt = 0;

  private async handleVolumeKey(direction: number): Promise<void> {
    // Read the receiver level after a pause, since the TV remote may have
    // changed it; quick repeated presses build on the last target instead.
    if (Date.now() - this.lastVolumeKeyAt > 1500) {
      if(useRemoteStore.getState().connectedDevice?.type!=='vega-cast')await this.refreshVolume();
      const {volume, isMuted} = useRemoteStore.getState();
      this.volumeKeyTarget = isMuted ? 0 : volume;
    }
    this.lastVolumeKeyAt = Date.now();
    this.volumeKeyTarget =
      Math.round(
        Math.min(1, Math.max(0, this.volumeKeyTarget + direction * VOLUME_KEY_STEP)) * 100,
      ) / 100;
    DeviceEventEmitter.emit(REMOTE_VOLUME_SHOWN_EVENT, this.volumeKeyTarget);
    await this.setVolume(this.volumeKeyTarget);
  }

  private updateVolumeKeyCapture(): void {
    VegaVolumeKeys?.setCaptureEnabled(
      this.isVolumeKeysEnabled() &&
        (this.castSessionActive ||
          Boolean(useRemoteStore.getState().connectedDevice)),
    );
  }

  isCastHlsEnabled(): boolean {
    return mainStorage.getBool(CAST_HLS_KEY, false);
  }

  /** Takes effect on the next load or audio switch. */
  setCastHlsEnabled(enabled: boolean): void {
    mainStorage.setBool(CAST_HLS_KEY, enabled);
  }

  /** URL the receiver is playing, for copying. */
  getActiveStreamUrl(): string {
    return this.activePlayUrl;
  }

  /** Subtitle URL the receiver gets for the selected track, for copying. */
  getActiveSubtitleUrl(): string | undefined {
    if (!this.activePlayUrl) return undefined;
    const trackId = useRemoteStore.getState().activeSubtitleTrackId;
    return (
      (trackId ? this.registeredSubtitleUrls.get(trackId) : undefined) ||
      this.resolveActiveSubtitleUrl(this.activePlayUrl)
    );
  }

  private resolveActiveSubtitleUrl(
    mediaUrl: string,
    explicitTrackId?: string | null,
  ): string | undefined {
    const activeSubId =
      explicitTrackId !== undefined
        ? explicitTrackId
        : useRemoteStore.getState().activeSubtitleTrackId;
    if (!activeSubId || activeSubId === 'off') return undefined;

    const subs = useRemoteStore.getState().subtitleTracks;
    const sub = subs.find(s => s.id === activeSubId);
    if (!sub) return undefined;

    let resolvedUrl: string | undefined;
    if (sub.isEmbedded && sub.index !== undefined) {
      try {
        const parsed = new URL(mediaUrl);
        const parts = parsed.pathname.split('/');
        const sessionId = parts[2];
        if (sessionId) {
          resolvedUrl = withSubtitleDelay(
            `${parsed.origin}/subtitle/${sessionId}/${sub.index}.vtt`,
          );
        }
      } catch {}
    } else if (isServableExternalSubtitle(sub.uri)) {
      // A stream started past 0:00 has its own 0 there; route the file through
      // the server so it is shifted by the same amount as embedded tracks.
      try {
        const parsed = new URL(mediaUrl);
        const sessionId = parsed.pathname.split('/')[2];
        if (
          sessionId &&
          /^\/(ffmpeg|hlsout|dlna|proxy)\//.test(parsed.pathname)
        ) {
          const ordinal = Math.max(0, subs.indexOf(sub));
          resolvedUrl = withSubtitleDelay(
            `${parsed.origin}/extsub/${sessionId}/${ordinal}.vtt?u=${encodeURIComponent(sub.uri)}`,
          );
        }
      } catch {}
      // The receiver cannot open a file on the phone.
      if (!resolvedUrl && /^https?:\/\//i.test(sub.uri)) resolvedUrl = sub.uri;
    }

    if (resolvedUrl) {
      console.info(
        '[Remote] Resolved subtitle URL:',
        resolvedUrl,
        `(track: ${sub.title || sub.language || sub.id})`,
      );
    }
    return resolvedUrl;
  }

  private registeredCastTrackIds = new Map<string, number>();
  private registeredSubtitleUrls = new Map<string, string>();

  /** The receiver's subtitle request has a short timeout. Extract the selected
   * track first, while the previous video can keep playing. */
  private async prepareSubtitleForPlayback(
    url: string | undefined,
    operationToken: number,
  ): Promise<void> {
    if (!url) return;
    useRemoteStore.setState({preparingSubtitle: true, errorMessage: undefined});
    try {
      await this.awaitCancelableOperation(
        remoteDeliveryService.prepareSubtitle(url), operationToken,
      );
    } finally {
      if (operationToken === this.loadGeneration && !this.ending) {
        useRemoteStore.setState({preparingSubtitle: false});
      }
    }
  }

  private async loadOnDlna(
    ...args: Parameters<typeof dlnaService.loadMedia>
  ): Promise<void> {
    const token = this.loadGeneration;
    await this.prepareSubtitleForPlayback(args[3], token);
    this.assertPlaybackOperation(token);
    return dlnaService.loadMedia(...args);
  }

  private async loadOnCast(
    mediaUrl: string,
    payload: RemoteMediaPayload,
    preparedMimeType?: string,
    timelineOffset = 0,
    sourceDuration = 0,
    subtitleDeliveryUrl?: string,
  ): Promise<void> {
    const operationToken = this.loadGeneration;
    const session =
      await GoogleCast.getSessionManager().getCurrentCastSession();
    this.assertPlaybackOperation(operationToken);
    const client = session?.client;
    if (!client) {
      this.castClient = null;
      useRemoteStore.getState().setConnectedDevice(null);
      throw new Error('Chromecast disconnected. Select the device again.');
    }

    this.castClient = client;
    const castDevice = await this.awaitPlaybackOperation(
      session.getCastDevice(),
      operationToken,
    );
    const subtitles = useRemoteStore.getState().subtitleTracks;
    let deliveryUrl = subtitleDeliveryUrl || mediaUrl;
    // Restoring a direct video uses its existing subtitle-only session.
    if (!/^\/(ffmpeg|hlsout|dlna|proxy|hls)\//.test(new URL(deliveryUrl).pathname) &&
        subtitles.some(sub => !sub.isEmbedded && sub.uri) && this.currentSessionId) {
      const server = await this.awaitPlaybackOperation(
        remoteDeliveryService.ensureServerStarted(), operationToken,
      );
      deliveryUrl = `${server.baseUrl}/proxy/${this.currentSessionId}/stream`;
    }
    const parsedDelivery = new URL(deliveryUrl);
    const sessionId = /^\/(ffmpeg|hlsout|dlna|proxy|hls)\//.test(parsedDelivery.pathname)
      ? parsedDelivery.pathname.split('/')[2] : undefined;
    const validSubs = subtitles.map((sub, ordinal) => {
      if (!sessionId) return undefined;
      if (sub.isEmbedded && sub.index !== undefined) {
        return {...sub, uri: withSubtitleDelay(`${parsedDelivery.origin}/subtitle/${sessionId}/${sub.index}.vtt`), contentType: 'text/vtt'};
      }
      if (!sub.isEmbedded && isServableExternalSubtitle(sub.uri)) {
        const isTtml = /\.(?:ttml|dfxp)(?:[?#]|$)/i.test(sub.uri);
        return {...sub,
          uri: withSubtitleDelay(`${parsedDelivery.origin}/extsub/${sessionId}/${ordinal}.${isTtml ? 'ttml' : 'vtt'}?u=${encodeURIComponent(sub.uri)}`),
          contentType: isTtml ? 'application/ttml+xml' : 'text/vtt',
        };
      }
      return undefined;
    }).filter((sub): sub is NonNullable<typeof sub> => Boolean(sub));

    const mediaTracks = validSubs.map((sub, idx) => ({
      id: idx + 1,
      type: 'text' as const,
      subtype: 'subtitles' as const,
      contentId: sub.uri,
      contentType: sub.contentType,
      language: sub.language || 'und',
      name: sub.title || sub.language || `Subtitle ${idx + 1}`,
    }));

    this.registeredCastTrackIds = new Map(
      validSubs.map((sub, idx) => [sub.id, idx + 1]),
    );
    this.registeredSubtitleUrls = new Map(
      validSubs.map(sub => [sub.id, sub.uri!]),
    );

    const isMkv =
      mediaUrl.toLowerCase().includes('.mkv') ||
      mediaUrl.toLowerCase().includes('matroska');
    const sourceType = payload.sourceType?.toLowerCase();
    const isHls =
      sourceType === 'm3u8' ||
      sourceType === 'hls' ||
      mediaUrl.includes('.m3u8');
    const isDash =
      sourceType === 'mpd' ||
      sourceType === 'dash' ||
      mediaUrl.includes('.mpd');
    const isWebm =
      sourceType === 'webm' || mediaUrl.toLowerCase().includes('.webm');
    const contentType =
      preparedMimeType === 'application/vnd.apple.mpegurl'
        ? 'application/x-mpegurl'
        : preparedMimeType ||
          (isHls
            ? 'application/vnd.apple.mpegurl'
            : isDash
              ? 'application/dash+xml'
              : isWebm
                ? 'video/webm'
                : isMkv
                  ? 'video/x-matroska'
                  : 'video/mp4');

    const safeStartTime =
      typeof payload.initialPosition === 'number' &&
      Number.isFinite(payload.initialPosition) &&
      payload.initialPosition > 0
        ? Math.max(0, payload.initialPosition - timelineOffset)
        : 0;

    const hasValidArtwork = Boolean(
      payload.artwork && /^https?:\/\//i.test(payload.artwork),
    );

    const loadRequest: any = {
      autoplay: true,
      playbackRate: 1,
      mediaInfo: {
        contentUrl: mediaUrl,
        contentType,
        streamType: 'buffered',
        // The phone's HLS output is MPEG-TS with AAC audio muxed in.
        ...(/^https?:\/\/[^/]+\/hlsout\//.test(mediaUrl)
          ? {hlsSegmentFormat: 'TS', hlsVideoSegmentFormat: 'MPEG2-TS'}
          : {}),
        ...(sourceDuration > timelineOffset
          ? {streamDuration: sourceDuration - timelineOffset}
          : {}),
        mediaTracks: mediaTracks.length > 0 ? mediaTracks : undefined,
        metadata: {
          title: payload.title || 'Vega Media',
          subtitle: payload.subtitle || undefined,
          images: hasValidArtwork ? [{url: payload.artwork!}] : undefined,
          type: 'generic',
        },
      },
    };

    if (safeStartTime > 0) {
      loadRequest.startTime = safeStartTime;
    }

    // Full request for manual testing: open contentUrl in VLC/ffplay/a browser on the same Wi-Fi.
    console.info('[CastLoad] request', {
      receiverIp: castDevice?.ipAddress || 'unknown',
      contentUrl: sanitizeUrlForLog(mediaUrl),
      contentType,
      startTime: loadRequest.startTime ?? 0,
      streamDuration: loadRequest.mediaInfo.streamDuration,
      subtitleUrls: mediaTracks.map(track =>
        sanitizeUrlForLog(track.contentId),
      ),
      source: sanitizeUrlForLog(payload.sourceUrl),
    });

    try {
      const selectedId = useRemoteStore.getState().activeSubtitleTrackId;
      await this.prepareSubtitleForPlayback(
        selectedId ? this.registeredSubtitleUrls.get(selectedId) : undefined,
        operationToken,
      );
      await this.awaitPlaybackOperation(
        client.loadMedia(loadRequest),
        operationToken,
      );
      this.lastCastStreamPosition = null;
      this.ignoreCastReceiverSeekUntil = Date.now() + 3500;
      console.info('[CastLoad] accepted by receiver', {
        contentUrl: sanitizeUrlForLog(mediaUrl),
      });
      const selectedSubtitleId =
        useRemoteStore.getState().activeSubtitleTrackId;
      const selectedCastTrackId = selectedSubtitleId
        ? this.registeredCastTrackIds.get(selectedSubtitleId)
        : undefined;
      if (selectedCastTrackId !== undefined) {
        await this.awaitPlaybackOperation(
          client.setActiveTrackIds([selectedCastTrackId]),
          operationToken,
        );
      }
    } catch (err: any) {
      console.warn('Cast loadMedia rejected:', err);
      throw err;
    }
  }

  async setActiveSubtitleTrack(trackId?: string): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.command('SUBTITLE',trackId==null?-1:Number(trackId));
    if (this.changingAudio)
      throw new Error('A remote track change or seek is already in progress');
    const operationToken = this.loadGeneration;
    const entryGen = this.playbackGeneration;

    return this.enqueueOperation(async () => {
      if (entryGen !== this.playbackGeneration || this.ending) return;

      const device = useRemoteStore.getState().connectedDevice;
      if (!device) return;

      this.playbackGeneration++;
      this.changingAudio = true;
      const previousTrackId = useRemoteStore.getState().activeSubtitleTrackId;

      try {
        if (device.type === 'dlna') {
          // Finish extraction before capturing the resume position or changing
          // selection. A slow/failed track must not restart the playing video.
          try {
            await this.prepareSubtitleForPlayback(
              this.resolveActiveSubtitleUrl(this.activePlayUrl, trackId ?? null),
              operationToken,
            );
          } catch (error: any) {
            if (!isRemotePlaybackCanceled(error)) {
              useRemoteStore.getState().setErrorMessage(error?.message || 'Unable to prepare subtitles');
            }
            throw error;
          }
          const previousSessionId = this.currentSessionId;
          const previousPlayUrl = this.activePlayUrl;
          const previousMimeType = this.activeMimeType;
          const previousOffset = this.timelineOffset;
          const previousDuration = this.sourceDuration;
          const currentPos = useRemoteStore.getState().currentTime;
          const wasPaused = useRemoteStore.getState().status === 'paused';
          const previousStatus = useRemoteStore.getState().status;
          let nextSessionId: string | null = null;
          let nextSessionLoadedOnDevice = false;
          let prep: any = null;

          try {
            useRemoteStore.getState().setActiveSubtitleTrackId(trackId);
            if (this.activePlayUrl && device.controlUrl) {
              if (this.activeRemux && this.activePayload) {
                const audioTrack =
                  useRemoteStore
                    .getState()
                    .audioTracks.find(
                      t =>
                        t.id === useRemoteStore.getState().activeAudioTrackId,
                    ) || useRemoteStore.getState().audioTracks[0];
                nextSessionId = `session_${Crypto.randomUUID()}`;
                prep = await this.awaitPlaybackOperation(
                  this.preparePlaybackStream(
                    {
                      sessionId: nextSessionId,
                      sourceUrl: this.activePayload.sourceUrl,
                      isLocal: this.activePayload.isLocal,
                      headers: this.activePayload.headers,
                      audioTrackIndex: audioTrack?.index ?? 0,
                      mode: 'ffmpeg',
                      startPositionSeconds: currentPos,
                      audioCodec: audioTrack?.codec,
                      durationSeconds:
                        this.sourceDuration ||
                        useRemoteStore.getState().duration ||
                        0,
                    },
                    operationToken,
                  ),
                  operationToken,
                );
                const newSubUrl = this.resolveActiveSubtitleUrl(
                  prep.streamUrl,
                  trackId ?? null,
                );
                nextSessionLoadedOnDevice = true;
                await this.awaitPlaybackOperation(
                  this.loadOnDlna(
                    device,
                    prep.streamUrl,
                    this.activePayload.title || 'Vega Playback',
                    newSubUrl,
                    prep.timelineOffsetSeconds || 0,
                    prep.durationSeconds || this.sourceDuration,
                    () =>
                      operationToken === this.loadGeneration && !this.ending,
                  ),
                  operationToken,
                );
                if (wasPaused) {
                  await this.awaitPlaybackOperation(
                    dlnaService.pause(device).catch(() => {}),
                    operationToken,
                  );
                  useRemoteStore.getState().setStatus('paused');
                }

                this.currentSessionId = nextSessionId;
                this.operationSessions.delete(operationToken);
                this.activePlayUrl = prep.streamUrl;
                this.activeMimeType = prep.mimeType;
                this.timelineOffset = prep.timelineOffsetSeconds || 0;
                this.sourceDuration =
                  prep.durationSeconds || this.sourceDuration;

                if (previousSessionId && previousSessionId !== nextSessionId) {
                  this.releaseSessionLater(previousSessionId);
                }
              } else {
                const newSubUrl = this.resolveActiveSubtitleUrl(
                  this.activePlayUrl,
                  trackId ?? null,
                );
                await this.awaitPlaybackOperation(
                  this.loadOnDlna(
                    device,
                    this.activePlayUrl,
                    this.activePayload?.title || 'Vega Playback',
                    newSubUrl,
                    previousOffset,
                    this.sourceDuration,
                    () =>
                      operationToken === this.loadGeneration && !this.ending,
                  ),
                  operationToken,
                );
                if (currentPos > previousOffset) {
                  await this.awaitPlaybackOperation(
                    dlnaService.seek(device, currentPos).catch(() => {}),
                    operationToken,
                  );
                }
                if (wasPaused) {
                  await this.awaitPlaybackOperation(
                    dlnaService.pause(device).catch(() => {}),
                    operationToken,
                  );
                  useRemoteStore.getState().setStatus('paused');
                }
              }
            }
            return;
          } catch (err: any) {
            this.assertPlaybackOperation(operationToken);
            console.warn('DLNA subtitle selection failed:', err);
            let restored = false;
            if (
              nextSessionLoadedOnDevice &&
              previousPlayUrl &&
              device.controlUrl
            ) {
              try {
                const restoredSubUrl = this.resolveActiveSubtitleUrl(
                  previousPlayUrl,
                  previousTrackId ?? null,
                );
                await this.awaitPlaybackOperation(
                  this.loadOnDlna(
                    device,
                    previousPlayUrl,
                    this.activePayload?.title || 'Vega Playback',
                    restoredSubUrl,
                    previousOffset,
                    previousDuration,
                    () =>
                      operationToken === this.loadGeneration && !this.ending,
                  ),
                  operationToken,
                );
                if (currentPos > previousOffset) {
                  await this.awaitPlaybackOperation(
                    dlnaService.seek(device, currentPos).catch(() => {}),
                    operationToken,
                  );
                }
                if (wasPaused) {
                  await this.awaitPlaybackOperation(
                    dlnaService.pause(device).catch(() => {}),
                    operationToken,
                  );
                  useRemoteStore.getState().setStatus('paused');
                } else {
                  useRemoteStore.getState().setStatus('playing');
                }
                restored = true;
              } catch (restoreError) {
                this.assertPlaybackOperation(operationToken);
                console.warn(
                  'Failed to restore previous DLNA stream on subtitle change failure:',
                  restoreError,
                );
              }
            }

            if (!nextSessionLoadedOnDevice || restored) {
              this.currentSessionId = previousSessionId;
              this.activePlayUrl = previousPlayUrl;
              this.activeMimeType = previousMimeType;
              this.timelineOffset = previousOffset;
              this.sourceDuration = previousDuration;
              dlnaService.setTimelineContext(previousOffset, previousDuration);
              useRemoteStore
                .getState()
                .setActiveSubtitleTrackId(previousTrackId);
              useRemoteStore
                .getState()
                .setStatus(wasPaused ? 'paused' : previousStatus);

              if (nextSessionId) {
                await this.awaitPlaybackOperation(
                  remoteDeliveryService
                    .cleanupSession(nextSessionId)
                    .catch(() => {}),
                  operationToken,
                );
              }
            } else {
              await this.awaitPlaybackOperation(
                this.handleFailedRestoration({
                  device,
                  previousSessionId,
                  nextSessionId,
                  previousState: {
                    playUrl: previousPlayUrl,
                    mimeType: previousMimeType,
                    timelineOffset: previousOffset,
                    sourceDuration: previousDuration,
                    engine: this.activeRemuxEngine,
                    byteRangeSeek: this.activeByteRangeSeek,
                    subtitleTrackId: previousTrackId ?? null,
                    status: wasPaused ? 'paused' : previousStatus,
                  },
                  nextState:
                    prep && nextSessionId
                      ? {
                          playUrl: prep.streamUrl,
                          mimeType: prep.mimeType,
                          timelineOffset: prep.timelineOffsetSeconds || 0,
                          sourceDuration:
                            prep.durationSeconds || this.sourceDuration,
                          engine: 'ffmpeg',
                          byteRangeSeek: false,
                          subtitleTrackId: trackId ?? null,
                        }
                      : undefined,
                }),
                operationToken,
              );
            }

            if (!isRemotePlaybackCanceled(err))

              useRemoteStore.getState().setErrorMessage(err?.message || 'Unable to change subtitles');
            throw err;
          }
        }

        const client = this.getCastClient();
        if (!client)
          throw new Error('Subtitle switching is unavailable on this device');

        try {
          if (!trackId) {
            if (this.registeredCastTrackIds.size > 0) {
              await this.awaitPlaybackOperation(
                client.setActiveTrackIds([]),
                operationToken,
              );
            }
          } else {
            const subs = useRemoteStore.getState().subtitleTracks;
            const sub = subs.find(s => s.id === trackId);
            let castTrackId = this.registeredCastTrackIds.get(trackId);
            // Chromecast takes text tracks only with the load, so a file added
            // during playback needs a reload at the current position.
            if (sub && castTrackId === undefined && !this.activeRemux &&
                !sub.isEmbedded && isServableExternalSubtitle(sub.uri)) {
              await this.reloadCastWithSubtitles(operationToken);
              castTrackId = this.registeredCastTrackIds.get(trackId);
            }
            if (!sub || castTrackId === undefined) {
              throw new Error(
                'This subtitle track is not available on Chromecast',
              );
            }
            {
              const subtitleUrl = this.registeredSubtitleUrls.get(trackId);
              if (!subtitleUrl)
                throw new Error('Subtitle URL is unavailable');
              await this.prepareSubtitleForPlayback(subtitleUrl, operationToken);
            }
            await this.awaitPlaybackOperation(
              client.setActiveTrackIds([castTrackId]),
              operationToken,
            );
          }
          useRemoteStore.getState().setActiveSubtitleTrackId(trackId);
        } catch (e: any) {
          this.assertPlaybackOperation(operationToken);
          console.warn('Cast subtitle selection failed:', e);
          useRemoteStore.getState().setActiveSubtitleTrackId(previousTrackId);
          if (!isRemotePlaybackCanceled(e))
            useRemoteStore.getState().setErrorMessage(e?.message || 'Unable to change subtitles');
          throw e;
        }
      } finally {
        await this.cleanupCanceledOperation(operationToken);
        if (operationToken === this.loadGeneration) this.changingAudio = false;
      }
    });
  }

  /**
   * Adds a subtitle file or web URL to the cast and selects it. Picked files
   * must be copies in the app cache; the phone server serves nothing else.
   */
  async addExternalSubtitle(track: {
    savedSubtitleId?: string;
    uri: string;
    title?: string;
    language?: string;
  }): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.addExternalSubtitle(track.uri);
    if (!isServableExternalSubtitle(track.uri))
      throw new Error('This subtitle file cannot be sent to the receiver');
    const store = useRemoteStore.getState();
    const existing = store.subtitleTracks.find(
      sub => !sub.isEmbedded && sub.uri === track.uri,
    );
    const id = existing?.id || `external-${Crypto.randomUUID()}`;
    if (!existing) {
      // Append: track ordinals are part of the URLs already given to the receiver.
      store.setSubtitleTracks([
        ...store.subtitleTracks,
        {
          id,
          uri: track.uri,
          savedSubtitleId: track.savedSubtitleId,
          title: track.title,
          language: track.language || 'und',
          isEmbedded: false,
        },
      ]);
    }
    // A remuxed Chromecast stream restarts through the audio reload, which
    // registers every subtitle and selects the active one after the load.
    if (
      !this.registeredCastTrackIds.has(id) &&
      this.activeRemux &&
      useRemoteStore.getState().connectedDevice?.type === 'cast'
    ) {
      const {audioTracks, activeAudioTrackId, currentTime} =
        useRemoteStore.getState();
      const audioTrack =
        audioTracks.find(audio => audio.id === activeAudioTrackId) ||
        audioTracks[0];
      const previousTrackId = useRemoteStore.getState().activeSubtitleTrackId;
      useRemoteStore.getState().setActiveSubtitleTrackId(id);
      try {
        await this.switchAudioTrack(audioTrack, currentTime);
      } catch (err) {
        if (useRemoteStore.getState().activeSubtitleTrackId === id)
          useRemoteStore.getState().setActiveSubtitleTrackId(previousTrackId);
        throw err;
      }
      if (!this.registeredCastTrackIds.has(id)) {
        useRemoteStore.getState().setActiveSubtitleTrackId(previousTrackId);
        useRemoteStore
          .getState()
          .setErrorMessage('This subtitle cannot be sent to Chromecast');
      }
      return;
    }
    await this.setActiveSubtitleTrack(id);
  }

  /** Loads the current Chromecast media again with the current subtitle list. */
  private async reloadCastWithSubtitles(operationToken: number): Promise<void> {
    const payload = this.activePayload;
    if (!payload || !this.activePlayUrl)
      throw new Error('Nothing is playing on the receiver');
    const position = useRemoteStore.getState().currentTime;
    let subtitleDeliveryUrl: string | undefined;
    // A direct video has no phone session unless it started with external
    // subtitles; register one so the receiver can fetch the new file.
    if (!/^\/(ffmpeg|hlsout|dlna|proxy|hls)\//.test(new URL(this.activePlayUrl).pathname)) {
      const previousSessionId = this.currentSessionId;
      const sessionId = `session_${Crypto.randomUUID()}`;
      const session = await this.awaitPlaybackOperation(
        this.preparePlaybackStream(
          {
            sessionId,
            sourceUrl: payload.sourceUrl,
            headers: payload.headers,
            mode: 'proxy',
            durationSeconds: this.sourceDuration,
          },
          operationToken,
        ),
        operationToken,
      );
      subtitleDeliveryUrl = session.streamUrl;
      this.currentSessionId = sessionId;
      if (previousSessionId && previousSessionId !== sessionId)
        remoteDeliveryService.cleanupSession(previousSessionId).catch(() => {});
    }
    await this.loadOnCast(
      this.activePlayUrl,
      {...payload, initialPosition: position},
      this.activeMimeType,
      this.timelineOffset,
      this.sourceDuration,
      subtitleDeliveryUrl,
    );
  }

  async switchAudioTrack(
    track: RemoteAudioTrack,
    seekPosition?: number,
  ): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.command('AUDIO',Number(track.id));
    return this.reloadRemuxedStream(track, seekPosition);
  }

  private async reloadRemuxedStream(
    track: RemoteAudioTrack | undefined,
    seekPosition?: number,
  ): Promise<void> {
    if (isTV || !this.activePayload) return;
    if (this.changingAudio)
      throw new Error('A remote track change or seek is already in progress');

    const device = useRemoteStore.getState().connectedDevice;
    if (!device) return;

    const previous = useRemoteStore.getState();
    if (seekPosition === undefined && track?.id === previous.activeAudioTrackId)
      return;

    const operationToken = this.loadGeneration;
    const entryGen = this.playbackGeneration;

    return this.enqueueOperation(async () => {
      if (
        entryGen !== this.playbackGeneration ||
        this.ending ||
        !this.activePayload
      )
        return;

      const currentDevice = useRemoteStore.getState().connectedDevice;
      if (!currentDevice) return;

      const currentState = useRemoteStore.getState();
      if (
        seekPosition === undefined &&
        track?.id === currentState.activeAudioTrackId
      )
        return;

      this.playbackGeneration++;
      this.changingAudio = true;

      const device = currentDevice;
      const currentPosition = seekPosition ?? currentState.currentTime;
      const previousOffset = this.timelineOffset;
      const previousSessionId = this.currentSessionId;
      const previousPlayUrl = this.activePlayUrl;
      const previousMimeType = this.activeMimeType;
      const previousEngine = this.activeRemuxEngine;
      const previousByteRangeSeek = this.activeByteRangeSeek;
      const previousDuration = this.sourceDuration;
      const mediaDuration = this.sourceDuration || currentState.duration || 0;
      const nextSessionId = `session_${Crypto.randomUUID()}`;
      let nextSessionLoadedOnDevice = false;
      let prep: any = null;
      let usedEngine: 'hls' | 'ffmpeg' = 'ffmpeg';
      useRemoteStore.getState().setErrorMessage(undefined);
      useRemoteStore.getState().setStatus('buffering');

      try {
        const sourceUrl = this.activePayload.sourceUrl;
        if (!this.activeRemux) {
          throw new Error(
            'This stream has a single audio track on the receiver',
          );
        }

        const targetMode: 'hls' | 'ffmpeg' =
          device.type === 'cast' &&
          this.isCastHlsEnabled() &&
          !this.activeIsManifest
            ? 'hls'
            : 'ffmpeg';

        usedEngine = targetMode;

        if (targetMode === 'hls') {
          try {
            prep = await this.awaitPlaybackOperation(
              this.preparePlaybackStream(
                {
                  sessionId: nextSessionId,
                  sourceUrl,
                  isLocal: this.activePayload.isLocal,
                  headers: this.activePayload.headers,
                  audioTrackIndex: track?.index ?? 0,
                  mode: 'hls',
                  startPositionSeconds: currentPosition,
                  audioCodec: track?.codec,
                  durationSeconds: mediaDuration,
                  mimeType: 'video/mp4',
                },
                operationToken,
              ),
              operationToken,
            );
            if (!prep.byteRangeSeek) {
              console.info(
                '[Cast] HLS output unavailable for audio switch, falling back to ffmpeg',
              );
              await this.awaitPlaybackOperation(
                remoteDeliveryService
                  .cleanupSession(nextSessionId)
                  .catch(() => {}),
                operationToken,
              );
              prep = await this.awaitPlaybackOperation(
                this.preparePlaybackStream(
                  {
                    sessionId: nextSessionId,
                    sourceUrl,
                    isLocal: this.activePayload.isLocal,
                    headers: this.activePayload.headers,
                    audioTrackIndex: track?.index ?? 0,
                    mode: 'ffmpeg',
                    startPositionSeconds: currentPosition,
                    audioCodec: track?.codec,
                    durationSeconds: mediaDuration,
                    mimeType: 'video/mp4',
                  },
                  operationToken,
                ),
                operationToken,
              );
              usedEngine = 'ffmpeg';
            }
          } catch (err) {
            this.assertPlaybackOperation(operationToken);
            console.warn(
              '[Cast] HLS audio switch failed, falling back to ffmpeg:',
              err,
            );
            await this.awaitPlaybackOperation(
              remoteDeliveryService
                .cleanupSession(nextSessionId)
                .catch(() => {}),
              operationToken,
            );
            prep = await this.awaitPlaybackOperation(
              this.preparePlaybackStream(
                {
                  sessionId: nextSessionId,
                  sourceUrl,
                  isLocal: this.activePayload.isLocal,
                  headers: this.activePayload.headers,
                  audioTrackIndex: track?.index ?? 0,
                  mode: 'ffmpeg',
                  startPositionSeconds: currentPosition,
                  audioCodec: track?.codec,
                  durationSeconds: mediaDuration,
                  mimeType: 'video/mp4',
                },
                operationToken,
              ),
              operationToken,
            );
            usedEngine = 'ffmpeg';
          }
        } else {
          prep = await this.awaitPlaybackOperation(
            this.preparePlaybackStream(
              {
                sessionId: nextSessionId,
                sourceUrl,
                isLocal: this.activePayload.isLocal,
                headers: this.activePayload.headers,
                audioTrackIndex: track?.index ?? 0,
                mode: 'ffmpeg',
                startPositionSeconds: currentPosition,
                audioCodec: track?.codec,
                durationSeconds: mediaDuration,
                mimeType: 'video/mp4',
              },
              operationToken,
            ),
            operationToken,
          );
          usedEngine = 'ffmpeg';
        }

        nextSessionLoadedOnDevice = true;
        if (device.type === 'cast') {
          await this.awaitPlaybackOperation(
            this.loadOnCast(
              prep.streamUrl,
              {
                ...this.activePayload,
                initialPosition: currentPosition,
              },
              prep.mimeType,
              prep.timelineOffsetSeconds,
              prep.durationSeconds,
            ),
            operationToken,
          );
        } else {
          const dlnaSubUrl = this.resolveActiveSubtitleUrl(prep.streamUrl);
          await this.awaitPlaybackOperation(
            this.loadOnDlna(
              device,
              prep.streamUrl,
              this.activePayload.title,
              dlnaSubUrl,
              prep.timelineOffsetSeconds || 0,
              prep.durationSeconds || mediaDuration,
              () => operationToken === this.loadGeneration && !this.ending,
            ),
            operationToken,
          );
          // Only send renderer seek if the stream was NOT already offset via timelineOffsetSeconds
          if (!prep.timelineOffsetSeconds && currentPosition > 0) {
            await this.awaitPlaybackOperation(
              dlnaService.seek(device, currentPosition).catch(() => {}),
              operationToken,
            );
          }
        }
        if (currentState.status === 'paused') {
          if (device.type === 'cast') {
            await this.awaitPlaybackOperation(
              this.castClient?.pause() ?? Promise.resolve(),
              operationToken,
            );
          } else {
            await this.awaitPlaybackOperation(
              dlnaService.pause(device),
              operationToken,
            );
          }
        }

        this.currentSessionId = nextSessionId;
                this.operationSessions.delete(operationToken);
        this.activePlayUrl = prep.streamUrl;
        this.activeMimeType = prep.mimeType;
        this.timelineOffset = prep.timelineOffsetSeconds || 0;
        this.activeByteRangeSeek = Boolean(prep.byteRangeSeek);
        this.sourceDuration = prep.durationSeconds || mediaDuration;
        this.activeRemuxEngine = usedEngine;
        useRemoteStore.getState().setActiveAudioTrackId(track?.id ?? currentState.activeAudioTrackId);
        if (currentState.status === 'paused')
          useRemoteStore.getState().setStatus('paused');
        if (previousSessionId && previousSessionId !== nextSessionId) {
          this.releaseSessionLater(previousSessionId, nextSessionId);
        }
      } catch (e: any) {
        this.assertPlaybackOperation(operationToken);
        console.warn('Audio track switch failed:', e);
        let restored = false;
        if (nextSessionLoadedOnDevice && previousPlayUrl) {
          try {
            if (device.type === 'cast') {
              await this.awaitPlaybackOperation(
                this.loadOnCast(
                  previousPlayUrl,
                  {
                    ...this.activePayload,
                    initialPosition: currentState.currentTime,
                  },
                  previousMimeType,
                  previousOffset,
                  previousDuration,
                ),
                operationToken,
              );
            } else {
              const restoredSubUrl =
                this.resolveActiveSubtitleUrl(previousPlayUrl);
              await this.awaitPlaybackOperation(
                this.loadOnDlna(
                  device,
                  previousPlayUrl,
                  this.activePayload.title,
                  restoredSubUrl,
                  previousOffset,
                  previousDuration,
                  () => operationToken === this.loadGeneration && !this.ending,
                ),
                operationToken,
              );
              if (currentPosition > previousOffset)
                await this.awaitPlaybackOperation(
                  dlnaService.seek(device, currentPosition).catch(() => {}),
                  operationToken,
                );
            }
            if (currentState.status === 'paused') {
              if (device.type === 'cast')
                await this.awaitPlaybackOperation(
                  this.castClient?.pause() ?? Promise.resolve(),
                  operationToken,
                );
              else
                await this.awaitPlaybackOperation(
                  dlnaService.pause(device),
                  operationToken,
                );
            }
            restored = true;
          } catch (restoreError) {
            this.assertPlaybackOperation(operationToken);
            console.warn(
              'Previous remote stream could not be restored on audio switch failure:',
              restoreError,
            );
          }
        }

        if (!nextSessionLoadedOnDevice || restored) {
          this.currentSessionId = previousSessionId;
          this.activePlayUrl = previousPlayUrl;
          this.activeMimeType = previousMimeType;
          this.timelineOffset = previousOffset;
          this.sourceDuration = previousDuration;
          this.activeRemuxEngine = previousEngine;
          this.activeByteRangeSeek = previousByteRangeSeek;
          if (device.type === 'dlna') {
            dlnaService.setTimelineContext(previousOffset, previousDuration);
          }
          useRemoteStore
            .getState()
            .setActiveAudioTrackId(currentState.activeAudioTrackId);
          useRemoteStore.getState().setStatus(currentState.status);

          if (nextSessionId) {
            await this.awaitPlaybackOperation(
              remoteDeliveryService
                .cleanupSession(nextSessionId)
                .catch(() => {}),
              operationToken,
            );
          }
        } else {
          await this.awaitPlaybackOperation(
            this.handleFailedRestoration({
              device,
              previousSessionId,
              nextSessionId,
              previousState: {
                playUrl: previousPlayUrl,
                mimeType: previousMimeType,
                timelineOffset: previousOffset,
                sourceDuration: previousDuration,
                engine: previousEngine,
                byteRangeSeek: previousByteRangeSeek,
                audioTrackId: currentState.activeAudioTrackId,
                status: currentState.status,
              },
              nextState:
                prep && nextSessionId
                  ? {
                      playUrl: prep.streamUrl,
                      mimeType: prep.mimeType,
                      timelineOffset: prep.timelineOffsetSeconds || 0,
                      sourceDuration: prep.durationSeconds || mediaDuration,
                      engine: usedEngine,
                      byteRangeSeek: Boolean(prep.byteRangeSeek),
                      audioTrackId: track?.id ?? currentState.activeAudioTrackId,
                    }
                  : undefined,
            }),
            operationToken,
          );
        }

        if (!isRemotePlaybackCanceled(e))

          useRemoteStore.getState().setErrorMessage(e?.message || 'Unable to switch audio track');
        throw e;
      } finally {
        await this.cleanupCanceledOperation(operationToken);
        if (operationToken === this.loadGeneration) this.changingAudio = false;
      }
    });
  }

  async switchQuality(
    quality: RemoteQuality,
    newSourceUrl?: string,
  ): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast'){
      if(!this.activePayload||!newSourceUrl)throw new Error('Choose a resolved stream first');
      this.activePayload={...this.activePayload,sourceUrl:newSourceUrl,initialPosition:useRemoteStore.getState().currentTime};
      return this.loadVegaCast(useRemoteStore.getState().connectedDevice!,this.activePayload);
    }
    if (isTV || !this.activePayload) return;

    const device = useRemoteStore.getState().connectedDevice;
    if (!device) return;

    const currentPosition = useRemoteStore.getState().currentTime;
    const previousPayload = this.activePayload;
    const previousQualityId = useRemoteStore.getState().activeQualityId;
    if (!newSourceUrl) {
      const message = 'This quality cannot be selected on the remote receiver';
      useRemoteStore.getState().setErrorMessage(message);
      throw new Error(message);
    }
    useRemoteStore.getState().setStatus('buffering');

    const operationToken = this.loadGeneration + 1;
    try {
      await this.queueLoad(
        device,
        {
          ...previousPayload,
          sourceUrl: newSourceUrl,
          initialPosition: currentPosition,
        },
        true,
      );
      this.assertPlaybackOperation(operationToken);
      useRemoteStore.getState().setActiveQualityId(quality.id);
    } catch (e: any) {
      this.assertPlaybackOperation(operationToken);
      console.warn('Quality switch failed:', e);
      this.activePayload = previousPayload;
      useRemoteStore.getState().setActiveQualityId(previousQualityId);
      if (!isRemotePlaybackCanceled(e))
        useRemoteStore.getState().setErrorMessage(e?.message || 'Unable to change quality');
      throw e;
    }
  }

  async play(): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.command('PLAY');
    const status = useRemoteStore.getState().status;
    if (status === 'loading' || status === 'buffering' || status === 'error' || status === 'idle') return;
    const device = useRemoteStore.getState().connectedDevice;
    if (!device) return;

    try {
      if (device.type === 'cast' && this.castClient) {
        await this.castClient.play();
      } else if (device.type === 'dlna') {
        await dlnaService.play(device);
      }
      useRemoteStore.getState().setStatus('playing');
      remoteDeliveryService.updateMediaPlayback({isPlaying: true}).catch(() => {});
    } catch (e) {
      console.warn('Remote play failed:', e);
    }
  }

  async pause(): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.command('PAUSE');
    const device = useRemoteStore.getState().connectedDevice;
    if (!device) return;

    try {
      if (device.type === 'cast' && this.castClient) {
        await this.castClient.pause();
      } else if (device.type === 'dlna') {
        await dlnaService.pause(device);
      }
      useRemoteStore.getState().setStatus('paused');
      remoteDeliveryService.updateMediaPlayback({isPlaying: false}).catch(() => {});
    } catch (e) {
      console.warn('Remote pause failed:', e);
    }
  }

  private pendingSeekResolve: (() => void) | null = null;

  private cancelQueuedSeek(): void {
    if (this.pendingSeekTimer) clearTimeout(this.pendingSeekTimer);
    this.pendingSeekTimer = null;
    this.pendingSeekResolve?.();
    this.pendingSeekResolve = null;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekRequestId++;
    useRemoteStore.getState().cancelSeek();
  }

  private pendingSeekTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A switched-away session stays served for a while: a receiver may still be
   * opening its URL, and a 404 there makes Kodi stop the new one as well.
   */
  private releaseSessionLater(sessionId: string, nextSessionId = this.currentSessionId): void {
    // Leave the old URL/ring available, but stop its upstream read once the new
    // session has emitted media. Native deliberately does nothing before then.
    const previous = this.pendingRetirements.get(nextSessionId) || new Set<string>();
    previous.add(sessionId);
    this.pendingRetirements.set(nextSessionId, previous);
    this.confirmSessionHandover(this.lastReceiverUri);
    setTimeout(() => {
      this.pendingRetirements.get(nextSessionId)?.delete(sessionId);
      if (this.pendingRetirements.get(nextSessionId)?.size === 0) this.pendingRetirements.delete(nextSessionId);
      if (sessionId !== this.currentSessionId) {
        remoteDeliveryService.cleanupSession(sessionId).catch(() => {});
      }
    }, 20_000);
  }

  /**
   * Remuxed streams seek by reloading, so rapid taps (+10s, +10s) are merged
   * into one reload at the last target instead of several racing loads.
   */
  seek(seconds: number): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.command('SEEK',seconds);
    if (!Number.isFinite(seconds)) return Promise.resolve();
    if (!this.activeRemux) return this.seekNow(seconds);
    useRemoteStore
      .getState()
      .setTimeline(
        Math.max(0, seconds),
        this.sourceDuration || useRemoteStore.getState().duration,
      );
    if (this.pendingSeekTimer) clearTimeout(this.pendingSeekTimer);
    this.pendingSeekResolve?.();
    return new Promise(resolve => {
      this.pendingSeekResolve = resolve;
      this.pendingSeekTimer = setTimeout(() => {
        this.pendingSeekTimer = null;
        this.pendingSeekResolve = null;
        this.seekNow(seconds).then(resolve, resolve);
      }, 700);
    });
  }

  private async seekNow(seconds: number): Promise<void> {
    const device = useRemoteStore.getState().connectedDevice;
    if (!device) return;
    if (!Number.isFinite(seconds)) return;
    seconds = Math.max(
      0,
      Math.min(
        seconds,
        this.sourceDuration ||
          useRemoteStore.getState().duration ||
          Number.MAX_SAFE_INTEGER,
      ),
    );
    const requestId = ++this.seekRequestId;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    useRemoteStore.getState().setErrorMessage(undefined);
    useRemoteStore.getState().beginSeek(requestId, seconds);
    this.seekTimer = setTimeout(() => {
      if (useRemoteStore.getState().pendingSeek?.id !== requestId) return;
      useRemoteStore.getState().cancelSeek(requestId);
      useRemoteStore
        .getState()
        .setErrorMessage('The TV did not confirm the seek. Try again.');
    }, 30000);

    // Update the UI immediately, but finish an in-flight reload before issuing
    // the next one. Only the latest queued target needs to reach the receiver.
    const previousSeek = this.seekQueue;
    let finishSeek!: () => void;
    this.seekQueue = new Promise<void>(resolve => {
      finishSeek = resolve;
    });
    await previousSeek;
    if (
      requestId !== this.seekRequestId ||
      this.ending ||
      useRemoteStore.getState().connectedDevice?.id !== device.id
    ) {
      finishSeek();
      return;
    }

    try {
      if (device.type === 'cast' && this.castClient) {
        if (
          this.activeRemux &&
          (!this.activeByteRangeSeek || this.activeRemuxEngine === 'ffmpeg')
        ) {
          // Rebuild the stream starting at the new position via -ss
          const state = useRemoteStore.getState();
          const track =
            state.audioTracks.find(t => t.id === state.activeAudioTrackId) ||
            state.audioTracks[0];
          await this.reloadRemuxedStream(track, seconds);
        } else {
          await this.castClient.seek({
            position: Math.max(0, seconds - this.timelineOffset),
          });
        }
      } else if (device.type === 'dlna') {
        if (this.activeRemux && this.activeRemuxEngine === 'ffmpeg') {
          const state = useRemoteStore.getState();
          const track =
            state.audioTracks.find(t => t.id === state.activeAudioTrackId) ||
            state.audioTracks[0];
          await this.reloadRemuxedStream(track, seconds);
        } else {
          await dlnaService.seek(device, seconds);
        }
      }
      // A remux reload starts at the keyframe before the target, not the target itself.
      useRemoteStore
        .getState()
        .acknowledgeSeek(
          requestId,
          this.activeRemux && this.activeRemuxEngine === 'ffmpeg'
            ? this.timelineOffset
            : undefined,
        );
      remoteDeliveryService
        .updateMediaPlayback({position: seconds})
        .catch(() => {});
    } catch (e) {
      if (requestId !== this.seekRequestId) return;
      useRemoteStore.getState().cancelSeek(requestId);
      if (isRemotePlaybackCanceled(e)) return;
      console.warn('Remote seek failed:', e);
      useRemoteStore
        .getState()
        .setErrorMessage(e instanceof Error ? e.message : 'Remote seek failed');
    } finally {
      finishSeek();
    }
  }

  /** Reads the receiver volume into the store; false when it cannot be read. */
  async refreshVolume(): Promise<boolean> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast'){await vegaCastService.command('GET_STATE');return true;}
    const device = useRemoteStore.getState().connectedDevice;
    // A Chromecast session can outlive the cast screen, so no device in the
    // store still means a session may be open.
    if (!device && !this.castSessionActive) return false;
    try {
      if (!device || device.type === 'cast') {
        const session =
          await GoogleCast.getSessionManager().getCurrentCastSession();
        if (!session) return false;
        const [volume, muted] = await Promise.all([
          session.getVolume(),
          session.isMute(),
        ]);
        useRemoteStore.getState().setVolume(volume, muted);
        return true;
      }
      const volume = await dlnaService.getVolume(device);
      if (volume === undefined) return false;
      useRemoteStore.getState().setVolume(volume);
      return true;
    } catch (e) {
      console.warn('Remote volume read failed:', e);
      return false;
    }
  }

  async setVolume(volume: number): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')return vegaCastService.setVolume(volume);
    const device = useRemoteStore.getState().connectedDevice;
    if (!device && !this.castSessionActive) return;
    volume = Math.min(1, Math.max(0, volume));

    try {
      if (!device || device.type === 'cast') {
        // Device volume, as the TV remote and Google Home change it. Stream
        // volume would only scale this media below the device level.
        const session =
          await GoogleCast.getSessionManager().getCurrentCastSession();
        if (!session) throw new Error('Chromecast disconnected');
        session.setVolume(volume);
        if (useRemoteStore.getState().isMuted) session.setMute(false);
        useRemoteStore.getState().setVolume(volume, false);
        return;
      } else if (device.type === 'dlna') {
        await dlnaService.setVolume(device, Math.round(volume * 100));
      }
      useRemoteStore.getState().setVolume(volume);
    } catch (e) {
      console.warn('Remote setVolume failed:', e);
    }
  }

  private uriMatchesSessionOrUrl(
    uri: string,
    sessionId?: string | null,
    fullUrl?: string | null,
  ): boolean {
    if (!uri) return false;
    if (sessionId && uri.includes(sessionId)) return true;
    if (fullUrl) {
      if (uri === fullUrl) return true;
      try {
        const u1 = new URL(uri);
        const u2 = new URL(fullUrl);
        if (u1.pathname === u2.pathname) return true;
      } catch {}
    }
    return false;
  }

  private applySessionState(
    sessionId: string,
    state: AmbiguousSessionState,
    device: RemoteDevice,
  ): void {
    this.currentSessionId = sessionId;
    this.activePlayUrl = state.playUrl;
    this.activeMimeType = state.mimeType;
    this.timelineOffset = state.timelineOffset;
    this.sourceDuration = state.sourceDuration;
    this.activeRemuxEngine = state.engine;
    this.activeByteRangeSeek = state.byteRangeSeek;
    if (device.type === 'dlna') {
      dlnaService.setTimelineContext(
        state.timelineOffset,
        state.sourceDuration,
      );
    }
    if (state.subtitleTrackId !== undefined) {
      useRemoteStore
        .getState()
        .setActiveSubtitleTrackId(
          state.subtitleTrackId === null || state.subtitleTrackId === 'off'
            ? undefined
            : state.subtitleTrackId,
        );
    }
    if (state.audioTrackId !== undefined) {
      useRemoteStore.getState().setActiveAudioTrackId(state.audioTrackId);
    }
  }

  private async handleFailedRestoration(context: {
    device: RemoteDevice;
    previousSessionId?: string | null;
    nextSessionId?: string | null;
    previousState: AmbiguousSessionState;
    nextState?: AmbiguousSessionState;
  }): Promise<void> {
    const initialGeneration = this.playbackGeneration;
    const {device, previousSessionId, nextSessionId, previousState, nextState} =
      context;

    let activeUri: string | null = null;
    if (device.type === 'dlna') {
      activeUri = await dlnaService.getActiveUri(device).catch(() => null);
    }
    if (initialGeneration !== this.playbackGeneration || this.ending) {
      return;
    }

    if (activeUri) {
      if (
        previousSessionId &&
        this.uriMatchesSessionOrUrl(
          activeUri,
          previousSessionId,
          previousState.playUrl,
        )
      ) {
        console.info(
          '[Remote] Active URI confirmed on previous session after restoration error:',
          previousSessionId,
        );
        if (nextSessionId) {
          await remoteDeliveryService
            .cleanupSession(nextSessionId)
            .catch(() => {});
        }
        if (initialGeneration !== this.playbackGeneration || this.ending) {
          return;
        }
        this.applySessionState(previousSessionId, previousState, device);
        useRemoteStore.getState().setStatus('error');
        return;
      }
      if (
        nextSessionId &&
        nextState &&
        this.uriMatchesSessionOrUrl(activeUri, nextSessionId, nextState.playUrl)
      ) {
        console.info(
          '[Remote] Active URI confirmed on next session after restoration error:',
          nextSessionId,
        );
        if (previousSessionId && previousSessionId !== nextSessionId) {
          this.releaseSessionLater(previousSessionId, nextSessionId);
        }
        if (initialGeneration !== this.playbackGeneration || this.ending) {
          return;
        }
        this.applySessionState(nextSessionId, nextState, device);
        useRemoteStore.getState().setStatus('error');
        return;
      }
    }

    console.warn(
      '[Remote] Renderer URI unconfirmed after failed restoration. Keeping both sessions active:',
      {
        previousSessionId,
        nextSessionId,
      },
    );

    if (
      previousSessionId &&
      nextSessionId &&
      previousSessionId !== nextSessionId
    ) {
      this.ambiguousSessions.push({
        device,
        previousSessionId,
        nextSessionId,
        previousState,
        nextState,
      });
      this.startAmbiguousSessionPolling();
    }

    if (nextSessionId && nextState) {
      this.applySessionState(nextSessionId, nextState, device);
    } else if (previousSessionId) {
      this.applySessionState(previousSessionId, previousState, device);
    }
    useRemoteStore.getState().setStatus('error');
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.resolutionQueue.then(
      () => operation(),
      () => operation(),
    );
    this.resolutionQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private resolveAmbiguousSessions(activeUri: string): Promise<void> {
    const queuedGeneration = this.playbackGeneration;
    return this.enqueueOperation(async () => {
      await this.processAmbiguousResolution(activeUri, queuedGeneration);
    });
  }

  private async processAmbiguousResolution(
    activeUri: string,
    queuedGeneration: number,
  ): Promise<void> {
    if (!activeUri || this.ambiguousSessions.length === 0) return;
    if (
      queuedGeneration !== this.playbackGeneration ||
      this.ending ||
      this.changingAudio
    ) {
      return;
    }

    const remaining: AmbiguousSessionPair[] = [];

    for (const pair of this.ambiguousSessions) {
      if (
        queuedGeneration !== this.playbackGeneration ||
        this.ending ||
        this.changingAudio
      ) {
        return;
      }

      if (
        this.uriMatchesSessionOrUrl(
          activeUri,
          pair.previousSessionId,
          pair.previousState.playUrl,
        )
      ) {
        console.info(
          '[Remote] TV confirmed active on previous session:',
          pair.previousSessionId,
        );
        if (pair.nextSessionId) {
          await remoteDeliveryService
            .cleanupSession(pair.nextSessionId)
            .catch(() => {});
        }
        if (
          queuedGeneration !== this.playbackGeneration ||
          this.ending ||
          this.changingAudio
        ) {
          return;
        }
        this.applySessionState(
          pair.previousSessionId,
          pair.previousState,
          pair.device,
        );
        if (pair.previousState.status) {
          useRemoteStore.getState().setStatus(pair.previousState.status);
        }
      } else if (
        pair.nextSessionId &&
        pair.nextState &&
        this.uriMatchesSessionOrUrl(
          activeUri,
          pair.nextSessionId,
          pair.nextState.playUrl,
        )
      ) {
        console.info(
          '[Remote] TV confirmed active on next session:',
          pair.nextSessionId,
        );
        if (
          pair.previousSessionId &&
          pair.previousSessionId !== pair.nextSessionId
        ) {
          this.releaseSessionLater(pair.previousSessionId, pair.nextSessionId);
        }
        if (
          queuedGeneration !== this.playbackGeneration ||
          this.ending ||
          this.changingAudio
        ) {
          return;
        }
        this.applySessionState(pair.nextSessionId, pair.nextState, pair.device);
      } else {
        remaining.push(pair);
      }
    }

    if (
      queuedGeneration !== this.playbackGeneration ||
      this.ending ||
      this.changingAudio
    ) {
      return;
    }

    this.ambiguousSessions = remaining;
    if (this.ambiguousSessions.length === 0) {
      this.stopAmbiguousSessionPolling();
    }
  }

  private startAmbiguousSessionPolling(): void {
    if (this.ambiguousTimer || this.ambiguousSessions.length === 0) return;
    this.ambiguousTimer = setInterval(async () => {
      const currentGen = this.playbackGeneration;
      if (this.ambiguousSessions.length === 0 || this.ending || this.changingAudio) {
        if (this.ambiguousSessions.length === 0 || this.ending) {
          this.stopAmbiguousSessionPolling();
        }
        return;
      }
      for (const pair of [...this.ambiguousSessions]) {
        try {
          if (pair.device.type === 'dlna') {
            const uri = await dlnaService.getActiveUri(pair.device);
            if (currentGen !== this.playbackGeneration || this.ending || this.changingAudio) return;
            if (uri) {
              await this.resolveAmbiguousSessions(uri);
              if (currentGen !== this.playbackGeneration || this.ending || this.changingAudio) return;
            }
          }
        } catch {}
      }
    }, 1500);
  }

  private stopAmbiguousSessionPolling(): void {
    if (this.ambiguousTimer) {
      clearInterval(this.ambiguousTimer);
      this.ambiguousTimer = null;
    }
  }

  /** Ends remote playback: stops the receiver, the phone server, and clears state. */
  /**
   * Keeps a torrent running after its player closes while the receiver still
   * streams it. Returns false when the active media is not that torrent.
   */
  adoptTorrent(infoHash: string): boolean {
    if (!this.activePayload?.sourceUrl.includes(`/stream/${infoHash}/`)) {
      return false;
    }
    this.ownedTorrentHash = infoHash;
    return true;
  }

  // Deletes the adopted torrent unless [nextSourceUrl] still streams it.
  private releaseOwnedTorrent(nextSourceUrl?: string): void {
    const hash = this.ownedTorrentHash;
    if (!hash || nextSourceUrl?.includes(`/stream/${hash}/`)) return;
    this.ownedTorrentHash = null;
    torrentManager.deleteTorrent(hash, true).catch(() => {});
  }

  stop(): Promise<void> {
    console.info('[CastStatus] stop requested', {sessionId: this.currentSessionId});
    this.pendingRetirements.clear();
    this.lastReceiverUri = '';
    this.cancelQueuedSeek();
    this.ending = true;
    this.loadGeneration++;
    this.wakeSupersededOperations();
    this.playbackGeneration++;
    return this.enqueueOperation(() => this.stopPlayback());
  }

  private async stopPlayback(): Promise<void> {
    if(useRemoteStore.getState().connectedDevice?.type==='vega-cast')await vegaCastService.disconnect(true);
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekRequestId++;
    useRemoteStore.getState().cancelSeek();
    // Set first: the receiver reports IDLE/ERROR while the session closes.
    this.ending = true;
    this.playbackGeneration++;
    this.changingAudio = false;
    this.lastRequest = null;
    this.stopAmbiguousSessionPolling();
    const device = useRemoteStore.getState().connectedDevice;
    // Each step is best effort: the receiver or session may already be gone.
    if (device?.type === 'dlna') {
      await dlnaService.stop(device).catch(() => {});
    }
    try {
      // Also covers a session opened from the Cast button before any media loaded.
      const session =
        await GoogleCast.getSessionManager().getCurrentCastSession();
      if (session) await GoogleCast.getSessionManager().endCurrentSession(true);
    } catch {}

    dlnaService.stopPolling();
    for (const pair of this.ambiguousSessions) {
      if (pair.previousSessionId) {
        await remoteDeliveryService
          .cleanupSession(pair.previousSessionId)
          .catch(() => {});
      }
      if (pair.nextSessionId) {
        await remoteDeliveryService
          .cleanupSession(pair.nextSessionId)
          .catch(() => {});
      }
    }
    this.ambiguousSessions = [];

    await remoteDeliveryService.stopForegroundService().catch(() => {});
    await remoteDeliveryService.stopServer().catch(() => {});
    useRemoteStore.getState().resetSession();
    this.activePayload = null;
    this.releaseOwnedTorrent();
    this.castClient = null;
    this.activePlayUrl = '';
    this.activeMimeType = undefined;
    this.activeRemux = false;
    this.activeIsManifest = false;
    this.activeByteRangeSeek = false;
    this.activeRemuxEngine = null;
    this.activeContainer = undefined;
    this.timelineOffset = 0;
    this.sourceDuration = 0;
  }
}

export const remotePlaybackManager = new RemotePlaybackManager();
remotePlaybackManager.startVolumeKeys();
