import React from 'react';
import renderer, {act} from 'react-test-renderer';
import GenreChips from '../src/components/search/GenreChips';

const mockNavigate = jest.fn();
const mockGetGenres = jest.fn();
const mockProvider = {value: 'vega', display_name: 'Vega'};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: (selector: (state: object) => unknown) =>
    selector({provider: mockProvider}),
}));

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {
    getGenres: (params: object) => mockGetGenres(params),
  },
}));

jest.mock('../src/theme/M3PaletteContext', () => ({
  useM3Colors: () => ({
    onSurface: '#FFFFFF',
    outlineVariant: '#555555',
    surfaceContainerHigh: '#222222',
  }),
}));

jest.mock('../src/components/ui/Text', () => {
  const {Text} = require('react-native');
  return {__esModule: true, default: Text};
});

const render = async () => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<GenreChips />);
  });
  return tree!;
};

describe('GenreChips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the genre list of the selected provider', async () => {
    mockGetGenres.mockResolvedValue([
      {title: 'Action', filter: '/genre/action'},
      {title: 'Comedy', filter: '/genre/comedy'},
    ]);

    const tree = await render();
    const chips = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    );

    expect(mockGetGenres).toHaveBeenCalledWith({providerValue: 'vega'});
    expect(chips).toHaveLength(2);

    act(() => {
      chips[1].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('ScrollList', {
      filter: '/genre/comedy',
      title: 'Comedy',
      providerValue: 'vega',
      isSearch: false,
    });
  });

  it('renders nothing when the provider has no genres', async () => {
    mockGetGenres.mockResolvedValue([]);

    const tree = await render();

    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing when loading genres fails', async () => {
    mockGetGenres.mockRejectedValue(new Error('sandbox error'));

    const tree = await render();

    expect(tree.toJSON()).toBeNull();
  });
});
