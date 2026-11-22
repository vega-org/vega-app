import type {PlayerControlStyle} from '../../lib/player/controlStyle';
import type {RefObject} from 'react';
import type {View, ViewStyle, StyleProp, Animated, LayoutChangeEvent} from 'react-native';
import type Reanimated from 'react-native-reanimated';
import type {StyleProps} from 'react-native-reanimated';
import type {VideoRef, ReactVideoProps} from 'react-native-video';
import type {SkipInterval} from '../../lib/providers/types';

export type WithRequiredProperty<Type, Key extends keyof Type> = Type & {
  [Property in Key]-?: Type[Property];
};

export type VideoAnimations = {
  AnimatedView: typeof Reanimated.View | typeof Animated.View;
  hideControlAnimation: () => void;
  showControlAnimation: () => void;
  bottomControl: StyleProps; // type AnimatedViewStyle = Animated.AnimatedProps<ViewProps>['style'];
  topControl: StyleProps;
  controlsOpacity: StyleProps;
};

export interface VideoPlayerProps extends ReactVideoProps {
  animations?: VideoAnimations;
  useAnimations?: (controlAnimationTiming: number) => VideoAnimations;
  /**
   * If true, clicking the fullscreen button will toggle the <Video />
   * component between cover/contain, set to false
   * if you want to customize fullscreen behaviour
   *
   * @default false
   */
  toggleResizeModeOnFullscreen?: boolean;

  /**
   * The amount of time (in milliseconds) to animate the controls in and out.
   *
   * @default 500
   */
  controlAnimationTiming?: number;

  /**
   * Tapping twice within this amount of time in milliseconds is considered a double tap.
   * Single taps will not be actioned until this time has expired
   *
   * @default 100
   */
  doubleTapTime?: number;

  /**
   * The VideoPlayer fullscreen state.
   *
   * @default false
   */
  isFullscreen?: boolean;

  /**
   * Show or hide the controls on first render
   *
   * @default false
   */
  showOnStart?: boolean;

  /**
   * Controlled visibility of player controls.
   */
  showControls?: boolean;

  /**
   * Show or hide the controls on end of video
   *
   * @default false
   */
  showOnEnd?: boolean;

  /**
   * Always show controls.
   *
   * @default false
   */
  alwaysShowControls?: boolean;

  /**
   * Title of the video
   */
  title?: {primary: string; secondary?: string};

  /** Optional stream status displayed below the title and episode. */
  headerStatus?: string;
  /** Space reserved for the app's configurable top-right toolbar. */
  headerRightInset?: number;
  onHeaderLayout?: (event: LayoutChangeEvent) => void;
  controlScale?: number;
  controlAppearance?: PlayerControlStyle;
  ambientVideoSize?: {width: number; height: number} | null;
  ambientDisabled?: boolean;
  nativeVideoViewRef?: RefObject<View | null>;
  seekbarScale?: number;
  /** Temporarily freeze playback without changing the user's pause state. */
  playbackSuspended?: boolean;

  /**
   * If true, show the time remaing, else show the current time in the Player.
   *
   * @default false
   */
  showTimeRemaining?: boolean;

  /**
   * Show duration of the media.
   *
   * @default false
   */
  showDuration?: boolean;

  /**
   * If true, convert time to hours in the Player
   *
   * @default false
   */
  showHours?: boolean;

  /**
   * Function fired when back button is pressed, override if using custom navigation
   */
  onBack?: () => void;

  /**
   * Fired when the video enters fullscreen after the fullscreen button is pressed
   */
  onEnterFullscreen?: () => void;

  /**
   * Fired when the video exits fullscreen after the fullscreen button is pressed
   */
  onExitFullscreen?: () => void;

  /**
   * Fired when the controls disappear
   */
  onHideControls?: () => void;

  /**
   * Fired when the controls appear
   */
  onShowControls?: () => void;

  /**
   * Fired when the video is paused after the play/pause button is pressed
   */
  onPause?: () => void;

  /**
   * Fired when the video begins playing after the play/pause button is pressed
   */
  onPlay?: () => void;

  /**
   * Hide controls after X amount of time in milliseconds
   *
   * @default 15000
   */
  controlTimeoutDelay?: number;

  /**
   * If true, single tapping anywhere on the video (other than a control) toggles between playing and paused.
   *
   * @default false
   */
  tapAnywhereToPause?: boolean;

  /**
   * StyleSheet passed to the <Video /> component
   *
   */
  videoStyle?: StyleProp<ViewStyle>;

  /**
   * Container styles
   *
   */
  containerStyle?: StyleProp<ViewStyle>;

  /**
   * Fill/handle colour of the seekbar
   *
   * @default '#FFF'
   */
  seekColor?: string;

  /**
   * Hide the back button
   *
   * @default false
   */
  disableBack?: boolean;

  /**
   * Hide the Volume control
   *
   * @default false
   */
  disableVolume?: boolean;

  /**
   * Hide the fullscreen button
   *
   * @default false
   */
  disableFullscreen?: boolean;

  /**
   * Hide the timer
   *
   * @default false
   */
  disableTimer?: boolean;

  /**
   * Hide the seekbar
   *
   * @default false
   */
  disableSeekbar?: boolean;

  /**
   * Hide the play/pause toggle and the rewind/forward buttons
   *
   * @default false
   */
  disablePlayPause?: boolean;

  /**
   * Hide the rewind/forward buttons without hiding the play/pause button
   *
   * @default false
   */
  disableSeekButtons?: boolean;

  /**
   * Hide the transparent overlay which is active when the controls are shown. Generally used when you want to disable all the controls.
   *
   * @default false
   */
  disableOverlay?: boolean;

  /**
   * When using the default React Native navigator and do not override the `onBack` function,
   * you'll need to pass the navigator to the VideoPlayer for it to function
   *
   * @default null
   */
  navigator?: any;

  /**
   * Pass ref to the `<Video/>` component
   *
   * @default false
   */
  videoRef?: RefObject<VideoRef>;

  /**
   * Number of seconds to rewind or forward.
   *
   * @default 15
   */
  rewindTime?: number;

  /**
   * Object allowing fine grained control of the pan responder
   *
   * @default { horizontal: true, inverted: false }
   */
  pan?: {
    /**
     * Boolean representing if the player is oriented horizontally or vertically
     *
     * @default true
     */
    horizontal?: boolean;

    /**
     * Boolean representing if the player controls pan gesture should be inverted
     *
     * @default false
     */
    inverted?: boolean;
  };
  /**
   * testID selector for testing
   */
  testID?: string;

  /**
   * Disable the gesture for the player
   *
   * @default false
   */
  disableGesture?: boolean;

  /**
   * is Player Locked
   *
   * @default false
   */
  hideAllControlls?: boolean;

  /** Fired once when a seek drag magnetically returns to its starting point. */
  onSeekSnap?: () => void;

  /** Skip intervals (intro/outro/recap) to display as gaps in the seekbar */
  skips?: SkipInterval[];
}
