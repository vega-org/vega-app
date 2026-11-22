import React from 'react';
import renderer, {act} from 'react-test-renderer';
import PlayerControlSettings from '../src/screens/settings/PlayerControlSettings';
import PlayerControlArrangement from '../src/components/PlayerControlArrangement';
import {settingsStorage} from '../src/lib/storage';

jest.mock('@react-navigation/native', () => ({useFocusEffect: jest.fn()}));
jest.mock('../src/components/PlayerControlArrangement', () => 'Arrangement');
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../src/components/tv', () => ({TVFocusGuide: 'FocusGuide', TVFocusable: 'FocusButton'}));
jest.mock('react-native-gesture-handler', () => ({GestureHandlerRootView: 'GestureRoot'}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({primary: '#fff'})}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {
  getPlayerControlLayout: () => ({top: ['cast'], bottom: ['audio'], more: []}),
  getHiddenPlayerControls: () => ['next'],
  getPlayerControlStyle: () => ({backgroundOpacity: 0.35}),
  setPlayerControlLayout: jest.fn(), setHiddenPlayerControls: jest.fn(),
  setPlayerControlStyle: jest.fn(), setAmbientVideoEnabled: jest.fn(),
  setAmbientIntensity: jest.fn(), setAmbientSpread: jest.fn(), setAmbientResponseMs: jest.fn(),
  setSubtitleFontSize: jest.fn(), setSubtitleTextOpacity: jest.fn(),
  setSubtitleOpacity: jest.fn(), setSubtitleBottomPadding: jest.fn(),
}}));

beforeEach(() => jest.clearAllMocks());


it('uses the shared Arrange component as a page, saves immediately, and does not save other settings', () => {
  const goBack = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<PlayerControlSettings navigation={{goBack} as any} route={{} as any} />);});
  const arrangement = tree.root.findByType(PlayerControlArrangement);
  expect(arrangement.props.page).toBe(true);
  expect(arrangement.props.controls).toEqual(expect.arrayContaining([expect.objectContaining({id: 'rotate'})]));
  expect(settingsStorage.setPlayerControlLayout).not.toHaveBeenCalled();
  const layout = {top: ['lock'], bottom: ['audio'], more: ['settings']};
  act(() => arrangement.props.onChange(layout, ['next']));
  expect(settingsStorage.setPlayerControlLayout).toHaveBeenCalledWith(layout);
  expect(settingsStorage.setHiddenPlayerControls).toHaveBeenCalledWith(['next']);
  expect(settingsStorage.setPlayerControlStyle).not.toHaveBeenCalled();
  expect(settingsStorage.setSubtitleFontSize).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({accessibilityLabel: 'Go back'}).props.onPress());
  expect(goBack).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
