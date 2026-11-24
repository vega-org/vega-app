import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {decidePlaybackError} from '../src/lib/player/playbackErrorRetry';

// Exercise the actual Player callback without mounting native video, navigation,
// casting and download services unrelated to this error-recovery regression.
const source = fs.readFileSync(path.join(__dirname, '../src/screens/home/Player.tsx'), 'utf8');
const ast = ts.createSourceFile('Player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleVideoError') {
    callback = (node.initializer as ts.CallExpression).arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
if (!callback) throw new Error('Player error callback not found');
const compiled = ts.transpileModule(`return (${callback});`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

const setup = () => {
  const stream = {server: 'A', link: 'https://a.test/expired.mp4', type: 'mp4'};
  const pending: Array<{resolve: (result: boolean) => void; reject: (error: Error) => void}> = [];
  const switchServer = jest.fn(() => false);
  const context = {
    console: {log: jest.fn()}, Date,
    route: {params: {}}, selectedStreamRef: {current: stream},
    playbackRetryRef: {current: {stream, retried: true, loadedAt: null}},
    linkRefreshRef: {current: null},
    pendingLinkRefreshRef: {current: null},
    activeEpisodeKeyRef: {current: 'episode-1'},
    isTorrentStream: () => false, isLocalPath: () => false,
    decidePlaybackError,
    ToastAndroid: {show: jest.fn(), SHORT: 0},
    refreshLinks: jest.fn(() => new Promise<boolean>((resolve, reject) => {
      pending.push({resolve, reject});
    })),
    switchToNextStream: switchServer,
    switchToNextStreamRef: {current: switchServer},
    navigation: {isFocused: jest.fn(() => true), goBack: jest.fn()},
    setShowControls: jest.fn(),
  };
  const onError = new Function(...Object.keys(context), compiled)(...Object.values(context));
  const error = {error: {errorCode: '22004'}};
  return {context, pending, onError: () => onError(error), switchServer};
};
const settle = async () => {for (let i = 0; i < 5; i++) await Promise.resolve();};

it('waits for the pending refresh despite repeated native errors', async () => {
  const {context, pending, onError, switchServer} = setup();
  onError(); onError(); onError();
  expect(context.refreshLinks).toHaveBeenCalledTimes(1);
  expect(switchServer).not.toHaveBeenCalled();
  expect(context.navigation.goBack).not.toHaveBeenCalled();
  pending[0].resolve(true);
  await settle();
  expect(switchServer).not.toHaveBeenCalled();
  expect(context.pendingLinkRefreshRef.current).toBeNull();
});

it.each(['unchanged', 'rejected'])('falls back once when the refresh is %s', async result => {
  const {context, pending, onError, switchServer} = setup();
  onError(); onError();
  if (result === 'rejected') pending[0].reject(new Error('Network error'));
  else pending[0].resolve(false);
  await settle();
  expect(switchServer).toHaveBeenCalledTimes(1);
  expect(context.navigation.goBack).toHaveBeenCalledTimes(1);
  expect(context.pendingLinkRefreshRef.current).toBeNull();
});

it('does not navigate away after the user changes episodes', async () => {
  const {context, pending, onError, switchServer} = setup();
  onError();
  context.activeEpisodeKeyRef.current = 'episode-2';
  pending[0].resolve(false);
  await settle();
  expect(switchServer).not.toHaveBeenCalled();
  expect(context.navigation.goBack).not.toHaveBeenCalled();
});

it('does not block a new stream or clear its guard when an older refresh finishes', async () => {
  const {context, pending, onError, switchServer} = setup();
  onError();
  const next = {server: 'B', link: 'https://b.test/expired.mp4', type: 'mp4'};
  context.selectedStreamRef.current = next;
  context.playbackRetryRef.current = {stream: next, retried: true, loadedAt: null};
  context.activeEpisodeKeyRef.current = 'episode-2';
  onError();
  expect(context.refreshLinks).toHaveBeenCalledTimes(2);
  const newGuard = context.pendingLinkRefreshRef.current;
  pending[0].resolve(false);
  await settle();
  expect(context.pendingLinkRefreshRef.current).toBe(newGuard);
  onError();
  expect(switchServer).not.toHaveBeenCalled();
  expect(context.refreshLinks).toHaveBeenCalledTimes(2);
  pending[1].resolve(true);
  await settle();
  expect(context.pendingLinkRefreshRef.current).toBeNull();
});
