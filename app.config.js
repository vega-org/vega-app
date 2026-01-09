// Dynamic Expo config to make Firebase optional for public clones
// If google-services.json / GoogleService-Info.plist are absent, we skip RNFirebase plugins
// and android/ios google services config so the app still builds and runs without Firebase.

const fs = require('fs');

const hasAndroidGoogleServices = fs.existsSync('./google-services.json');
const hasIosGooglePlist = fs.existsSync('./GoogleService-Info.plist');

module.exports = () => {
  const plugins = [
    './plugins/android-native-config.js',
    './plugins/with-android-notification-icons.js',
    './plugins/with-android-release-gradle.js',
    './plugins/with-android-signing.js',
    './plugins/with-android-okhttp.js',
    // Only include RNFirebase plugins when a services file is present
    ...(hasAndroidGoogleServices || hasIosGooglePlist
      ? ['@react-native-firebase/app']
      : []),
    // Keep Crashlytics plugin optional; do not include analytics plugin to avoid ESM import issue
    ...(hasAndroidGoogleServices || hasIosGooglePlist
      ? ['@react-native-firebase/crashlytics']
      : []),
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
      'react-native-edge-to-edge',
      {
        android: {
          parentTheme: 'Default',
          enforceNavigationBarContrast: false,
        },
      },
    ],
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
          extraMavenRepos: [
            '../../node_modules/@notifee/react-native/android/libs',
          ],
          enableProguardInReleaseBuilds: true,
          splits: {
            abi: {enable: true, universalApk: true},
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
      '@react-native-tvos/config-tv',
      {
        isTV: true,
        androidTVBanner: './assets/adaptive_icon.png',
      },
    ],
  ];

  return {
    expo: {
      name: 'Vega',
      scheme: 'com.vega',
      displayName: 'Vega',
      newArchEnabled: true,
      autolinking: {exclude: ['expo-splash-screen']},
      plugins,
      slug: 'vega',
      version: '3.2.6',
      userInterfaceStyle: 'dark',
      android: {
        ...(hasAndroidGoogleServices
          ? {googleServicesFile: './google-services.json'}
          : {}),
        minSdkVersion: 24,
        edgeToEdgeEnabled: true,
        package: 'com.vega',
        versionCode: 155,
        permissions: [
          'FOREGROUND_SERVICE',
          'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
          'INTERNET',
          'MANAGE_EXTERNAL_STORAGE',
          'READ_EXTERNAL_STORAGE',
          'READ_MEDIA_VIDEO',
          'WRITE_EXTERNAL_STORAGE',
          'WRITE_SETTINGS',
        ],
        manifestPermissions: [
          {name: 'READ_EXTERNAL_STORAGE', maxSdkVersion: 32},
          {name: 'WRITE_EXTERNAL_STORAGE', maxSdkVersion: 32},
        ],
        queries: [
          {action: 'VIEW', data: {scheme: 'http'}},
          {action: 'VIEW', data: {scheme: 'https'}},
          {action: 'VIEW', data: {scheme: 'vlc'}},
        ],
        config: {requestLegacyExternalStorage: true},
        allowBackup: true,
        icon: './assets/icon.png',
        adaptiveIcon: {
          foregroundImage: './assets/adaptive_icon.png',
          backgroundColor: '#000000',
        },
        launchMode: 'singleTask',
        supportsPictureInPicture: true,
      },
      ios: {
        ...(hasIosGooglePlist
          ? {googleServicesFile: './GoogleService-Info.plist'}
          : {}),
      },
      platforms: ['ios', 'android'],
      extra: {
        hasFirebase: hasAndroidGoogleServices || hasIosGooglePlist,
      },
    },
  };
};
