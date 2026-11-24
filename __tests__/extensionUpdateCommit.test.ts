import axios from 'axios';
import {ExtensionManager} from '../src/lib/services/ExtensionManager';
import {extensionStorage} from '../src/lib/storage/extensionStorage';

jest.mock('axios', () => ({get: jest.fn()}));
jest.mock('../src/lib/storage/StorageService', () => ({mainStorage: {}}));
jest.mock('../src/lib/storage/sourceTokenStorage', () => ({getSourceAuthHeaders: () => ({}), sourceTokenStorage: {has: () => false}}));
jest.mock('../src/lib/utils/helpers', () => ({getProviderFilesUrl: () => 'https://example.com/provider', isValidProviderPath: () => true}));
jest.mock('../src/lib/storage/extensionStorage', () => ({extensionStorage: {
  getInstalledProviders: jest.fn(), isProviderInstalled: jest.fn(), cacheProviderModules: jest.fn(), installProvider: jest.fn(), removeProviderModules: jest.fn(),
}}));
const provider = (version: string) => ({value: 'movie', display_name: 'Movie', source: {author: 'A', url: 'https://example.com'}, version} as any);
const bundle = (version: string) => ({value: 'movie', sourceAuthor: 'A', version, modules: {posts: 'code', meta: 'code', stream: 'code', catalog: 'code'}, cachedAt: 0} as any);
beforeEach(() => {
  jest.clearAllMocks();
  let installed = provider('1.0');
  jest.mocked(extensionStorage.isProviderInstalled).mockReturnValue(true);
  jest.mocked(extensionStorage.getInstalledProviders).mockImplementation(() => [installed]);
  jest.mocked(extensionStorage.installProvider).mockImplementation(next => {installed = next;});
});
it('does not commit downloaded code or version after auto updates are disabled', async () => {
  const manager = new ExtensionManager(); let enabled = true;
  jest.spyOn(manager, 'downloadProviderModules').mockImplementation(async () => {enabled = false; return bundle('2.0');});
  expect(await manager.updateProvider(provider('2.0'), () => enabled)).toBe(false);
  expect(extensionStorage.cacheProviderModules).not.toHaveBeenCalled();
  expect(extensionStorage.installProvider).not.toHaveBeenCalled();
});
it('does not reinstall a provider removed during download', async () => {
  const manager = new ExtensionManager();
  jest.spyOn(manager, 'downloadProviderModules').mockImplementation(async () => {jest.mocked(extensionStorage.isProviderInstalled).mockReturnValue(false); return bundle('2.0');});
  expect(await manager.updateProvider(provider('2.0'))).toBe(false);
  expect(extensionStorage.installProvider).not.toHaveBeenCalled();
});
it('commits modules and the install record only after a successful download', async () => {
  const manager = new ExtensionManager();
  jest.spyOn(manager, 'downloadProviderModules').mockResolvedValue(bundle('2.0'));
  expect(await manager.updateProvider(provider('2.0'))).toBe(true);
  expect(extensionStorage.cacheProviderModules).toHaveBeenCalledWith(bundle('2.0'));
  expect(extensionStorage.installProvider).toHaveBeenCalledWith(provider('2.0'));
});
it('does not treat a temporary episodes download timeout as a successful update', async () => {
  const manager = new ExtensionManager();
  jest.mocked(axios.get).mockImplementation(async (url: any) => {
    if (String(url).includes('/episodes.js')) throw new Error('timeout');
    return {data: 'module code'};
  });
  await expect(manager.updateProvider(provider('2.0'))).rejects.toThrow('timeout');
});
it('does not let a slower older update overwrite a newer completed update', async () => {
  const manager = new ExtensionManager(); let release!: (value: any) => void;
  jest.spyOn(manager, 'downloadProviderModules').mockImplementation(async (_url, _author, _value, version) => {
    if (version === '2.0') return new Promise(resolve => {release = resolve;});
    return bundle(version);
  });
  const older = manager.updateProvider(provider('2.0'));
  await manager.updateProvider(provider('3.0'));
  release(bundle('2.0')); await older;
  expect(jest.mocked(extensionStorage.installProvider).mock.calls.at(-1)![0].version).toBe('3.0');
});

const stampedCode = (version = '2.0') =>
  `// @vega-provider movie\n// @vega-version ${version}\nexports.fixture=true;`;

it('rejects a stale CDN module and keeps the installed code and version', async () => {
  const manager = new ExtensionManager();
  jest.mocked(axios.get).mockResolvedValue({data: stampedCode('1.0')});
  await expect(manager.updateProvider(provider('2.0')))
    .rejects.toThrow('not synchronized');
  expect(extensionStorage.cacheProviderModules).not.toHaveBeenCalled();
  expect(extensionStorage.installProvider).not.toHaveBeenCalled();
  expect(axios.get).toHaveBeenCalledTimes(12);
});
it('recovers with one fresh request for a stale module', async () => {
  const manager = new ExtensionManager();
  const streamUrls: string[] = [];
  jest.mocked(axios.get).mockImplementation(async (url: any) => {
    if (String(url).includes('/stream.js')) streamUrls.push(url);
    return {data: stampedCode(String(url).includes('/stream.js') && streamUrls.length === 1 ? '1.0' : '2.0')};
  });
  expect(await manager.updateProvider(provider('2.0'))).toBe(true);
  expect(streamUrls).toHaveLength(2);
  expect(streamUrls[0]).not.toBe(streamUrls[1]);
  expect(axios.get).toHaveBeenCalledTimes(7);
  expect(extensionStorage.installProvider).toHaveBeenCalled();
});
it('allows headerless third-party provider installations', async () => {
  const manager = new ExtensionManager();
  jest.mocked(axios.get).mockResolvedValue({data: 'exports.legacy=true;'});
  await manager.installProvider(provider('2.0'));
  expect(extensionStorage.cacheProviderModules).toHaveBeenCalled();
  expect(extensionStorage.installProvider).toHaveBeenCalled();
});
it('continues to support wholly unstamped legacy sources', async () => {
  const manager = new ExtensionManager();
  jest.mocked(axios.get).mockResolvedValue({data: 'exports.legacy=true;'});
  expect(await manager.updateProvider(provider('2.0'))).toBe(true);
});
it('rejects partial stamp rollouts even for legacy sources', async () => {
  const manager = new ExtensionManager();
  jest.mocked(axios.get).mockImplementation(async (url: any) =>
    ({data: String(url).includes('/settings.js') ? 'exports.legacy=true;' : stampedCode()}));
  await expect(manager.updateProvider(provider('2.0'))).rejects.toThrow('mixed versioned and unversioned');
  expect(extensionStorage.cacheProviderModules).not.toHaveBeenCalled();
});
