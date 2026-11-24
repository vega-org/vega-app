import {useWafStore} from '../src/lib/zustand/wafStore';
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import VerificationConsentDialog from '../src/components/VerificationConsentDialog';
import VerificationWindowPreference from '../src/screens/settings/components/VerificationWindowPreference';
import {useVerificationConsentStore} from '../src/lib/zustand/verificationConsentStore';
import MaterialDialogSurface from '../src/components/ui/MaterialDialogSurface';
import SettingsRow from '../src/components/ui/SettingsRow';
import {TVFocusable} from '../src/components/tv';

let mockPolicy = 'ask';
jest.mock('../src/lib/storage/SettingsStorage', () => ({settingsStorage: {
  getVerificationWindowPolicy: () => mockPolicy,
  setVerificationWindowPolicy: (value: string) => {mockPolicy = value;},
}}));
jest.mock('@expo/vector-icons/MaterialIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect])}));
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/SettingsRow', () => 'SettingsRow');
jest.mock('../src/components/ui/MaterialDialogSurface', () => 'DialogSurface');
jest.mock('../src/components/tv', () => ({TVFocusable: 'Button'}));

let tree: renderer.ReactTestRenderer;
const press = (label: string) => act(() => {
  tree.root.findAllByType(TVFocusable).find(node => node.props.accessibilityLabel === label)!.props.onPress();
});
beforeEach(() => {
  mockPolicy = 'ask';
  useWafStore.setState({requests: []});
  useVerificationConsentStore.setState({requests: []});
});
afterEach(() => {act(() => tree?.unmount());});

it('shows the origin and warning, and sends the remembered Allow decision', () => {
  const finish = jest.fn();
  useVerificationConsentStore.setState({requests: [{id: 1, provider: 'Movie provider', url: 'https://site.test/private-path?token=secret', finish}]});
  act(() => {tree = renderer.create(<VerificationConsentDialog />);});
  const text = tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
  expect(text).toContain('https://site.test');
  expect(text).not.toContain('token=secret');
  expect(text).toContain('Only enter personal information');
  const cancel = tree.root.findAllByType(TVFocusable).find(node => node.props.accessibilityLabel === 'Cancel')!;
  expect(cancel.props.hasTVPreferredFocus).toBe(true);
  expect(cancel.props.registerScreenFocus).toBe(false);
  press('Remember my choice');
  press('Allow');
  expect(finish).toHaveBeenCalledWith(true, true);
});

it('resets Remember for each queued site, and dismissing never saves a choice', () => {
  const first = jest.fn(), second = jest.fn();
  useVerificationConsentStore.setState({requests: [{id: 1, provider: 'one', url: 'https://one.test', finish: first}]});
  act(() => {tree = renderer.create(<VerificationConsentDialog />);});
  press('Remember my choice');
  act(() => useVerificationConsentStore.setState({requests: [{id: 2, provider: 'two', url: 'https://two.test', finish: second}]}));
  press('Cancel');
  expect(second).toHaveBeenCalledWith(false, false);
  act(() => tree.root.findByType(MaterialDialogSurface).props.onDismiss());
  expect(second).toHaveBeenLastCalledWith(false);
});

it('offers Ask, Allow and Block in settings and saves each selection', () => {
  act(() => {tree = renderer.create(<VerificationWindowPreference />);});
  for (const [label, policy] of [['Always allow', 'allow'], ['Block', 'block'], ['Ask each time', 'ask']]) {
    act(() => tree.root.findByType(SettingsRow).props.onPress());
    press(label);
    expect(mockPolicy).toBe(policy);
    expect(tree.root.findAllByType(MaterialDialogSurface)).toHaveLength(0);
    expect(tree.root.findByType(SettingsRow).props.description).toContain(label);
  }
});


it('waits for an active verification window to close before showing the next warning', () => {
  useVerificationConsentStore.setState({requests: [{id: 1, provider: 'next', url: 'https://next.test', finish: jest.fn()}]});
  useWafStore.setState({requests: [{id: 2, author: 'a', url: 'https://current.test', resolve: jest.fn(), reject: jest.fn()}]});
  act(() => {tree = renderer.create(<VerificationConsentDialog />);});
  expect(tree.root.findAllByType(MaterialDialogSurface)).toHaveLength(0);
  act(() => useWafStore.setState({requests: []}));
  expect(tree.root.findAllByType(MaterialDialogSurface)).toHaveLength(1);
});
