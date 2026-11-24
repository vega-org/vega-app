import {Linking} from 'react-native';
import {checkStartupNotice, getMatchingStartupNotice} from '../src/lib/services/startupNotice';
import useAppDialogStore from '../src/lib/zustand/appDialogStore';

const mockDismissals = new Map<string, string>();
jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getString: (key: string) => mockDismissals.get(key),
    setString: (key: string, value: string) => mockDismissals.set(key, value),
  },
}));

const notice = {
  id: 'test-notice',
  title: 'Release information',
  description: 'See what changed.',
  buttons: [
    {label: 'Release notes', url: 'https://example.com/releases'},
    {label: 'Help', url: 'https://example.com/help'},
  ],
};
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  mockDismissals.clear();
  useAppDialogStore.getState().dismissDialog();
});

it('matches inclusive version bounds and the selected build channel', () => {
  const feed = {
    notice: {...notice, target: {minVersion: '5.4.1', maxVersion: '5.4.10', builds: ['github']}},
  };
  expect(getMatchingStartupNotice(feed, '5.4.1', 'github')).toEqual(notice);
  expect(getMatchingStartupNotice(feed, '5.4.10', 'github')).toEqual(notice);
  expect(getMatchingStartupNotice(feed, '5.4.1', 'playstore')).toBeUndefined();
  expect(getMatchingStartupNotice(feed, '5.4.1', 'standalone')).toBeUndefined();
  expect(getMatchingStartupNotice(feed, '5.4.0', 'github')).toBeUndefined();
  expect(getMatchingStartupNotice(feed, '5.4.11', 'github')).toBeUndefined();
});

it.each(['javascript:alert(1)', 'https:example.com', 'https://user@example.com'])(
  'ignores a notice with an invalid browser URL %s',
  url => {
    const feed = {notice: {...notice, buttons: [{label: 'Link', url}]}};
    expect(getMatchingStartupNotice(feed, '5.4.1', 'playstore')).toBeUndefined();
  },
);

it('waits for an existing dialog, opens links, and resets dismissal on version change', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({notice}),
  });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const signal = new AbortController().signal;
  const state = useAppDialogStore.getState;
  state().showDialog({title: 'Existing dialog', message: 'Please wait.'});

  await checkStartupNotice('5.4.1', 'standalone', signal);
  expect(state().dialog?.title).toBe('Existing dialog');
  state().dismissDialog();
  const buttons = state().dialog?.actions;
  expect(buttons?.map(button => button.label)).toEqual(['Release notes', 'Help']);
  buttons?.[1].onPress?.();
  expect(openURL).toHaveBeenCalledWith('https://example.com/help');
  state().dismissDialog();
  await checkStartupNotice('5.4.1', 'standalone', signal);
  const dismissOption = state().dialog?.dismissOption;
  expect(dismissOption?.label).toBe('Don’t show again');
  dismissOption?.onCheckedDismiss();
  state().dismissDialog();

  await checkStartupNotice('5.4.1', 'standalone', signal);
  expect(state().dialog).toBeUndefined();
  await checkStartupNotice('5.4.2', 'standalone', signal);
  expect(state().dialog?.title).toBe(notice.title);
});
