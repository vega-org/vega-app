import {describe, expect, it} from '@jest/globals';
import {
  NO_PLAYBACK_RETRY,
  PLAYBACK_RETRY_RESET_MS,
  decidePlaybackError,
  getPlaybackErrorCode,
  getReloadStartMs,
  markPlaybackLoaded,
} from '../src/lib/player/playbackErrorRetry';

// react-native-video on Android sends the Media3 code with a leading "2".
const errorEvent = (media3Code: number) => ({
  error: {
    errorString: 'ExoPlaybackException: ERROR_CODE',
    errorException: 'androidx.media3.exoplayer.ExoPlaybackException',
    errorCode: `2${media3Code}`,
  },
});
const CONNECTION_FAILED = errorEvent(2001);
const CONNECTION_TIMEOUT = errorEvent(2002);
const DECODING_FAILED = errorEvent(4003);

const T0 = 1_700_000_000_000;
const SECOND = 1000;
const serverA = {server: 'A', link: 'https://a.example/video.mp4'};
const serverB = {server: 'B', link: 'https://b.example/video.m3u8'};

const loadedAt = (at: number, stream: object = serverA) =>
  markPlaybackLoaded(NO_PLAYBACK_RETRY, stream, at);

describe('getPlaybackErrorCode', () => {
  it('reads the Media3 code from the prefixed Android errorCode', () => {
    expect(getPlaybackErrorCode(CONNECTION_FAILED)).toBe(2001);
    expect(getPlaybackErrorCode(DECODING_FAILED)).toBe(4003);
    expect(getPlaybackErrorCode(errorEvent(1002))).toBe(1002);
  });

  it('keeps the plain codes react-native-video reports itself', () => {
    expect(getPlaybackErrorCode({error: {errorCode: '1001'}})).toBe(1001);
    expect(getPlaybackErrorCode({error: {errorCode: '3006'}})).toBe(3006);
  });

  it('returns null when there is no numeric code', () => {
    expect(getPlaybackErrorCode(undefined)).toBeNull();
    expect(getPlaybackErrorCode({})).toBeNull();
    expect(getPlaybackErrorCode({error: {}})).toBeNull();
    expect(
      getPlaybackErrorCode({error: {errorCode: 'DAI_REQUEST_ERROR'}}),
    ).toBeNull();
  });
});

describe('decidePlaybackError', () => {
  it('reloads the same stream on a network error after it played', () => {
    const result = decidePlaybackError(
      loadedAt(T0),
      serverA,
      CONNECTION_FAILED,
      T0 + 35 * SECOND,
    );
    expect(result.action).toBe('retry');
  });

  it('switches server when the reloaded stream fails again soon', () => {
    const first = decidePlaybackError(
      loadedAt(T0),
      serverA,
      CONNECTION_FAILED,
      T0 + 35 * SECOND,
    );
    const reloaded = markPlaybackLoaded(first.state, serverA, T0 + 38 * SECOND);
    const second = decidePlaybackError(
      reloaded,
      serverA,
      CONNECTION_TIMEOUT,
      T0 + 50 * SECOND,
    );
    expect(second.action).toBe('switch');
  });

  it('switches server when the reload fails before loading', () => {
    const first = decidePlaybackError(
      loadedAt(T0),
      serverA,
      CONNECTION_FAILED,
      T0 + 35 * SECOND,
    );
    const second = decidePlaybackError(
      first.state,
      serverA,
      CONNECTION_FAILED,
      T0 + 40 * SECOND,
    );
    expect(second.action).toBe('switch');
  });

  it('switches server when the stream never loaded', () => {
    expect(
      decidePlaybackError(NO_PLAYBACK_RETRY, serverA, CONNECTION_FAILED, T0)
        .action,
    ).toBe('switch');
    // Another stream having loaded says nothing about this one.
    expect(
      decidePlaybackError(
        loadedAt(T0, serverB),
        serverA,
        CONNECTION_FAILED,
        T0 + 35 * SECOND,
      ).action,
    ).toBe('switch');
  });

  it('switches server on errors a reload cannot fix', () => {
    for (const code of [3001, 4001, 4003, 6001]) {
      expect(
        decidePlaybackError(
          loadedAt(T0),
          serverA,
          errorEvent(code),
          T0 + 35 * SECOND,
        ).action,
      ).toBe('switch');
    }
  });

  it('gives the retry back once the reloaded stream played long enough', () => {
    const first = decidePlaybackError(
      loadedAt(T0),
      serverA,
      CONNECTION_FAILED,
      T0 + 35 * SECOND,
    );
    const reloadedAt = T0 + 38 * SECOND;
    const reloaded = markPlaybackLoaded(first.state, serverA, reloadedAt);
    const later = decidePlaybackError(
      reloaded,
      serverA,
      CONNECTION_FAILED,
      reloadedAt + PLAYBACK_RETRY_RESET_MS,
    );
    expect(later.action).toBe('retry');
    // The new retry is spent again until the stream recovers.
    const again = decidePlaybackError(
      markPlaybackLoaded(later.state, serverA, reloadedAt + 65 * SECOND),
      serverA,
      CONNECTION_FAILED,
      reloadedAt + 70 * SECOND,
    );
    expect(again.action).toBe('switch');
  });

  it('reloads after load when the error has no known code', () => {
    for (const event of [undefined, {}, {error: {}}]) {
      expect(
        decidePlaybackError(loadedAt(T0), serverA, event, T0 + 35 * SECOND)
          .action,
      ).toBe('retry');
    }
  });

  it('gives every newly selected stream its own retry', () => {
    const first = decidePlaybackError(
      loadedAt(T0),
      serverA,
      CONNECTION_FAILED,
      T0 + 35 * SECOND,
    );
    const onB = markPlaybackLoaded(first.state, serverB, T0 + 40 * SECOND);
    expect(
      decidePlaybackError(onB, serverB, CONNECTION_FAILED, T0 + 45 * SECOND)
        .action,
    ).toBe('retry');
  });
});

describe('getReloadStartMs', () => {
  it('starts the reload at the playback position', () => {
    expect(getReloadStartMs(125.4, undefined)).toBe(125400);
  });

  it('always differs from the start position already in use', () => {
    // An unchanged source would not make the player load again.
    expect(getReloadStartMs(125.4, 125400)).toBe(125401);
    expect(getReloadStartMs(0, undefined)).toBe(1);
    expect(getReloadStartMs(Number.NaN, 1)).toBe(2);
  });
});

it('does not retry MKV parsing failures disguised as generic IO errors', () => {
  const event = {error: {errorCode: '22000', errorStackTrace: 'IllegalStateException: No valid varint length mask found'}};
  expect(decidePlaybackError(loadedAt(T0), serverA, event, T0 + SECOND).action).toBe('switch');
});
