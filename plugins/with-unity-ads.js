const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
  withProjectBuildGradle,
} = require('expo/config-plugins');

// Unity LevelPlay (ironSource) Android SDK, Maven Central.
const LEVELPLAY_DEPENDENCIES = [
  "implementation 'com.unity3d.ads-mediation:mediation-sdk:9.5.0'",
  // Google advertising identifier support, as LevelPlay's integration guide asks.
  "implementation 'com.google.android.gms:play-services-appset:16.0.0'",
  "implementation 'com.google.android.gms:play-services-ads-identifier:18.1.0'",
  "implementation 'com.google.android.gms:play-services-basement:18.1.0'",
];

// Release builds are minified, so LevelPlay's keep rules are needed
// (from LevelPlay's Android integration guide, "For ProGuard users only").
const PROGUARD_MARKER = '# Vega: LevelPlay';
const PROGUARD_RULES = `
${PROGUARD_MARKER}
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
-keep class com.google.android.gms.appset.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep class com.ironsource.adapters.** { *; }
-dontwarn com.ironsource.**
-dontwarn com.ironsource.adapters.**
-keepclassmembers class com.ironsource.** { public *; }
-keep public class com.ironsource.**
-dontwarn com.iab.omid.**
-keep class com.iab.omid.** {*;}
-keepattributes JavascriptInterface
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keep public interface com.ironsource.mediationsdk.sdk** {*; }
-keep public interface com.ironsource.mediationsdk.impressionData.ImpressionDataListener {*; }
-keep class * extends android.app.Activity
`;

// The Kotlin bridge itself (native-src/android/com/vega/UnityAdsModule.kt) is
// copied by with-custom-native-modules.js; this plugin adds the SDK dependency,
// the keep rules and registers the package.
function withUnityAds(config) {
  config = withProjectBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;
    // LevelPlay is on Maven Central; make sure it is in the repository list.
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
    if (!cfg.modResults.contents.includes('com.unity3d.ads-mediation:mediation-sdk')) {
      const lines = LEVELPLAY_DEPENDENCIES.map(dep => `    ${dep}`).join('\n');
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n${lines}\n`,
      );
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async cfg => {
      const proguardRulesFile = path.join(
        cfg.modRequest.projectRoot,
        'android',
        'app',
        'proguard-rules.pro',
      );
      if (fs.existsSync(proguardRulesFile)) {
        const content = fs.readFileSync(proguardRulesFile, 'utf8');
        if (!content.includes(PROGUARD_MARKER)) {
          fs.writeFileSync(proguardRulesFile, content + PROGUARD_RULES, 'utf8');
        }
      }
      return cfg;
    },
  ]);

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
