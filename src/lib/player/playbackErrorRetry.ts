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

export interface PlaybackErrorDetails {
  title: string;
  summary: string;
  codeLabel: string | null;
  isNetwork: boolean;
  rawMessage: string;
}

/**
 * Only transient IO/network failures should trigger automatic link refresh or
 * server switching. Decoder, container parsing, DRM and unknown errors stay on
 * the current stream so the user can inspect, copy, or switch manually.
 */
export function isNetworkPlaybackError(event: unknown): boolean {
  if (isContainerParsingError(event)) {
    return false;
  }
  const code = getPlaybackErrorCode(event);
  if (code !== null) {
    return code >= 2000 && code < 3000;
  }
  const error = (event as {error?: {errorString?: string; errorException?: string; cause?: {message?: string}}})?.error;
  const detail = [error?.errorString, error?.errorException, error?.cause?.message]
    .filter(Boolean)
    .join(' ');
  return /network|timeout|timed out|socket|connect|connection|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|http\s*[45]\d\d/i.test(
    detail,
  );
}

export function formatPlaybackErrorDetails(
  event: unknown,
  options?: {
    decoderMode?: string;
    streamTitle?: string;
    exhaustedServers?: boolean;
  },
): PlaybackErrorDetails {
  const error = (event as {
    error?: {
      errorCode?: unknown;
      errorString?: unknown;
      errorException?: unknown;
      errorStackTrace?: unknown;
      localizedDescription?: unknown;
      cause?: {message?: unknown};
    };
  })?.error;

  const rawCode = typeof error?.errorCode === 'string' ? error.errorCode : null;
  const code = getPlaybackErrorCode(event);
  const parsingError = isContainerParsingError(event);
  const isNetwork = isNetworkPlaybackError(event);

  let title = 'Playback Error';
  if (parsingError) {
    title = 'Unsupported Stream Format';
  } else if (code !== null && code >= 4000 && code < 5000) {
    title = 'Video Decoding Failed';
  } else if (code !== null && code >= 5000 && code < 6000) {
    title = 'Audio Playback Failed';
  } else if (code !== null && code >= 6000 && code < 7000) {
    title = 'DRM Playback Failed';
  } else if (isNetwork && options?.exhaustedServers) {
    title = 'All Servers Failed';
  } else if (isNetwork) {
    title = 'Network Error';
  }

  const parts = [
    error?.errorString,
    error?.localizedDescription,
    error?.errorException,
    error?.cause?.message,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());

  const firstLine = (parts[0] || 'Unable to play this video stream.')
    .split(/\r?\n/)[0]
    .trim();
  const summary = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;

  const codeLabel =
    rawCode && code !== null && rawCode !== String(code)
      ? `Error ${rawCode} (Media3 ${code})`
      : rawCode
        ? `Error ${rawCode}`
        : code !== null
          ? `Error ${code}`
          : null;

  const rawLines: string[] = [];
  if (options?.streamTitle) rawLines.push(`Server: ${options.streamTitle}`);
  if (options?.decoderMode) rawLines.push(`Decoder: ${options.decoderMode}`);
  if (codeLabel) rawLines.push(`Code: ${codeLabel}`);
  if (typeof error?.errorString === 'string' && error.errorString.trim()) {
    rawLines.push(`Error: ${error.errorString.trim()}`);
  }
  if (typeof error?.errorException === 'string' && error.errorException.trim()) {
    rawLines.push(`Exception: ${error.errorException.trim()}`);
  }
  if (typeof error?.cause?.message === 'string' && error.cause.message.trim()) {
    rawLines.push(`Cause: ${error.cause.message.trim()}`);
  }
  if (typeof error?.errorStackTrace === 'string' && error.errorStackTrace.trim()) {
    const stack = error.errorStackTrace.trim();
    rawLines.push(
      `Stack:\n${stack.length > 1500 ? `${stack.slice(0, 1500)}...` : stack}`,
    );
  }
  if (rawLines.length === 0) {
    rawLines.push(summary);
  }

  return {
    title,
    summary,
    codeLabel,
    isNetwork,
    rawMessage: rawLines.join('\n'),
  };
}
