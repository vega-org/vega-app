import React from 'react';
import {Alert} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import Extensions from '../src/screens/settings/Extensions';

const existingProvider = {
  value: 'existing',
  display_name: 'Existing',
  source: {author: 'fixture', url: 'https://example.test/fixture'},
  version: '1.0',
  icon: '',
  disabled: false,
  type: 'global' as const,
  installed: true,
};

const newProvider = {
  value: 'slow-provider',
  display_name: 'Slow Provider',
  source: {author: 'fixture', url: 'https://example.test/fixture'},
  version: '1.3',
  icon: '',
  disabled: false,
  type: 'english' as const,
  installed: false,
};

let mockActiveProvider = existingProvider;
let mockInstalledProviders = [existingProvider];
const mockSetProvider = jest.fn();
const mockSetInstalledProviders = jest.fn();
const mockSetAvailableProviders = jest.fn();
const mockInstallProvider = jest.fn();

jest.mock('../src/lib/zustand/themeStore', () => ({
  __esModule: true,
  default: (selector: (state: {primary: string}) => unknown) =>
    selector({primary: '#ff6b57'}),
}));

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({
      provider: mockActiveProvider,
      setProvider: mockSetProvider,
      installedProviders: mockInstalledProviders,
      availableProviders: [newProvider],
      setInstalledProviders: mockSetInstalledProviders,
      setAvailableProviders: mockSetAvailableProviders,
    }),
}));

jest.mock('../src/lib/storage/extensionStorage', () => ({
  extensionStorage: {
    getProviderSource: jest.fn(() => ({
      author: 'fixture',
      url: 'https://example.test/fixture',
    })),
    getInstalledProviders: jest.fn(() => mockInstalledProviders),
    getAvailableProviders: jest.fn(() => [newProvider]),
    isProviderInstalled: jest.fn(() => false),
  },
}));

jest.mock('../src/lib/services/ExtensionManager', () => ({
  extensionManager: {
    initialize: jest.fn(async () => undefined),
    installProvider: (...args: unknown[]) => mockInstallProvider(...args),
  },
}));

jest.mock('../src/lib/services/UpdateProviders', () => ({
  updateProvidersService: {
    checkForUpdatesManual: jest.fn(async () => []),
  },
}));

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    isHapticFeedbackEnabled: jest.fn(() => false),
  },
}));

jest.mock('../src/screens/settings/components/ProviderSourceManager', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../src/components/RenderProviderFLagIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
  Feather: () => null,
  FontAwesome6: () => null,
  MaterialIcons: () => null,
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

describe('Extensions provider installation', () => {
  let tree: renderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    mockActiveProvider = existingProvider;
    mockInstalledProviders = [existingProvider];
    mockSetProvider.mockClear();
    mockSetInstalledProviders.mockClear();
    mockSetAvailableProviders.mockClear();
    mockInstallProvider.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      tree?.unmount();
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps the current provider active after installing another provider', async () => {
    mockInstallProvider.mockImplementation(async () => {
      mockInstalledProviders = [
        existingProvider,
        {...newProvider, installed: true},
      ];
    });

    await act(async () => {
      tree = renderer.create(
        <Extensions
          navigation={{navigate: jest.fn()} as never}
          route={{} as never}
        />,
      );
    });

    act(() => {
      tree!.root
        .findByProps({testID: 'available-providers-tab'})
        .props.onPress();
    });

    await act(async () => {
      await tree!.root
        .findByProps({testID: 'install-provider-fixture:slow-provider'})
        .props.onPress();
    });

    expect(mockInstallProvider).toHaveBeenCalledWith(newProvider);
    expect(mockSetInstalledProviders).toHaveBeenCalledWith(
      mockInstalledProviders,
    );
    expect(mockSetProvider).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Slow Provider has been installed successfully!',
    );
  });

  it('does not change the active provider when installation fails', async () => {
    mockInstallProvider.mockRejectedValue(new Error('fixture download failed'));

    await act(async () => {
      tree = renderer.create(
        <Extensions
          navigation={{navigate: jest.fn()} as never}
          route={{} as never}
        />,
      );
    });

    act(() => {
      tree!.root
        .findByProps({testID: 'available-providers-tab'})
        .props.onPress();
    });

    await act(async () => {
      await tree!.root
        .findByProps({testID: 'install-provider-fixture:slow-provider'})
        .props.onPress();
    });

    expect(mockSetProvider).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Failed to install provider. Please try again.',
    );
  });

  it('activates the first provider installed during initial setup', async () => {
    mockActiveProvider = {...existingProvider, value: '', display_name: ''};
    mockInstalledProviders = [];
    mockInstallProvider.mockImplementation(async () => {
      mockInstalledProviders = [{...newProvider, installed: true}];
    });

    await act(async () => {
      tree = renderer.create(
        <Extensions
          navigation={{navigate: jest.fn()} as never}
          route={{} as never}
        />,
      );
    });

    await act(async () => {
      await tree!.root
        .findByProps({testID: 'install-provider-fixture:slow-provider'})
        .props.onPress();
    });

    expect(mockSetProvider).toHaveBeenCalledWith(newProvider);
  });
});
