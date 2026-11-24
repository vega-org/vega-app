const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const path = require('node:path');

test('prebuild keeps QR scanning and portrait orientation optional for TV installation', () => {
  let configureManifest;
  const module = {exports: {}};
  const code = readFileSync(path.join(__dirname, '../../plugins/android-native-config.js'), 'utf8');
  runInNewContext(`(function(require,module,exports){${code}\n})`, {})(name => {
    assert.equal(name, 'expo/config-plugins');
    return {
      withAndroidManifest: (config, callback) => {configureManifest = callback; return config;},
      withAndroidStyles: config => config,
    };
  }, module, module.exports);
  module.exports({});
  const features = [
    {$: {'android:name': 'android.hardware.camera', 'android:required': 'true'}},
    {$: {'android:name': 'unrelated.feature', 'android:required': 'true'}},
  ];
  const config = {modResults: {manifest: {'uses-feature': features, application: []}}};
  configureManifest(config);
  configureManifest(config); // Repeated prebuild must not duplicate requirements.
  for (const name of ['android.hardware.camera', 'android.hardware.camera.any', 'android.hardware.camera.autofocus', 'android.hardware.touchscreen', 'android.hardware.screen.portrait', 'android.hardware.microphone', 'android.hardware.wifi']) {
    const matches = features.filter(feature => feature.$['android:name'] === name);
    assert.equal(matches.length, 1, name);
    assert.equal(matches[0].$['android:required'], 'false', name);
  }
  assert.equal(features.find(feature => feature.$['android:name'] === 'unrelated.feature').$['android:required'], 'true');
});
