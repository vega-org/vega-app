const {
  withMainApplication,
  withAppBuildGradle,
  withProjectBuildGradle,
} = require('expo/config-plugins');

// Unity Ads Android SDK (Maven Central: com.unity3d.ads:unity-ads).
const UNITY_ADS_DEPENDENCY = "implementation 'com.unity3d.ads:unity-ads:4.18.0'";

// The Kotlin bridge itself (native-src/android/com/vega/UnityAdsModule.kt) is
// copied by with-custom-native-modules.js; this plugin adds the SDK dependency
// and registers the package.
function withUnityAds(config) {
  config = withProjectBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;
    // Unity Ads is on Maven Central; make sure it is in the repository list.
    if (!/mavenCentral\(\)/.test(contents)) {
      contents = contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        match => `${match}\n        mavenCentral()`,
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withAppBuildGradle(config, cfg => {
    if (!cfg.modResults.contents.includes('com.unity3d.ads:unity-ads')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n    ${UNITY_ADS_DEPENDENCY}\n`,
      );
    }
    return cfg;
  });

  config = withMainApplication(config, cfg => {
    if (!cfg.modResults.contents.includes('add(UnityAdsPackage())')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /PackageList\(this\)\.packages\.apply \{\n/,
        match => `${match}              add(UnityAdsPackage())\n`,
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withUnityAds;
