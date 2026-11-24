import {NativeModules, Platform} from 'react-native';
import {mainStorage} from '../storage/StorageService';

/**
 * Keeps the newest JS log lines in the same on-disk log as native code, so a
 * user can export them with a bug report. Lines are batched and sent to
 * native once a second.
 *
 * Always kept: console.info, console.warn, console.error and JS crashes.
 * Kept only while detailed logging is on: console.log and console.debug.
 */

const {VegaLog} = NativeModules;

const DETAILED_UNTIL_KEY = 'logging.detailedUntil';
const DETAILED_DURATION_MS = 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 200;
const MAX_LINE_CHARS = 4000;
const MAX_STACK_LINES = 6;

// Android log levels.
const DEBUG = 3;
const INFO = 4;
const WARN = 5;
const ERROR = 6;

type Entry = [number, string, string];

let pending: Entry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let detailedTimer: ReturnType<typeof setTimeout> | null = null;
let detailed = false;
let installed = false;

const formatArg = (arg: unknown): string => {
  if (arg instanceof Error) {
    // Bundle frames past the first few are promise plumbing and say nothing.
    const lines = (arg.stack || `${arg.name}: ${arg.message}`).split('\n');
    return lines.length > MAX_STACK_LINES
      ? `${lines.slice(0, MAX_STACK_LINES).join('\n')}\n    … ${lines.length - MAX_STACK_LINES} more frames`
      : lines.join('\n');
  }
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
};

const flush = () => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.length === 0 || !VegaLog) return;
  const batch = pending;
  pending = [];
  try {
    VegaLog.writeBatch(batch);
  } catch {}
};

// Library deprecation notices repeat on every screen view. They filled most of
// the size-limited log file and pushed out the lines a bug report needs.
const NOISE = [
  'React Native Firebase namespaced API',
  'InteractionManager has been deprecated',
];

// The same line repeated back to back is kept once, with a count.
let lastMessage = '';
let lastLevel = 0;
let repeats = 0;

const flushRepeats = () => {
  if (repeats > 0) {
    pending.push([lastLevel, 'VegaJS', `(previous line repeated ${repeats} more times)`]);
    repeats = 0;
  }
};

const record = (level: number, args: unknown[]) => {
  if (!VegaLog) return;
  let message = args.map(formatArg).join(' ');
  if (NOISE.some(text => message.includes(text))) return;
  if (message === lastMessage && level === lastLevel) {
    repeats++;
    return;
  }
  flushRepeats();
  lastMessage = message;
  lastLevel = level;
  if (message.length > MAX_LINE_CHARS)
    message = `${message.slice(0, MAX_LINE_CHARS)}… (${message.length} chars)`;
  pending.push([level, 'VegaJS', message]);
  if (pending.length >= MAX_BATCH) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
};

const applyDetailed = (enabled: boolean) => {
  detailed = enabled;
  VegaLog?.setDetailed(enabled);
  if (detailedTimer) clearTimeout(detailedTimer);
  detailedTimer = null;
  if (enabled) {
    const until = mainStorage.getNumber(DETAILED_UNTIL_KEY) ?? 0;
    // Turns itself off so nobody keeps it running by accident.
    detailedTimer = setTimeout(
      () => setDetailedLogging(false),
      Math.max(0, until - Date.now()),
    );
  }
};

export const isDetailedLoggingEnabled = (): boolean =>
  (mainStorage.getNumber(DETAILED_UNTIL_KEY) ?? 0) > Date.now();

/** Detailed logging stays on for 24 hours, then turns itself off. */
export const setDetailedLogging = (enabled: boolean): void => {
  mainStorage.setNumber(
    DETAILED_UNTIL_KEY,
    enabled ? Date.now() + DETAILED_DURATION_MS : 0,
  );
  applyDetailed(enabled);
};

export const shareLogs = async (extraHeader?: string): Promise<void> => {
  if (!VegaLog) throw new Error('Logs are unavailable on this device');
  flushRepeats();
  flush();
  await VegaLog.share(extraHeader ?? null);
};

export const clearLogs = async (): Promise<void> => {
  if (!VegaLog) throw new Error('Logs are unavailable on this device');
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
  lastMessage = '';
  lastLevel = 0;
  repeats = 0;
  await VegaLog.clear();
};

/**
 * Routes console output into the log file. In release builds console.log and
 * console.debug skip logcat entirely, as before, and reach the file only while
 * detailed logging is on.
 */
export const installVegaLog = (isDev: boolean): void => {
  if (installed || Platform.OS !== 'android') return;
  installed = true;
  applyDetailed(isDetailedLoggingEnabled());

  const original = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const wrap =
    (level: number, forward: ((...args: unknown[]) => void) | null, detailedOnly = false) =>
    (...args: unknown[]) => {
      forward?.(...args);
      if (!detailedOnly || detailed) record(level, args);
    };

  // Native VegaLog prints file lines to logcat itself, so in release builds
  // the console originals are skipped to avoid printing twice.
  console.log = wrap(DEBUG, isDev ? original.log : null, true);
  console.debug = wrap(DEBUG, isDev ? original.debug : null, true);
  console.info = wrap(INFO, isDev ? original.info : null);
  console.warn = wrap(WARN, isDev ? original.warn : null);
  console.error = wrap(ERROR, isDev ? original.error : null);

  const errorUtils = (global as any).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    record(ERROR, [`${isFatal ? 'Fatal' : 'Unhandled'} JS error:`, error]);
    flush();
    previousHandler?.(error, isFatal);
  });
};
