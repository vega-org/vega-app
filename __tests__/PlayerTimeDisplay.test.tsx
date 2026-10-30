import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

const mockStorageMap = new Map<string, any>();

jest.mock('@dr.pogodin/react-native-fs', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }
    initialize() {
      return {
        getBool: (key: string, defaultValue = false) => {
          return mockStorageMap.has(key) ? mockStorageMap.get(key) : defaultValue;
        },
        setBool: (key: string, value: boolean) => {
          mockStorageMap.set(key, value);
          return true;
        },
        getString: (key: string, defaultValue = '') => {
          return mockStorageMap.has(key) ? mockStorageMap.get(key) : defaultValue;
        },
        setString: (key: string, value: string) => {
          mockStorageMap.set(key, value);
          return true;
        },
        clearStore: () => mockStorageMap.clear(),
      };
    }
  },
}));

import {Seekbar} from '../src/components/media-console/components/Seekbar';
import {formatTime, calculateTime} from '../src/components/media-console/utils';
import {settingsStorage} from '../src/lib/storage';

describe('formatTime', () => {
  it('formats elapsed time and remaining time correctly for short media', () => {
    // 30 seconds into a 120-second video
    const elapsed = formatTime({
      time: 30,
      duration: 120,
      showDuration: true,
      showHours: false,
      showTimeRemaining: false,
    });
    expect(elapsed).toBe('00:30');

    const remaining = formatTime({
      time: 90,
      duration: 120,
      showDuration: true,
      showHours: false,
      showTimeRemaining: true,
    });
    expect(remaining).toBe('-01:30');
  });

  it('formats hours consistently when media is 1 hour or longer', () => {
    // 5 minutes into a 1 hour 45 minute video (6300 seconds)
    const elapsed = formatTime({
      time: 300,
      duration: 6300,
      showDuration: true,
      showHours: true,
      showTimeRemaining: false,
    });
    expect(elapsed).toBe('00:05:00');

    const duration = formatTime({
      time: 6300,
      duration: 6300,
      showDuration: true,
      showHours: true,
      showTimeRemaining: false,
    });
    expect(duration).toBe('01:45:00');

    const remaining = formatTime({
      time: 6000,
      duration: 6300,
      showDuration: true,
      showHours: true,
      showTimeRemaining: true,
    });
    expect(remaining).toBe('-01:40:00');
  });

  it('calculateTime provides elapsed and remaining time when showTimeRemaining is true', () => {
    const timeStr = calculateTime({
      time: 60,
      duration: 180,
      showDuration: true,
      showHours: false,
      showTimeRemaining: true,
    });
    expect(timeStr).toBe('01:00/-02:00');
  });
});

describe('Seekbar time display and click behavior (VLC-style)', () => {
  it('renders elapsed time on left and total duration on right when showTimeRemaining is false', () => {
    let tree!: renderer.ReactTestRenderer;
    const toggleTimer = jest.fn();
    const resetControlTimeout = jest.fn();

    act(() => {
      tree = renderer.create(
        <Seekbar
          controlScale={1}
          seekbarScale={1}
          seekerFillWidth={50}
          seekerPosition={50}
          cachedPosition={100}
          seekColor="#fff"
          seekerPanHandlers={{}}
          setSeekerWidth={jest.fn()}
          time={45}
          duration={300}
          showDuration
          showHours={false}
          showTimeRemaining={false}
          toggleTimer={toggleTimer}
          resetControlTimeout={resetControlTimeout}
          seeking={false}
          previewTime={45}
          thumbnailUri={null}
          thumbnailLoading={false}
          snapPosition={null}
        />,
      );
    });

    const texts = tree.root.findAllByType(Text);
    expect(texts[0].props.children).toBe('00:45'); // Left: Elapsed
    expect(texts[texts.length - 1].props.children).toBe('05:00'); // Right: Total duration

    const timeButtons = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function' &&
        (node.props.accessibilityLabel === 'Show remaining time' ||
          node.props.accessibilityLabel === 'Show total duration'),
    );
    expect(timeButtons.length).toBe(2);

    // Clicking left time button toggles timer
    act(() => {
      timeButtons[0].props.onPress();
    });
    expect(toggleTimer).toHaveBeenCalledTimes(1);
    expect(resetControlTimeout).toHaveBeenCalledTimes(1);

    // Clicking right time button also toggles timer (VLC behavior)
    act(() => {
      timeButtons[1].props.onPress();
    });
    expect(toggleTimer).toHaveBeenCalledTimes(2);
    expect(resetControlTimeout).toHaveBeenCalledTimes(2);

    act(() => tree.unmount());
  });

  it('renders elapsed time on left and remaining time with minus on right when showTimeRemaining is true', () => {
    let tree!: renderer.ReactTestRenderer;
    const toggleTimer = jest.fn();
    const resetControlTimeout = jest.fn();

    act(() => {
      tree = renderer.create(
        <Seekbar
          controlScale={1}
          seekbarScale={1}
          seekerFillWidth={50}
          seekerPosition={50}
          cachedPosition={100}
          seekColor="#fff"
          seekerPanHandlers={{}}
          setSeekerWidth={jest.fn()}
          time={45}
          duration={300}
          showDuration
          showHours={false}
          showTimeRemaining={true}
          toggleTimer={toggleTimer}
          resetControlTimeout={resetControlTimeout}
          seeking={false}
          previewTime={45}
          thumbnailUri={null}
          thumbnailLoading={false}
          snapPosition={null}
        />,
      );
    });

    const texts = tree.root.findAllByType(Text);
    expect(texts[0].props.children).toBe('00:45'); // Left: Current elapsed position
    expect(texts[texts.length - 1].props.children).toBe('-04:15'); // Right: Remaining time (300 - 45 = 255s = 4m 15s)

    act(() => tree.unmount());
  });
});

describe('SettingsStorage showTimeRemaining persistence', () => {
  it('persists and retrieves showTimeRemaining', () => {
    settingsStorage.setShowTimeRemaining(true);
    expect(settingsStorage.isShowTimeRemaining()).toBe(true);

    settingsStorage.setShowTimeRemaining(false);
    expect(settingsStorage.isShowTimeRemaining()).toBe(false);
  });
});
