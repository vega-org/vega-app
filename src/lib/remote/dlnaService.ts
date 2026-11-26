import {RemotePlaybackCanceledError} from './remotePlaybackErrors';
import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {RemoteDevice} from './types';
import {useRemoteStore} from './remoteStore';

const {VegaDlna} = NativeModules;

class DlnaService {
  private pollingTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscription: any = null;
  private timelineOffset = 0;
  private sourceDuration = 0;

  private pollingGeneration = 0;

  private pollingControlUrl: string | null = null;

  startDiscovery(): void {
    if (Platform.OS !== 'android' || !VegaDlna) return;

    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    useRemoteStore.getState().setIsSearchingDlna(true);

    if (!this.subscription) {
      this.subscription = DeviceEventEmitter.addListener(
        'VegaDlnaDeviceFound',
        (device: RemoteDevice) => {
          if (device && device.id) {
            useRemoteStore.getState().addDlnaDevice(device);
          }
        },
      );
    }

    VegaDlna.startDiscovery().catch((e: any) => {
      console.warn('Error starting DLNA discovery:', e);
      useRemoteStore.getState().setIsSearchingDlna(false);
    });

    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      this.stopDiscovery();
    }, 7000);
  }

  stopDiscovery(): void {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (Platform.OS !== 'android' || !VegaDlna) return;
    useRemoteStore.getState().setIsSearchingDlna(false);
    VegaDlna.stopDiscovery().catch(() => {});
  }

  /** Adds a renderer by IP when SSDP discovery is blocked on the network. */
  async addDeviceByAddress(address: string): Promise<RemoteDevice> {
    if (Platform.OS !== 'android' || !VegaDlna) {
      throw new Error('DLNA is not available');
    }
    const device: RemoteDevice = await VegaDlna.addDeviceByAddress(address);
    useRemoteStore.getState().addDlnaDevice(device);
    return device;
  }

  setTimelineContext(offsetSeconds: number, durationSeconds?: number): void {
    const offset = Math.max(0, offsetSeconds);
    const duration = durationSeconds === undefined ? this.sourceDuration : Math.max(0, durationSeconds);
    if (offset === this.timelineOffset && duration === this.sourceDuration) return;
    const controlUrl = this.pollingControlUrl;
    this.stopPolling();
    this.timelineOffset = offset;
    this.sourceDuration = duration;
    if (controlUrl) this.startPolling(controlUrl);
  }

  async loadMedia(
    device: RemoteDevice,
    mediaUrl: string,
    title = 'Vega Playback',
    subtitleUrl?: string,
    timelineOffset = 0,
    sourceDuration = 0,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!device.controlUrl) {
      throw new Error('Device does not support AVTransport');
    }

    this.stopPolling();
    this.timelineOffset = Math.max(0, timelineOffset);
    this.sourceDuration = Math.max(0, sourceDuration);
    const generation = this.pollingGeneration;
    console.info('[DlnaLoad] request', {
      deviceName: device.name,
      controlUrl: device.controlUrl,
      mediaUrl,
      title,
      subtitleUrl,
    });
    console.info('[DlnaLoad] subtitleUrl:', subtitleUrl || 'none');
    await VegaDlna.setAVTransportURI(
      device.controlUrl,
      mediaUrl,
      title,
      subtitleUrl || null,
    );
    if (!isCurrent() || generation !== this.pollingGeneration)
      throw new RemotePlaybackCanceledError('DLNA load canceled');
    await VegaDlna.play(device.controlUrl);
    if (!isCurrent() || generation !== this.pollingGeneration)
      throw new RemotePlaybackCanceledError('DLNA load canceled');
    useRemoteStore.getState().setStatus('playing');
    this.startPolling(device.controlUrl);
  }

  async play(device: RemoteDevice): Promise<void> {
    if (!device.controlUrl) return;
    await VegaDlna.play(device.controlUrl);
    useRemoteStore.getState().setStatus('playing');
    this.startPolling(device.controlUrl);
  }

  async pause(device: RemoteDevice): Promise<void> {
    if (!device.controlUrl) return;
    this.stopPolling();
    await VegaDlna.pause(device.controlUrl);
    useRemoteStore.getState().setStatus('paused');
  }

  async stop(device: RemoteDevice): Promise<void> {
    if (!device.controlUrl) return;
    this.stopPolling();
    this.timelineOffset = 0;
    this.sourceDuration = 0;
    await VegaDlna.stop(device.controlUrl);
    useRemoteStore.getState().setStatus('stopped');
  }

  async seek(device: RemoteDevice, seconds: number): Promise<void> {
    if (!device.controlUrl) return;
    const targetInStream = Math.max(0, seconds - this.timelineOffset);
    await VegaDlna.seek(device.controlUrl, targetInStream);
    this.startPolling(device.controlUrl);
  }

  async setVolume(device: RemoteDevice, volume0to100: number): Promise<void> {
    if (!device.renderingControlUrl) return;
    await VegaDlna.setVolume(device.renderingControlUrl, volume0to100);
    useRemoteStore.getState().setVolume(volume0to100 / 100);
  }

  /** Receiver volume from 0 to 1, or undefined when the device does not report it. */
  async getVolume(device: RemoteDevice): Promise<number | undefined> {
    if (!device.renderingControlUrl || !VegaDlna?.getVolume) return undefined;
    const volume0to100 = await VegaDlna.getVolume(device.renderingControlUrl);
    return typeof volume0to100 === 'number' ? volume0to100 / 100 : undefined;
  }

  private onUriObserved?: (uri: string) => void;

  setOnUriObserved(callback?: (uri: string) => void): void {
    this.onUriObserved = callback;
  }

  async getActiveUri(device: RemoteDevice): Promise<string | null> {
    if (!device.controlUrl || Platform.OS !== 'android' || !VegaDlna) return null;
    try {
      if (typeof VegaDlna.getMediaInfo === 'function') {
        const media = await VegaDlna.getMediaInfo(device.controlUrl);
        if (media?.currentUri) return media.currentUri;
      }
      const pos = await VegaDlna.getPositionInfo(device.controlUrl);
      if (pos?.trackUri) return pos.trackUri;
    } catch {}
    return null;
  }

  private startPolling(controlUrl: string): void {
    this.stopPolling();
    this.pollingControlUrl = controlUrl;
    const generation = this.pollingGeneration;
    const offset = this.timelineOffset;
    const sourceDuration = this.sourceDuration;
    let inFlight = false;
    this.pollingTimer = setInterval(async () => {
      if (inFlight || generation !== this.pollingGeneration) return;
      inFlight = true;
      try {
        const info = await VegaDlna.getPositionInfo(controlUrl);
        if (generation !== this.pollingGeneration) return;
        if (info) {
          const moviePos = Math.max(0, (info.position || 0) + offset);
          const movieDur = sourceDuration || info.duration || 0;
          useRemoteStore.getState().setTimeline(moviePos, movieDur);
          if (info.trackUri && this.onUriObserved) {
            this.onUriObserved(info.trackUri);
          }
        }
      } catch {
        // Ignored during seek/transitions
      } finally {
        inFlight = false;
      }
    }, 1000);
  }

  stopPolling(): void {
    this.pollingGeneration++;
    this.pollingControlUrl = null;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  destroy(): void {
    this.stopPolling();
    this.timelineOffset = 0;
    this.sourceDuration = 0;
    this.stopDiscovery();
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
  }
}

export const dlnaService = new DlnaService();
