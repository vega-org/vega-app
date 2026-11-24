import {updateProvidersService} from '../src/lib/services/UpdateProviders';
import {extensionManager} from '../src/lib/services/ExtensionManager';
import {notificationService} from '../src/lib/services/Notification';

let mockEnabled = true;
let mockInstalled: any[] = [];
let mockActive: any;
const mockSetProvider = jest.fn();
const mockSetInstalled = jest.fn();
jest.mock('../src/lib/storage', () => ({settingsStorage: {
  isProviderAutoUpdateEnabled: () => mockEnabled,
  isNotificationsEnabled: () => false,
}}));
jest.mock('../src/lib/storage/extensionStorage', () => ({extensionStorage: {
  getProviderSource: () => undefined,
  getInstalledProviders: () => mockInstalled,
}}));
jest.mock('../src/lib/services/ExtensionManager', () => ({extensionManager: {
  initialize: jest.fn(), fetchManifest: jest.fn(), updateProvider: jest.fn(),
}}));
jest.mock('../src/lib/services/Notification', () => ({notificationService: {
  displayUpdateNotification: jest.fn(), showUpdateProgress: jest.fn(), cancelNotification: jest.fn(),
}}));
jest.mock('../src/lib/zustand/contentStore', () => ({__esModule: true, default: {
  getState: () => ({provider: mockActive, setProvider: mockSetProvider, setInstalledProviders: mockSetInstalled}),
}}));
const provider = (author = 'A', version = '1.0.0') => ({value: 'movie', display_name: 'Movies', version, source: {author, url: 'https://example.com/' + author}} as any);
beforeEach(() => {
  jest.clearAllMocks(); mockEnabled = true; mockInstalled = [provider()]; mockActive = mockInstalled[0];
  jest.mocked(extensionManager.initialize).mockResolvedValue(undefined);
  jest.mocked(extensionManager.fetchManifest).mockResolvedValue([provider('A', '2.0.0')]);
  jest.mocked(extensionManager.updateProvider).mockResolvedValue(true);
});
it('does not fetch or install when automatic updates are disabled', async () => {
  mockEnabled = false;
  expect(await updateProvidersService.checkForUpdatesAndAutoUpdate()).toEqual([]);
  expect(extensionManager.initialize).not.toHaveBeenCalled();
  expect(extensionManager.updateProvider).not.toHaveBeenCalled();
});
it('still permits manual updates with automatic updates disabled', async () => {
  mockEnabled = false;
  expect(await updateProvidersService.updateProvider(provider())).toBe(true);
  expect(extensionManager.updateProvider).toHaveBeenCalledWith(provider(), undefined);
});
it('does not install if disabled while the manifest is loading', async () => {
  jest.mocked(extensionManager.fetchManifest).mockImplementation(async () => {mockEnabled = false; return [provider('A', '2.0.0')];});
  await updateProvidersService.checkForUpdatesAndAutoUpdate();
  expect(extensionManager.updateProvider).not.toHaveBeenCalled();
});
it('passes a live setting guard into the module commit', async () => {
  await updateProvidersService.updateProvider(provider(), {automatic: true});
  const guard = jest.mocked(extensionManager.updateProvider).mock.calls[0][1]!;
  expect(guard()).toBe(true); mockEnabled = false; expect(guard()).toBe(false);
});
it('stops the remaining batch when automatic updates are disabled', async () => {
  jest.mocked(extensionManager.updateProvider).mockImplementation(async () => {mockEnabled = false; return false;});
  const result = await updateProvidersService.updateProviders([provider(), {...provider(), value: 'other'}], {automatic: true, showNotifications: false});
  expect(extensionManager.updateProvider).toHaveBeenCalledTimes(1);
  expect(result.failed).toEqual([]);
});
it('keeps the active source when another source has the same provider value', async () => {
  mockInstalled = [provider('B'), provider('A')]; mockActive = provider('A');
  await updateProvidersService.updateProviders([provider('B')], {showNotifications: false});
  expect(mockSetProvider).toHaveBeenCalledWith(provider('A'));
});
it('respects notification preferences when a source rate-limits an automatic check', async () => {
  jest.mocked(extensionManager.fetchManifest).mockRejectedValue(new Error('GitHub API rate limit exceeded'));
  await expect(updateProvidersService.checkForUpdatesAndAutoUpdate()).rejects.toThrow('rate limit');
  expect(notificationService.displayUpdateNotification).not.toHaveBeenCalled();
});

it('preserves the exact update failure for the manual error dialog', async () => {
  const error = new Error('Provider files are not synchronized: posts.js belongs to uhd v2.1, expected uhd v2.2.');
  jest.mocked(extensionManager.updateProvider).mockRejectedValue(error);
  await expect(updateProvidersService.updateProvider(provider(), {throwOnError: true})).rejects.toBe(error);
});
it('keeps a failed background update from aborting the batch', async () => {
  jest.mocked(extensionManager.updateProvider).mockRejectedValue(new Error('Provider files are not synchronized'));
  const result = await updateProvidersService.updateProviders([provider()], {automatic: true, showNotifications: false});
  expect(result.failed).toEqual([provider()]);
});
