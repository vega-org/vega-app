import React, {useState} from 'react';
import renderer, {act} from 'react-test-renderer';
import ContentOverview from '../src/screens/home/components/ContentOverview';

jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-linear-gradient', () => 'Gradient');
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({primary: '#fff', onSurfaceVariant: '#ccc'})}));
jest.mock('../src/components/Skeleton', () => 'Skeleton');
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({useTVFocusBorderColor: () => '#fff'}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/zustand/tvNavigationStore', () => ({__esModule: true, default: {getState: () => ({})}}));
jest.mock('../src/components/tv', () => ({TVFocusable: 'Focusable'}));

const synopsis = 'An imported series with a full synopsis. '.repeat(15);
function ImportedSeries() {
  const [expanded, setExpanded] = useState(false);
  return <ContentOverview inLibrary isLoading={false} providerName="Local content"
    title="Imported series" synopsis={synopsis} synopsisLoading={false} readMore={expanded}
    onToggleSynopsis={() => setExpanded(value => !value)}
    onBack={() => {}} onSearchTitle={() => {}} onToggleLibrary={() => {}} />;
}

it('keeps imported series Read more in the Synopsis header and expands/collapses the complete text', () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree = renderer.create(<ImportedSeries />);});
  const button = tree.root.findByProps({accessibilityLabel: 'Read more synopsis'});
  expect(button.props.accessibilityState.expanded).toBe(false);
  // The expansion control shares the heading row, rather than following text.
  expect(button.parent?.findAll(node => node.props.children === 'Synopsis').length).toBeGreaterThan(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain(synopsis);
  act(() => button.props.onPress());
  expect(tree.root.findByProps({accessibilityLabel: 'Show less synopsis'}).props.accessibilityState.expanded).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain(synopsis);
  act(() => tree.root.findByProps({accessibilityLabel: 'Show less synopsis'}).props.onPress());
  expect(JSON.stringify(tree.toJSON())).not.toContain(synopsis);
});
