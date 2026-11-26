import React from 'react';
import renderer, {act} from 'react-test-renderer';
import ContentOverview, {
  shouldShowSearchInOverview,
} from '../src/screens/home/components/ContentOverview';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0}),
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-linear-gradient', () => 'Gradient');
jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    background: '#000',
    onBackground: '#fff',
    onSurfaceVariant: '#ccc',
    primary: '#fff',
  }),
}));
jest.mock('../src/components/Skeleton', () => 'Skeleton');
jest.mock('../src/lib/tv/useTVFocusBorderColor', () => ({
  useTVFocusBorderColor: () => '#fff',
}));
jest.mock('../src/lib/tv', () => ({isTV: false}));
jest.mock('../src/lib/zustand/tvNavigationStore', () => ({
  __esModule: true,
  default: {getState: () => ({})},
}));
jest.mock('../src/components/tv', () => ({TVFocusable: 'Focusable'}));
jest.mock('../src/screens/home/components/SynopsisText', () => 'SynopsisText');

const renderOverview = (
  props: Partial<React.ComponentProps<typeof ContentOverview>> = {},
) => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ContentOverview
        inLibrary={false}
        isLoading={false}
        providerName="NetflixMirror"
        readMore={false}
        synopsis="Synopsis"
        synopsisLoading={false}
        title="Spider-Man: Brand New Day"
        onBack={() => {}}
        onSearchTitle={() => {}}
        onToggleLibrary={() => {}}
        onToggleSynopsis={() => {}}
        {...props}
      />,
    );
  });
  return tree;
};

describe('shouldShowSearchInOverview', () => {
  it('keeps Search on the page when fewer than 3 other action buttons exist', () => {
    expect(
      shouldShowSearchInOverview({
        hasFollow: false,
        hasWeb: false,
        hasExploreOrTrailer: false,
      }),
    ).toBe(true);
    expect(
      shouldShowSearchInOverview({
        hasFollow: true,
        hasWeb: false,
        hasExploreOrTrailer: false,
      }),
    ).toBe(true);
    expect(
      shouldShowSearchInOverview({
        hasFollow: false,
        hasWeb: true,
        hasExploreOrTrailer: false,
      }),
    ).toBe(true);
    expect(
      shouldShowSearchInOverview({
        hasFollow: false,
        hasWeb: false,
        hasExploreOrTrailer: true,
      }),
    ).toBe(true);
  });

  it('moves Search out of the page when 3 or more other action buttons exist', () => {
    expect(
      shouldShowSearchInOverview({
        hasFollow: true,
        hasWeb: false,
        hasExploreOrTrailer: true,
      }),
    ).toBe(false);
    expect(
      shouldShowSearchInOverview({
        hasFollow: true,
        hasWeb: true,
        hasExploreOrTrailer: false,
      }),
    ).toBe(false);
    expect(
      shouldShowSearchInOverview({
        hasFollow: false,
        hasWeb: true,
        hasExploreOrTrailer: true,
      }),
    ).toBe(false);
    expect(
      shouldShowSearchInOverview({
        hasFollow: true,
        hasWeb: true,
        hasExploreOrTrailer: true,
      }),
    ).toBe(false);
  });
});

describe('ContentOverview action bar Search placement', () => {
  it('renders Follow, Search, and Save on the page when only Follow and Save exist', () => {
    const onSearchTitle = jest.fn();
    const tree = renderOverview({
      onFollowShow: () => {},
      onSearchTitle,
    });

    const labels = tree.root
      .findAllByType('Focusable' as any)
      .map(node => node.props.accessibilityLabel)
      .filter(label => label !== 'Go back');

    expect(labels).toEqual(['Follow', 'Search', 'Save']);

    act(() => {
      tree.root.findByProps({accessibilityLabel: 'Search'}).props.onPress();
    });
    expect(onSearchTitle).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('keeps Search on the page with Explore and Save when Follow and Web are absent', () => {
    const tree = renderOverview({
      onOpenStory: () => {},
    });

    const labels = tree.root
      .findAllByType('Focusable' as any)
      .map(node => node.props.accessibilityLabel)
      .filter(label => label !== 'Go back');

    expect(labels).toEqual(['Search', 'Explore', 'Save']);
    act(() => tree.unmount());
  });

  it('omits Search from the page when Follow, Explore, and Save are shown', () => {
    const tree = renderOverview({
      onFollowShow: () => {},
      onOpenStory: () => {},
    });

    const labels = tree.root
      .findAllByType('Focusable' as any)
      .map(node => node.props.accessibilityLabel)
      .filter(label => label !== 'Go back');

    expect(labels).toEqual(['Follow', 'Explore', 'Save']);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Search'})).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });

  it('omits Search from the page when Web, Explore, and Save are shown without Follow', () => {
    const tree = renderOverview({
      onOpenWeb: () => {},
      onOpenStory: () => {},
    });

    const labels = tree.root
      .findAllByType('Focusable' as any)
      .map(node => node.props.accessibilityLabel)
      .filter(label => label !== 'Go back');

    expect(labels).toEqual(['Web', 'Explore', 'Save']);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Search'})).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });

  it('omits Search from the page when Follow, Trailer, and Save are shown', () => {
    const tree = renderOverview({
      onFollowShow: () => {},
      trailerUrl: 'https://example.com/trailer',
    });

    const labels = tree.root
      .findAllByType('Focusable' as any)
      .map(node => node.props.accessibilityLabel)
      .filter(label => label !== 'Go back');

    expect(labels).toEqual(['Follow', 'Trailer', 'Save']);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Search'})).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });
});
