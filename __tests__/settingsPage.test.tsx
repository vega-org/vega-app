import React, {useEffect, useState} from 'react';
import renderer, {act} from 'react-test-renderer';
import {FlatList, TextInput, View} from 'react-native';
import {NavigationRouteContext} from '@react-navigation/native';
import {SettingsSearchAnchor} from '../src/components/ui/SettingsSearchTarget';
import SettingsPage, {flattenSettingsChildren} from '../src/components/ui/SettingsPage';
import SettingsSection from '../src/components/ui/SettingsSection';
import TmdbApiKeyPreference from '../src/screens/settings/components/TmdbApiKeyPreference';

let mockIdle: (() => void) | undefined;
const mockCancel = jest.fn();
jest.mock('../src/lib/performance/idleWork', () => ({
  scheduleWhenIdle: (run: () => void) => { mockIdle = run; return mockCancel; },
}));

jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('@react-navigation/native', () => ({
  NavigationRouteContext: require('react').createContext(undefined),
  useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {getTmdbApiKey: () => '', setTmdbApiKey: jest.fn()}}));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({secondaryContainer: '#354862'})}));
jest.mock('../src/components/ui/Text', () => require('react-native').Text);
jest.mock('../src/components/ui/SettingsSection', () => ({children}: any) => children);
jest.mock('../src/components/tv', () => ({TVFocusable: require('react-native').View}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');

it('does not mount offscreen sections during the initial phone render', () => {
  const mounted: number[] = [];
  const Section = ({index}: {index: number}) => {
    useEffect(() => {mounted.push(index);}, [index]);
    return <View />;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<SettingsPage>{Array.from({length: 10}, (_, index) => <Section key={index} index={index} />)}</SettingsPage>);});
  expect(mounted).toEqual([0, 1, 2, 3]);
  act(() => tree.unmount());
});

it('preserves an unsaved metadata draft when the virtualized section remounts', () => {
  const Harness = ({visible}: {visible: boolean}) => {
    const [inputKey, setInputKey] = useState('');
    return visible ? <TmdbApiKeyPreference draft={{inputKey, setInputKey}} /> : null;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<Harness visible />);});
  act(() => tree.root.findByType(TextInput).props.onChangeText('unsaved-test-draft'));
  act(() => tree.update(<Harness visible={false} />));
  act(() => tree.update(<Harness visible />));
  expect(tree.root.findByType(TextInput).props.value).toBe('unsaved-test-draft');
  act(() => tree.unmount());
});

it('splits a large section so its rows do not mount as one batch', () => {
  const mounted: number[] = [];
  const Row = ({index}: {index: number}) => {
    useEffect(() => {mounted.push(index);}, [index]);
    return <View />;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<SettingsPage><SettingsSection title="Experience">{Array.from({length: 20}, (_, index) => <Row key={index} index={index} />)}</SettingsSection></SettingsPage>);});
  expect(mounted).toEqual([0, 1, 2]);
  act(() => tree.unmount());
});

it('keeps the full TV focus tree mounted', () => {
  const tv = require('../src/lib/tv');
  tv.isTV = true;
  const mounted: number[] = [];
  const Row = ({index}: {index: number}) => {
    useEffect(() => {mounted.push(index);}, [index]);
    return <View />;
  };
  let tree!: renderer.ReactTestRenderer;
  try {
    act(() => {tree = renderer.create(<SettingsPage>{Array.from({length: 10}, (_, index) => <Row key={index} index={index} />)}</SettingsPage>);});
    expect(mounted).toHaveLength(10);
  } finally {
    act(() => tree?.unmount());
    tv.isTV = false;
  }
});

it('flattens conditional fragments into separate rows without mounting their controls', () => {
  const rows = flattenSettingsChildren(<><View testID="one" />{false}<><View testID="two" /><View testID="three" /></></>);
  expect(rows).toHaveLength(3);
  expect(rows.map(row => (row as React.ReactElement<any>).props.testID)).toEqual(['one', 'two', 'three']);
});

it('mounts only the initial rows during navigation and expands after idle work is released', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(
    <SettingsPage><SettingsSection title="Playback"><>{Array.from({length: 10}, (_, i) => <View key={i} />)}</></SettingsSection></SettingsPage>,
  ); });
  const list = () => tree.root.findByType(FlatList);
  expect(list().props.data).toHaveLength(4);
  expect(list().props.maxToRenderPerBatch).toBe(1);
  act(() => mockIdle!());
  expect(list().props.data).toHaveLength(11);
  act(() => tree.unmount());
  expect(mockCancel).toHaveBeenCalled();
});

it('mounts and highlights a search destination outside the initial list window', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <NavigationRouteContext.Provider value={{key: 'preferences', name: 'Preferences', params: {setting: 'Target'}}}>
        <SettingsPage>
          {Array.from({length: 10}, (_, index) => <View key={index} />)}
          <SettingsSearchAnchor label="Target">
            <View testID="target-setting" />
          </SettingsSearchAnchor>
        </SettingsPage>
      </NavigationRouteContext.Provider>,
    );
  });
  // The row flashes once through an overlay instead of keeping a background.
  const flash = tree.root.findAllByProps({testID: 'settings-search-flash'});
  expect(flash.length).toBeGreaterThan(0);
  // No colored node wraps the row, so nothing stays highlighted after the flash.
  const colored = tree.root.findAllByType(View).filter(node => {
    const style = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style)
      : node.props.style;
    return style?.backgroundColor === '#354862';
  });
  for (const node of colored) {
    expect(node.findAllByProps({testID: 'target-setting'})).toHaveLength(0);
  }
  expect(tree.root.findByProps({testID: 'target-setting'})).toBeDefined();
  act(() => tree.unmount());
});
