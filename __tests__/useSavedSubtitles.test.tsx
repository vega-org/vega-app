import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useSavedSubtitles} from '../src/lib/hooks/useSavedSubtitles';

const mockEntries = new Map<string, any[]>();
const mockListeners = new Set<() => void>();
let mockGate: Promise<void> | undefined;
jest.mock('../src/lib/subtitles/savedSubtitles', () => ({
  loadSavedSubtitles: async (key: string) => mockEntries.get(key) || [],
  subscribeSavedSubtitles: (callback: () => void) => {mockListeners.add(callback); return () => mockListeners.delete(callback);},
  saveSubtitle: async (key: string, track: object) => {
    await mockGate;
    const saved = {...track, id: 'saved', videoKey: key};
    mockEntries.set(key, [saved]); mockListeners.forEach(callback => callback());
    return saved;
  },
  removeSavedSubtitle: async (key: string) => {mockEntries.set(key, []); mockListeners.forEach(callback => callback());},
}));

let result: ReturnType<typeof useSavedSubtitles>;
let tree: renderer.ReactTestRenderer;
const Probe = ({video}: {video: string}) => {result = useSavedSubtitles(video); return null;};
const flush = () => act(async () => {await new Promise(resolve => setImmediate(resolve));});
beforeEach(() => {mockEntries.clear(); mockGate = undefined;});
afterEach(() => {act(() => tree?.unmount()); expect(mockListeners.size).toBe(0);});

it('restores saved choices on reopening and updates the list after removal', async () => {
  act(() => {tree = renderer.create(<Probe video="episode-1" />);});
  await flush();
  await act(async () => {await result.saveSubtitle({uri: 'https://subs.test/en.srt'}, 'search');});
  expect(result.savedSubtitles).toHaveLength(1);
  act(() => tree.unmount());
  act(() => {tree = renderer.create(<Probe video="episode-1" />);});
  await flush();
  expect(result.savedSubtitles).toHaveLength(1);
  await act(async () => {await result.removeSavedSubtitle('saved');});
  await flush();
  expect(result.savedSubtitles).toHaveLength(0);
});

it('a subtitle downloaded after an episode switch is saved only for the original episode', async () => {
  let finish!: () => void;
  mockGate = new Promise(resolve => {finish = resolve;});
  act(() => {tree = renderer.create(<Probe video="episode-1" />);});
  await flush();
  const downloading = result.saveSubtitle({uri: 'https://subs.test/en.srt'}, 'search');
  act(() => tree.update(<Probe video="episode-2" />));
  await flush();
  let saved;
  await act(async () => {finish(); saved = await downloading;});
  expect(saved).toBeUndefined();
  expect(result.savedSubtitles).toHaveLength(0);
  expect(mockEntries.get('episode-1')).toHaveLength(1);
  expect(mockEntries.get('episode-2')).toBeUndefined();
});

it('finishes caching after unmount without applying it to a closed player', async () => {
  let finish!: () => void;
  mockGate = new Promise(resolve => {finish = resolve;});
  act(() => {tree = renderer.create(<Probe video="episode-1" />);});
  await flush();
  const downloading = result.saveSubtitle({uri: 'https://subs.test/en.srt'}, 'search');
  act(() => tree.unmount());
  finish();
  await expect(downloading).resolves.toBeUndefined();
  expect(mockEntries.get('episode-1')).toHaveLength(1);
});
