import {NativeModules} from 'react-native';
import {
  getExternalApp,
  usesExternalApp,
  openExternalApp,
  listExternalApps,
} from '../src/lib/externalApps';
const mockValues = new Map<string, string>();
jest.mock('../src/lib/storage', () => ({
  mainStorage: {getString: (key: string) => mockValues.get(key)},
  settingsStorage: {getBool: (key: string) => mockValues.get(key) === 'true'},
}));
beforeEach(() => {
  mockValues.clear();
  NativeModules.ExternalApps = {
    open: jest.fn().mockResolvedValue(null),
    list: jest
      .fn()
      .mockResolvedValue([
        {packageName: 'app', name: 'Player', icon: 'data:image/png;base64,abc'},
      ]),
  };
});
it('defaults both selectors to Ask every time and keeps their choices independent', () => {
  expect(getExternalApp('player')).toBe('ask');
  expect(usesExternalApp('downloader')).toBe(false);
  mockValues.set('externalPlayerApp', 'org.videolan.vlc');
  mockValues.set('useExternalPlayer', 'true');
  expect(usesExternalApp('player')).toBe(true);
  expect(getExternalApp('downloader')).toBe('ask');
});
it('passes the selected app, headers and MIME type to the native launcher', async () => {
  mockValues.set('externalDownloaderApp', 'download.app');
  await openExternalApp(
    'downloader',
    'https://host/file',
    'application/octet-stream',
    {Referer: 'https://host/'},
  );
  expect(NativeModules.ExternalApps.open).toHaveBeenCalledWith(
    'https://host/file',
    'application/octet-stream',
    'download.app',
    {Referer: 'https://host/'},
    null,
  );
});
it('uses the chooser for an explicit external action by default and exposes app icons', async () => {
  await openExternalApp('player', 'content://video', 'video/*');
  expect(NativeModules.ExternalApps.open).toHaveBeenCalledWith(
    'content://video',
    'video/*',
    'ask',
    null,
    null,
  );
  expect((await listExternalApps('player'))[0].icon).toContain(
    'data:image/png',
  );
});
