import {NativeModules, Platform} from 'react-native';
import BootSplash from 'react-native-bootsplash';

// Hard safety cap: 1100 ms vector draw animation + 1100 ms buffer.
export const SPLASH_FALLBACK_HIDE_MS = 2200;

interface AnimatedSplashNativeModule {
  hide?: (fade: boolean) => Promise<boolean>;
}

export async function hideBootSplash(options?: {fade?: boolean}): Promise<void> {
  const fade = Boolean(options?.fade);
  const animatedSplash =
    Platform.OS === 'android'
      ? (NativeModules.AnimatedSplash as AnimatedSplashNativeModule | undefined)
      : undefined;

  await Promise.all([
    BootSplash.hide(options),
    animatedSplash?.hide ? animatedSplash.hide(fade) : Promise.resolve(),
  ]);
}
