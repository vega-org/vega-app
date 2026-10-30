/**
 * A server that played fine and then hits a playback error (a dropped
 * connection, a timeout, a failed range request after a seek) is reloaded once
 * at the same position before the player gives up on it and switches server.
 */

/** A reloaded stream that keeps playing this long earns its retry back. */
export const PLAYBACK_RETRY_RESET_MS = 60_000;

export type PlaybackErrorAction = 'retry' | 'switch';

export interface PlaybackRetryState {
  /** Stream this state belongs to; any other stream starts afresh. */
  stream: unknown;
  /** When the stream last loaded, or null while it is (re)loading. */
  loadedAt: number | null;
  /** Whether the stream was already reloaded after an error. */
  retried: boolean;
}

export const NO_PLAYBACK_RETRY: PlaybackRetryState = {
  stream: null,
  loadedAt: null,
  retried: false,
};

/**
 * Media3 PlaybackException code of a react-native-video onError event, or null.
 * On Android the event is {error: {errorString, errorException, errorCode,
 * errorStackTrace}} and errorCode is the Media3 code behind a "2", so 2001
 * (connection failed) arrives as "22001". Codes react-native-video raises
 * itself (e.g. "1001" when the player fails to start) have no prefix.
 */
export function getPlaybackErrorCode(event: unknown): number | null {
  const raw = (event as {error?: {errorCode?: unknown}} | undefined)?.error
    ?.errorCode;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw.length > 4 && raw.startsWith('2') ? raw.slice(1) : raw);
}

/**
 * Parsing (3xxx), decoding (4xxx), DRM (6xxx) and video processing (7xxx)
 * failures come back on reload. Reclaimed decoder resources (4006) do not.
 * Network/IO (2xxx), audio output (5xxx) and unknown errors are worth a retry.
 */
function isPermanentPlaybackError(code: number | null): boolean {
  if (code === null || code === 4006) {
    return false;
  }
  return (code >= 3000 && code < 5000) || (code >= 6000 && code < 8000);
}

const forStream = (
  state: PlaybackRetryState,
  stream: unknown,
): PlaybackRetryState =>
  state.stream === stream ? state : {...NO_PLAYBACK_RETRY, stream};

/** Records that the selected stream loaded (react-native-video onLoad). */
export function markPlaybackLoaded(
  state: PlaybackRetryState,
  stream: unknown,
  now: number,
): PlaybackRetryState {
  return {...forStream(state, stream), loadedAt: now};
}

/**
 * Whether to reload the selected stream in place or switch server. Only a
 * stream that loaded is reloaded, once, until it plays again for
 * PLAYBACK_RETRY_RESET_MS, so a stream that keeps failing still moves on.
 */
export function decidePlaybackError(
  state: PlaybackRetryState,
  stream: unknown,
  event: unknown,
  now: number,
): {action: PlaybackErrorAction; state: PlaybackRetryState} {
  const current = forStream(state, stream);
  const canRetry =
    current.loadedAt !== null &&
    (!current.retried || now - current.loadedAt >= PLAYBACK_RETRY_RESET_MS) &&
    !isPermanentPlaybackError(getPlaybackErrorCode(event)) &&
    !isContainerParsingError(event);
  if (!canRetry) {
    return {action: 'switch', state: current};
  }
  return {action: 'retry', state: {stream, loadedAt: null, retried: true}};
}

/**
 * Start position (ms) for reloading the stream at `position` seconds. The
 * player only reloads when its source changes, so the value always differs
 * from the start position the current source already has.
 */
export function getReloadStartMs(
  position: number,
  currentStartMs: number | undefined,
): number {
  const ms = Number.isFinite(position)
    ? Math.max(1, Math.round(position * 1000))
    : 1;
  return ms === currentStartMs ? ms + 1 : ms;
}

/** Some Media3 extractor exceptions are wrapped as IO_UNSPECIFIED (2000). */
export function isContainerParsingError(event: unknown): boolean {
  const error = (event as {error?: {errorStackTrace?: string; errorException?: string; cause?: {message?: string}}})?.error;
  const detail = [error?.errorStackTrace, error?.errorException, error?.cause?.message].join(' ');
  const code = getPlaybackErrorCode(event);
  return (code !== null && code >= 3000 && code < 4000) ||
    /No valid varint length mask found|ParserException|MalformedContainer/i.test(detail);
}
