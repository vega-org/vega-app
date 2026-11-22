/** Latest-position scheduling for the seek preview. Playback never waits on this work. */
export type PreviewNativeModule = {
  getThumbnail: (
    source: string,
    timestampMs: number,
    headers: Record<string, string>,
    options: Record<string, string | number | boolean>,
  ) => Promise<{uri: string}>;
  cancelPreview?: (session: string) => void;
};

let nextSession = 0;
const MAX_MEMORY_FRAMES = 96;

export class SeekThumbnailSession {
  private readonly cache = new Map<number, string>();
  private owner = this.newOwner();
  private pending: number | null = null;
  private wanted: number | null = null;
  private busy = false;
  private active = true;
  private disposed = false;
  private retryAt = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly native: PreviewNativeModule,
    private readonly source: string,
    private readonly headers: Record<string, string>,
    private readonly publish: (uri: string | null, loading: boolean) => void,
  ) {}

  request(timestampMs: number) {
    if (this.disposed) return;
    this.active = true;
    this.wanted = timestampMs;
    const cached = this.cache.get(timestampMs);
    if (cached) {
      this.pending = null;
      this.cache.delete(timestampMs);
      this.cache.set(timestampMs, cached);
      this.publish(cached, false);
      return;
    }

    if (Date.now() < this.retryAt) {
      this.pending = null;
      this.publish(null, false);
      return;
    }
    this.pending = timestampMs;
    this.publish(null, true);
    // The first preview starts immediately. While it decodes, movements replace
    // one pending timestamp instead of adding native work for every position.
    this.drain();
  }

  pause() {
    this.active = false;
    this.pending = null;
    this.wanted = null;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.native.cancelPreview?.(this.owner);
    this.owner = this.newOwner();
  }

  dispose() {
    this.pause();
    this.disposed = true;
    this.cache.clear();
  }

  private newOwner() {
    return `seek-preview-${++nextSession}`;
  }

  private drain() {
    if (this.disposed || !this.active || this.busy || this.timer || this.pending === null) return;
    if (Date.now() < this.retryAt) {
      this.pending = null;
      this.publish(null, false);
      return;
    }
    const timestamp = this.pending;
    const owner = this.owner;
    this.pending = null;
    this.busy = true;
    void this.native.getThumbnail(this.source, timestamp, this.headers, {
      previewSession: owner,
      maxWidth: 320,
      maxHeight: 180,
      quality: 72,
      cache: true,
    }).then(result => {
      if (this.disposed || owner !== this.owner) return;
      this.cache.set(timestamp, result.uri);
      if (this.cache.size > MAX_MEMORY_FRAMES) {
        this.cache.delete(this.cache.keys().next().value!);
      }
      if (this.active && this.wanted === timestamp) {
        this.pending = null;
        this.publish(result.uri, false);
      }
    }).catch(() => {
      if (!this.active || this.disposed || owner !== this.owner) return;
      // Repeated failures (unsupported codecs, expired links) must not saturate
      // the network and decoder while the user is still scrubbing.
      this.retryAt = Date.now() + 2_000;
      this.pending = null;
      this.publish(null, false);
    }).finally(() => {
      this.busy = false;
      if (this.disposed || !this.active || this.pending === null) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, 40);
    });
  }
}
