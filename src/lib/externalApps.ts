import {NativeModules} from 'react-native';
import {mainStorage, settingsStorage} from './storage';
export type ExternalAppKind = 'player' | 'downloader';
export type ExternalApp = {packageName: string; name: string; icon?: string};
export const externalAppKey = (kind: ExternalAppKind) =>
  kind === 'player' ? 'externalPlayerApp' : 'externalDownloaderApp';
export const getExternalApp = (kind: ExternalAppKind) =>
  mainStorage.getString(externalAppKey(kind)) || 'ask';
export const usesExternalApp = (kind: ExternalAppKind) => settingsStorage.getBool(kind === 'player' ? 'useExternalPlayer' : 'alwaysExternalDownloader', false);
export async function listExternalApps(
  kind: ExternalAppKind,
): Promise<ExternalApp[]> {
  return NativeModules.ExternalApps?.list(kind) || [];
}
export async function openExternalApp(
  kind: ExternalAppKind,
  url: string,
  mime: string | null,
  headers?: Record<string, string>,
  title?: string,
) {
  if (!NativeModules.ExternalApps)
    throw new Error('Rebuild Vega to use external app selection.');
  return NativeModules.ExternalApps.open(
    url,
    mime,
    getExternalApp(kind),
    headers || null,
    title || null,
  );
}
