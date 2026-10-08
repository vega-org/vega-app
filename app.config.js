const fs = require('fs');
const path = require('path');

const androidGoogleServicesFile = './google-services.json';
const iosGoogleServicesFile = './GoogleService-Info.plist';
const hasAndroidGoogleServices = fs.existsSync(
  path.resolve(__dirname, androidGoogleServicesFile),
);
const hasIosGooglePlist = fs.existsSync(
  path.resolve(__dirname, iosGoogleServicesFile),
);
const tmdbApiKey =
  process.env.TMDB_API_KEY || process.env.EXPO_PUBLIC_TMDB_API_KEY || '';
const proxyApiUrl =
  process.env.PROXY_API_URL ||
  process.env.EXPO_PUBLIC_PROXY_API_URL ||
  process.env.META_PROXY_URL ||
  '';

module.exports = () => {
  const IS_PLAYSTORE = process.env.APP_VARIANT === 'playstore';
  const IS_TV = process.env.EXPO_TV === '1' || process.env.APP_VARIANT === 'tv';
  const HAS_FIREBASE =
    !IS_PLAYSTORE && (hasAndroidGoogleServices || hasIosGooglePlist);
  const PACKAGE_NAME = IS_PLAYSTORE ? 'vega.app' : 'com.vega';
  const APP_SCHEME = IS_PLAYSTORE ? 'vegaapp' : 'com.vega';
  const plugins = [
    './plugins/with-custom-native-modules.js',
    './plugins/android-native-config.js',
    './plugins/with-saf-copy-module.js',
    './plugins/with-uri-permission-module.js',
    './plugins/with-proguard-rules.js',
    './plugins/with-jvm-args.js',
    './plugins/with-android-notification-icons.js',
    './plugins/with-notifee-service.js',
    './plugins/with-android-release-gradle.js',
    './plugins/with-android-signing.js',
    './plugins/with-android-okhttp.js',
    ...(HAS_FIREBASE ? ['@react-native-firebase/app'] : []),
    ...(HAS_FIREBASE ? ['@react-native-firebase/crashlytics'] : []),
    [
      'react-native-video',
      {
        enableNotificationControls: true,
        enableAndroidPictureInPicture: true,
        androidExtensions: {
          useExoplayerRtsp: false,
          useExoplayerSmoothStreaming: true,
          useExoplayerHls: true,
          useExoplayerDash: true,
        },
      },
    ],
    [
      'react-native-google-cast',
      {
        expandedController: true,
      },
    ],
    'react-native-edge-to-edge',
    // Manifest mods execute in reverse order: configure TV before moving its
    // launcher intent onto the color aliases.
    './plugins/with-dynamic-launcher-splash.js',
    [
      'react-native-bootsplash',
      {
        assetsDir: 'assets/bootsplash',
        android: {
          parentTheme: 'EdgeToEdge',
        },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // libtorrent4j's native library is built for API 28 and calls libc
          // functions (getentropy, aligned_alloc) missing before Android 9.
          minSdkVersion: 28,
          usePrecompiledHeaders: true,
          // ByeDPI and WARP run bundled binaries from nativeLibraryDir, so the
          // .so files must be extracted on install.
          useLegacyPackaging: true,
          extraMavenRepos: [
            '../../node_modules/@notifee/react-native/android/libs',
          ],
          enableProguardInReleaseBuilds: true,
          splits: {
            abi: {
              enable: true,
              reset: false,
              include: ['armeabi-v7a', 'arm64-v8a'],
              universalApk: true,
            },
          },
          buildVariants: {
            release: {
              minifyEnabled: true,
              shrinkResources: true,
              splits: {
                abi: {
                  enable: true,
                  reset: false,
                  include: ['armeabi-v7a', 'arm64-v8a'],
                },
              },
            },
            debug: {minifyEnabled: false, debuggable: true},
          },
        },
        ios: {},
      },
    ],

    [
      'expo-dev-client',
      {
        launchMode: 'most-recent',
      },
    ],
    'expo-font',
    'expo-status-bar',
    ...(IS_TV
      ? [
          [
            '@react-native-tvos/config-tv',
            {
              isTV: true,
              androidTVBanner: './assets/tv-banner.png',
            },
          ],
        ]
      : []),
  ];
  return {
    expo: {
      name: 'Vega',
      scheme: APP_SCHEME,
      displayName: 'Vega',
      jsEngine: 'hermes',
      newArchEnabled: true,
      autolinking: {exclude: ['expo-splash-screen']},
      plugins,
      slug: 'vega',
      version: '5.0.2',
      userInterfaceStyle: 'dark',
      experiments: {
        reactCompiler: true,
      },
      android: {
        ...(!IS_PLAYSTORE && hasAndroidGoogleServices
          ? {googleServicesFile: androidGoogleServicesFile}
          : {}),
        package: PACKAGE_NAME,
        versionCode: 200,
        permissions: [
          'FOREGROUND_SERVICE',
          'FOREGROUND_SERVICE_DATA_SYNC',
          'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
          'ACCESS_NETWORK_STATE',
          'ACCESS_WIFI_STATE',
          'CHANGE_WIFI_MULTICAST_STATE',
          'INTERNET',
          'WRITE_SETTINGS',
          'WAKE_LOCK',
          'POST_NOTIFICATIONS',
        ],
        blockedPermissions: [
          'android.permission.MANAGE_EXTERNAL_STORAGE',
          'android.permission.READ_EXTERNAL_STORAGE',
          'android.permission.READ_MEDIA_VIDEO',
          'android.permission.WRITE_EXTERNAL_STORAGE',
          ...(IS_PLAYSTORE
            ? [
                'android.permission.REQUEST_INSTALL_PACKAGES',
                'com.google.android.gms.permission.AD_ID',
              ]
            : []),
        ],
        queries: [
          {action: 'VIEW', data: {scheme: 'http'}},
          {action: 'VIEW', data: {scheme: 'https'}},
          {action: 'VIEW', data: {scheme: 'vlc'}},
        ],
        allowBackup: true,
        adaptiveIcon: {
          foregroundImage: './assets/adaptive_icon.png',
          backgroundColor: '#000000',
        },
        launchMode: 'singleTask',
        supportsPictureInPicture: true,
      },
      ios: {
        ...(!IS_PLAYSTORE && hasIosGooglePlist
          ? {googleServicesFile: iosGoogleServicesFile}
          : {}),
      },
      platforms: ['ios', 'android'],
      extra: {
        eas: {
          projectId: '40d98354-d3c8-4616-ab2e-70d9c297091f',
        },
        hasFirebase: HAS_FIREBASE,
        isPlayStore: IS_PLAYSTORE,
        isTV: IS_TV,
        tmdbApiKey,
        proxyApiUrl,
      },
    },
  };
};
