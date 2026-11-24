import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {RemoteAudioTrack, RemoteQuality, RemoteSubtitleTrack} from './types';
import {fetchAndParseMkvHeader} from './mkvParser';

const {VegaRemoteDelivery} = NativeModules;

export interface RemotePlaybackNotificationOptions {
  title?: string;
  subtitle?: string;
  artwork?: string;
  isPlaying?: boolean;
  position?: number;
  duration?: number;
}

export interface DeliveryServerInfo {
  port: number;
  lanIp: string;
  baseUrl: string;
}

export interface PreparedStreamResult {
  sessionId: string;
  streamUrl: string;
  baseUrl: string;
  mimeType: string;
  timelineOffsetSeconds: number;
  durationSeconds: number;
  /** The packaged file serves byte ranges, so the receiver can seek it natively. */
  byteRangeSeek?: boolean;
}

export interface InspectedMediaResult {
  container?: 'matroska';
  audioTracks: RemoteAudioTrack[];
  subtitleTracks: RemoteSubtitleTrack[];
  videoQualities?: RemoteQuality[];
  durationSeconds: number;
  hasVideo: boolean;
}

interface HlsMasterInfo {
  audioTracks: RemoteAudioTrack[];
  /** Variants, highest first. The id is the absolute variant URL. */
  qualities: RemoteQuality[];
  /** Variant URL to rendition URLs, indexed by audio track index. */
  audioUrls: Map<string, string[]>;
}

class RemoteDeliveryService {
  private activeSessionId: string | null = null;
  private serverInfo: DeliveryServerInfo | null = null;
  private inspectionGeneration = 0;
  private inspections = new Map<string, {until: number; result: Promise<InspectedMediaResult>}>();

  async ensureServerStarted(): Promise<DeliveryServerInfo> {
    if (Platform.OS !== 'android' || !VegaRemoteDelivery) {
      throw new Error('Remote delivery server is only supported on Android');
    }

    if (this.serverInfo) {
      return this.serverInfo;
    }

    const info = await VegaRemoteDelivery.startServer();
    this.serverInfo = info;
    return info;
  }

  async stopServer(): Promise<void> {
    this.inspectionGeneration++;
    this.inspections.clear();
    this.hlsMasters.clear();
    if (!VegaRemoteDelivery) return;
    try {
      await VegaRemoteDelivery.stopServer();
      this.serverInfo = null;
      this.activeSessionId = null;
    } catch (e) {
      console.warn('Failed to stop remote delivery server:', e);
    }
  }

  /** Parsed HLS masters, keyed by master URL and by each variant URL. */
  private hlsMasters = new Map<string, HlsMasterInfo>();

  /**
   * Parses an HLS master playlist into video variants (highest first) and
   * audio renditions. Audio tracks are deduped by name and language; each
   * variant maps a track index to the rendition URL in its own AUDIO group.
   */
  private async fetchHlsMaster(
    sourceUrl: string,
    headers?: Record<string, string>,
  ): Promise<HlsMasterInfo | null> {
    const generation = this.inspectionGeneration;
    const cached = this.hlsMasters.get(sourceUrl);
    if (cached) return cached;
    try {
      const res = await fetch(sourceUrl, {headers: headers || {}});
      if (!res.ok) return null;
      const base = res.url || sourceUrl;
      const text = await res.text();
      const resolve = (uri: string) => {
        try {
          return new URL(uri, base).toString();
        } catch {
          return uri;
        }
      };
      const attr = (line: string, key: string) =>
        line.match(new RegExp(`(?:^|[:,])${key}=(?:"([^"]*)"|([^,]*))`))?.slice(1).find(v => v !== undefined);

      const renditions: {key: string; group: string; url: string}[] = [];
      const audioTracks: RemoteAudioTrack[] = [];
      const variants: {quality: RemoteQuality; audioGroup?: string}[] = [];
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MEDIA:') && attr(line, 'TYPE') === 'AUDIO') {
          const uri = attr(line, 'URI');
          if (!uri) continue;
          const language = attr(line, 'LANGUAGE') || 'und';
          const title = attr(line, 'NAME') || language;
          const key = `${title}|${language}`;
          renditions.push({key, group: attr(line, 'GROUP-ID') || '', url: resolve(uri)});
          if (!audioTracks.some(t => `${t.title}|${t.language}` === key)) {
            const index = audioTracks.length;
            audioTracks.push({id: String(index), index, language, title, isSelected: index === 0});
          }
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
          let uri = '';
          while (++i < lines.length) {
            const next = lines[i].trim();
            if (next && !next.startsWith('#')) {
              uri = next;
              break;
            }
          }
          if (!uri) continue;
          const [w, h] = (attr(line, 'RESOLUTION') || '').split('x').map(Number);
          const bitrate = Number(attr(line, 'AVERAGE-BANDWIDTH') || attr(line, 'BANDWIDTH')) || undefined;
          const url = resolve(uri);
          if (variants.some(v => v.quality.id === url)) continue;
          variants.push({
            quality: {
              id: url,
              label: h ? `${h}p` : bitrate ? `${Math.round(bitrate / 1000)} kbps` : `Variant ${variants.length + 1}`,
              resolution: w && h ? `${w}x${h}` : undefined,
              width: w || undefined,
              height: h || undefined,
              bitrate,
            },
            audioGroup: attr(line, 'AUDIO'),
          });
        }
      }
      variants.sort(
        (a, b) => (b.quality.height || 0) - (a.quality.height || 0) || (b.quality.bitrate || 0) - (a.quality.bitrate || 0),
      );

      const info: HlsMasterInfo = {
        audioTracks,
        qualities: variants.map(v => v.quality),
        audioUrls: new Map(),
      };
      for (const v of variants) {
        info.audioUrls.set(
          v.quality.id,
          audioTracks.map(t => {
            const key = `${t.title}|${t.language}`;
            const match =
              renditions.find(r => r.key === key && r.group === v.audioGroup) ||
              (v.audioGroup ? renditions.find(r => r.group === v.audioGroup) : undefined) ||
              renditions.find(r => r.key === key);
            return match?.url || '';
          }),
        );
      }
      if (generation !== this.inspectionGeneration) return info;
      this.hlsMasters.set(sourceUrl, info);
      for (const q of info.qualities) this.hlsMasters.set(q.id, info);
      return info;
    } catch {
      return null;
    }
  }

  async inspectTracks(
    sourceUrl: string,
    isLocal = false,
    headers?: Record<string, string>,
    sourceType?: string,
  ): Promise<InspectedMediaResult> {
    const key = JSON.stringify([sourceUrl, isLocal, sourceType,
      Object.entries(headers || {}).sort(([a], [b]) => a.localeCompare(b))]);
    const cached = this.inspections.get(key);
    if (!isLocal && cached && cached.until > Date.now()) return cached.result;
    const generation = this.inspectionGeneration;
    const result = this.inspectTracksUncached(sourceUrl, isLocal, headers, sourceType);
    if (isLocal) return result;
    const entry = {until: Date.now() + 10 * 60_000, result};
    this.inspections.set(key, entry);
    while (this.inspections.size > 8) this.inspections.delete(this.inspections.keys().next().value!);
    const discard = () => {
      if (this.inspections.get(key) === entry) this.inspections.delete(key);
    };
    result.then(info => {
      if (!info.hasVideo || generation !== this.inspectionGeneration) discard();
    }, discard);
    return result;
  }

  private async inspectTracksUncached(
    sourceUrl: string,
    isLocal: boolean,
    headers?: Record<string, string>,
    sourceType?: string,
  ): Promise<InspectedMediaResult> {
    const isManifest = sourceType?.toLowerCase() === 'm3u8' || sourceType?.toLowerCase() === 'hls' ||
      sourceType?.toLowerCase() === 'mpd' || sourceType?.toLowerCase() === 'dash' ||
      sourceUrl.toLowerCase().includes('.m3u8') || sourceUrl.toLowerCase().includes('.mpd') ||
      sourceUrl.toLowerCase().includes('/hls/') || sourceUrl.toLowerCase().includes('/dash/') ||
      /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(sourceUrl);
    if (isManifest) {
      // Muxed HLS audio is not probed; list the single stream so the sheet does not wait forever.
      const master = await this.fetchHlsMaster(sourceUrl, headers);
      return {
        audioTracks: master?.audioTracks.length
          ? master.audioTracks
          : [{id: '0', index: 0, language: 'und', title: 'Default', isSelected: true}],
        videoQualities: master?.qualities.length ? master.qualities : undefined,
        subtitleTracks: [],
        durationSeconds: 0,
        hasVideo: true,
      };
    }

    const isMkv = sourceType?.toLowerCase() === 'mkv' || sourceUrl.toLowerCase().includes('.mkv') || sourceUrl.toLowerCase().includes('matroska');

    if (isMkv && !isLocal) {
      try {
        const mkvResult = await fetchAndParseMkvHeader(sourceUrl, headers);
        if (mkvResult?.hasVideo && mkvResult.audioTracks.length > 0) {
          let duration = mkvResult.durationSeconds || 0;
          if (duration === 0 && VegaRemoteDelivery) {
            try {
              const nativeResult = await VegaRemoteDelivery.inspectMediaTracks(sourceUrl, isLocal, headers || {});
              if (nativeResult?.durationSeconds && nativeResult.durationSeconds > 0) {
                duration = nativeResult.durationSeconds;
              }
            } catch {}
          }
          return {
            container: 'matroska',
            audioTracks: mkvResult.audioTracks,
            subtitleTracks: mkvResult.subtitleTracks,
            videoQualities: mkvResult.videoQualities,
            durationSeconds: duration,
            hasVideo: mkvResult.hasVideo,
          };
        }
      } catch {}
    }

    if (!VegaRemoteDelivery) {
      return {audioTracks: [], subtitleTracks: [], durationSeconds: 0, hasVideo: false};
    }
    try {
      const nativeResult = await VegaRemoteDelivery.inspectMediaTracks(sourceUrl, isLocal, headers || {});
      // If native MediaExtractor dropped audio or subtitle tracks on MKV, enrich with direct EBML parsing
      if (
        isMkv &&
        (!nativeResult.audioTracks || nativeResult.audioTracks.length <= 1 || !nativeResult.subtitleTracks || nativeResult.subtitleTracks.length === 0)
      ) {
        try {
          const mkvResult = await fetchAndParseMkvHeader(sourceUrl, headers);
          if (mkvResult && (mkvResult.audioTracks.length > (nativeResult.audioTracks?.length || 0) || mkvResult.subtitleTracks.length > (nativeResult.subtitleTracks?.length || 0))) {
            return {
              audioTracks: mkvResult.audioTracks.length > 0 ? mkvResult.audioTracks : nativeResult.audioTracks,
              container: 'matroska',
              subtitleTracks: mkvResult.subtitleTracks.length > 0 ? mkvResult.subtitleTracks : nativeResult.subtitleTracks,
              videoQualities: mkvResult.videoQualities,
              durationSeconds: mkvResult.durationSeconds || nativeResult.durationSeconds || 0,
              hasVideo: mkvResult.hasVideo || nativeResult.hasVideo,
            };
          }
        } catch {}
      }
      return nativeResult;
    } catch (e) {
      console.warn('Media track inspection failed, trying direct EBML parser:', e);
      if (isMkv) {
        try {
          const mkvResult = await fetchAndParseMkvHeader(sourceUrl, headers);
          if (mkvResult) {
            return {
              audioTracks: mkvResult.audioTracks,
              container: 'matroska',
              subtitleTracks: mkvResult.subtitleTracks,
              videoQualities: mkvResult.videoQualities,
              durationSeconds: mkvResult.durationSeconds || 0,
              hasVideo: mkvResult.hasVideo,
            };
          }
        } catch {}
      }
      // Inspection failed but the stream may still play; expose the default track
      // so the audio sheet is not empty.
      return {
        audioTracks: [{id: '0', index: 0, language: 'und', title: 'Default', isSelected: true}],
        subtitleTracks: [],
        durationSeconds: 0,
        hasVideo: false,
      };
    }
  }

  async prepareStream(options: {
    sessionId: string;
    sourceUrl: string;
    isLocal?: boolean;
    headers?: Record<string, string>;
    audioTrackIndex?: number;
    mode: 'ffmpeg' | 'hls' | 'progressive' | 'proxy';
    mimeType?: string;
    startPositionSeconds?: number;
    audioCodec?: string;
    durationSeconds?: number;
    totalSizeBytes?: number;
    // Remuxed modes only; positive plays the sound later.
    audioDelayMs?: number;
  }): Promise<PreparedStreamResult> {
    await this.ensureServerStarted();

    const {
      sessionId,
      isLocal = false,
      headers = {},
      audioTrackIndex = 0,
      mode,
      mimeType = 'video/mp4',
      startPositionSeconds = 0,
      audioCodec = null,
      durationSeconds = 0,
      totalSizeBytes = 0,
      audioDelayMs = 0,
    } = options;
    let {sourceUrl} = options;
    let mappedAudioIndex = audioTrackIndex;

    // HLS master: play one variant, with its audio rendition as a second input.
    let audioUrl: string | null = null;
    const master = mode === 'proxy' ? undefined : this.hlsMasters.get(sourceUrl);
    if (master && master.qualities.length > 0) {
      if (!master.audioUrls.has(sourceUrl)) sourceUrl = master.qualities[0].id;
      const url = master.audioUrls.get(sourceUrl)?.[audioTrackIndex];
      if (url) {
        audioUrl = url;
        mappedAudioIndex = 0;
      }
    }

    const result = await VegaRemoteDelivery.registerSession(
      sessionId,
      sourceUrl,
      isLocal,
      headers,
      mappedAudioIndex,
      mode,
      mimeType,
      startPositionSeconds,
      audioCodec,
      durationSeconds,
      totalSizeBytes,
      audioUrl,
      Math.round(audioDelayMs),
    );

    this.activeSessionId = sessionId;
    console.info('[RemoteDelivery] Stream ready:', result.streamUrl);
    return result;
  }

  async cleanupSession(sessionId: string): Promise<void> {
    if (!VegaRemoteDelivery) return;
    try {
      await VegaRemoteDelivery.unregisterSession(sessionId);
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
    } catch (e) {
      console.warn('Failed to cleanup session:', e);
    }
  }

  async retireSessionWhenReady(previousId: string, nextId: string): Promise<void> {
    await VegaRemoteDelivery?.retireSessionWhenReady?.(previousId, nextId);
  }

  async prepareSubtitle(url: string): Promise<void> {
    const target = new URL(url);
    if (this.serverInfo && target.origin === new URL(this.serverInfo.baseUrl).origin &&
        /^\/(subtitle|extsub)\//.test(target.pathname)) {
      if (!VegaRemoteDelivery?.prepareSubtitle) {
        throw new Error('Update Vega to enable native subtitle preparation');
      }
      await VegaRemoteDelivery.prepareSubtitle(url);
      return;
    }
    // Direct external files need only a normal availability check; no extraction.
    const response = await fetch(url, {method: 'HEAD'});
    if (!response.ok) throw new Error(`Unable to prepare selected subtitles (HTTP ${response.status})`);
  }

  /** Active Cast scan while a custom device list is on screen (Android). */
  async startCastDiscovery(): Promise<void> {
    if (!VegaRemoteDelivery?.startCastDiscovery) return;
    await VegaRemoteDelivery.startCastDiscovery();
  }

  async stopCastDiscovery(): Promise<void> {
    if (!VegaRemoteDelivery?.stopCastDiscovery) return;
    await VegaRemoteDelivery.stopCastDiscovery();
  }

  async getSessionError(sessionId: string): Promise<string | undefined> {
    if (!VegaRemoteDelivery?.getSessionError || !sessionId) return undefined;
    try {
      return (await VegaRemoteDelivery.getSessionError(sessionId)) || undefined;
    } catch {
      return undefined;
    }
  }

  async startForegroundService(options: RemotePlaybackNotificationOptions): Promise<void> {
    if (Platform.OS !== 'android' || !VegaRemoteDelivery?.startForegroundService) return;
    try {
      await VegaRemoteDelivery.startForegroundService(options);
    } catch (e) {
      console.warn('Failed to start foreground playback service:', e);
    }
  }

  async updateMediaPlayback(options: RemotePlaybackNotificationOptions): Promise<void> {
    if (Platform.OS !== 'android' || !VegaRemoteDelivery?.updateMediaPlayback) return;
    try {
      await VegaRemoteDelivery.updateMediaPlayback(options);
    } catch (e) {
      console.warn('Failed to update media playback notification:', e);
    }
  }

  async stopForegroundService(): Promise<void> {
    if (Platform.OS !== 'android' || !VegaRemoteDelivery?.stopForegroundService) return;
    try {
      await VegaRemoteDelivery.stopForegroundService();
      // Stopping the native service also closes its HTTP server. A subsequent
      // cast must start a new server rather than reuse the cached dead port.
      this.serverInfo = null;
      this.activeSessionId = null;
    } catch (e) {
      console.warn('Failed to stop foreground playback service:', e);
    }
  }

  onMediaAction(listener: (event: {action: string; value?: number}) => void): () => void {
    if (Platform.OS !== 'android') return () => {};
    const subscription = DeviceEventEmitter.addListener('onVegaRemoteMediaAction', listener);
    return () => subscription.remove();
  }
}

export const remoteDeliveryService = new RemoteDeliveryService();
