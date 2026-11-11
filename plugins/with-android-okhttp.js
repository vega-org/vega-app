const fs = require('fs');
const path = require('path');
const {withDangerousMod} = require('expo/config-plugins');

/**
 * Adds OkHttp dependencies and force resolution strategy after prebuild.
 * Generates a Gradle file that applies OkHttp dependencies and resolution strategy.
 */
module.exports = function withAndroidOkHttp(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appDir = path.join(projectRoot, 'android', 'app');
      const buildGradle = path.join(appDir, 'build.gradle');
      const okHttpGradle = path.join(appDir, 'with-okhttp.gradle');

      // Create OkHttp gradle that adds dependencies and force resolution
      const okHttpContent = `// Auto-applied by with-android-okhttp config plugin
dependencies {
    implementation "com.squareup.okhttp3:okhttp:4.12.0"
    implementation "com.squareup.okhttp3:logging-interceptor:4.12.0"
    implementation "com.squareup.okhttp3:okhttp-urlconnection:4.12.0"
}

// Force resolution in case React Native or other libs pull old versions
configurations.all {
    resolutionStrategy {
        force "com.squareup.okhttp3:okhttp:4.12.0"
        force "com.squareup.okhttp3:logging-interceptor:4.12.0"
        force "com.squareup.okhttp3:okhttp-urlconnection:4.12.0"
        force "androidx.work:work-runtime:2.8.0"
        force "androidx.work:work-runtime-ktx:2.8.0"
    }
}
`;
      fs.writeFileSync(okHttpGradle, okHttpContent, 'utf8');

      // Idempotently add apply from with-okhttp.gradle after existing apply lines
      let gradleText = fs.readFileSync(buildGradle, 'utf8');
      if (!gradleText.includes("apply from: 'with-okhttp.gradle'")) {
        // Find the last apply from line and add our line after it
        const applyFromLines = gradleText.match(/apply from: '[^']+'/g);
        if (applyFromLines && applyFromLines.length > 0) {
          const lastApplyFrom = applyFromLines[applyFromLines.length - 1];
          gradleText = gradleText.replace(
            lastApplyFrom,
            `${lastApplyFrom}\napply from: 'with-okhttp.gradle'`,
          );
        } else {
          // If no apply from lines found, add after React plugin
          gradleText = gradleText.replace(
            /apply plugin: "com\.facebook\.react"/,
            `apply plugin: "com.facebook.react"\napply from: 'with-okhttp.gradle'`,
          );
        }
        fs.writeFileSync(buildGradle, gradleText, 'utf8');
      }

      return cfg;
    },
  ]);
};
