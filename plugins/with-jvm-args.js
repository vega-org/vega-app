const {withGradleProperties} = require('expo/config-plugins');

// Keep the Gradle daemon within a memory budget that fits alongside the Kotlin
// compiler workers and Metro. A 4GB heap starves memory-constrained hosts
// (e.g. WSL2) and causes the VM to be OOM-killed mid-build.
const GRADLE_PROPERTIES = {
  'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=768m',
  // Cap concurrent Gradle workers so parallel module builds don't spike RAM.
  'org.gradle.workers.max': '4',
  // Bound the Kotlin daemon heap; it otherwise sizes to the host and adds up.
  'kotlin.daemon.jvmargs': '-Xmx1536m',
  // The source-built ARMv7 FFmpeg libraries are produced by the Linux build job.
  'reactNativeArchitectures': process.platform === 'win32'
    ? 'arm64-v8a'
    : 'armeabi-v7a,arm64-v8a',
  'expo.useLegacyPackaging': 'true',
  // Store the Hermes bundle uncompressed so it is memory-mapped at launch
  // instead of inflated into RAM first. Faster cold start and less memory on
  // low-end phones and TV boxes, for a slightly larger APK.
  'android.enableBundleCompression': 'true',
};

function upsertProperty(modResults, key, value) {
  const existing = modResults.find(
    item => item.type === 'property' && item.key === key,
  );
  if (existing) {
    existing.value = value;
  } else {
    modResults.push({type: 'property', key, value});
  }
}

module.exports = function withJvmArgs(config) {
  return withGradleProperties(config, cfg => {
    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      upsertProperty(cfg.modResults, key, value);
    }
    return cfg;
  });
};
