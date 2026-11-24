import {AppState, Linking} from 'react-native';
import {mainStorage} from '../storage/StorageService';
import useAppDialogStore from '../zustand/appDialogStore';
import {compareAppVersions} from './appUpdateReleases';

const NOTICE_URL = 'https://cdn.jsdelivr.net/gh/vega-org/vega-app@main/startup-notice.json';
const MAX_NOTICE_SIZE = 16_384;

interface Notice {
  id: string;
  title: string;
  description: string;
  buttons: Array<{label: string; url: string}>;
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const validText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

function browserUrl(value: unknown): string | undefined {
  if (!validText(value, 2048) || !/^https?:\/\/[^\s/\\?#@]+(?:[/?#]|$)/.test(value) ||
      /[\s\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.hostname) {
      return url.href;
    }
  } catch {
    return;
  }
}

export function getMatchingStartupNotice(data: unknown, version: string, build: string): Notice | undefined {
  const notice = asObject(asObject(data)?.notice);
  if (!notice) return;
  const {id, title, description, target, buttons = []} = notice;
  if (
    typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    !validText(title, 100) || !validText(description, 2000) ||
    !Array.isArray(buttons) || buttons.length > 3
  ) return;

  if (target !== undefined) {
    const conditions = asObject(target);
    if (!conditions) return;
    const {minVersion, maxVersion, builds} = conditions;
    if (builds !== undefined && (
      !Array.isArray(builds) || builds.length === 0 || builds.length > 2 ||
      new Set(builds).size !== builds.length ||
      builds.some((item: unknown) => item !== 'playstore' && item !== 'github') ||
      !builds.includes(build)
    )) return;
    if (minVersion !== undefined) {
      const result = typeof minVersion === 'string' ? compareAppVersions(version, minVersion) : undefined;
      if (result === undefined || result < 0) return;
    }
    if (maxVersion !== undefined) {
      const result = typeof maxVersion === 'string' ? compareAppVersions(version, maxVersion) : undefined;
      if (result === undefined || result > 0) return;
    }
  }

  const actions: Notice['buttons'] = [];
  for (const button of buttons) {
    const fields = asObject(button);
    const label = fields?.label;
    const url = browserUrl(fields?.url);
    if (!url || !validText(label, 40)) return;
    actions.push({label: label.trim(), url});
  }
  return {id, title: title.trim(), description: description.trim(), buttons: actions};
}

export async function checkStartupNotice(version: string, build: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 8000);
  let notice: Notice | undefined;
  try {
    const response = await fetch(NOTICE_URL, {signal: controller.signal});
    if (!response.ok) return;
    const body = await response.text();
    if (controller.signal.aborted || body.length > MAX_NOTICE_SIZE) return;
    notice = getMatchingStartupNotice(JSON.parse(body), version, build);
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }

  if (!notice || signal.aborted) return;
  const {id, title, description, buttons} = notice;
  const dismissalKey = `startupNoticeDismissed:${id}`;
  if (mainStorage.getString(dismissalKey) === version) return;

  const stop = () => {
    unsubscribe();
    appState.remove();
    signal.removeEventListener('abort', stop);
  };
  const showWhenReady = () => {
    const state = useAppDialogStore.getState();
    if (signal.aborted || state.dialog || AppState.currentState === 'background' ||
        AppState.currentState === 'inactive') return;
    stop();
    state.showDialog({
      title,
      message: description,
      dismissOption: {
        label: 'Don’t show again',
        onCheckedDismiss: () => mainStorage.setString(dismissalKey, version),
      },
      actions: buttons.map(({label, url}) => ({
        label,
        onPress: () => { void Linking.openURL(url).catch(() => {}); },
      })),
    });
  };
  const unsubscribe = useAppDialogStore.subscribe(showWhenReady);
  const appState = AppState.addEventListener('change', showWhenReady);
  signal.addEventListener('abort', stop);
  showWhenReady();
}
