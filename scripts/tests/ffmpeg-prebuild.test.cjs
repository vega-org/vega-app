const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

function plugin() {
  let copyNative, configureGradle;
  const module = {exports: {}};
  const code = fs.readFileSync(path.resolve(__dirname, '../../plugins/with-custom-native-modules.js'), 'utf8');
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})(name => {
    if (name === 'expo/config-plugins') return {
      withProjectBuildGradle: config => config,
      withMainApplication: config => config,
      withAndroidManifest: config => config,
      withDangerousMod: (config, [, callback]) => {copyNative = callback; return config;},
      withAppBuildGradle: (config, callback) => {configureGradle = callback; return config;},
    };
    return require(name);
  }, module, module.exports);
  module.exports({});
  return {copyNative, configureGradle};
}

test('prebuild copies ARMv7 FFmpeg and license notices without replacing other native libraries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-ffmpeg-prebuild-'));
  try {
    const write = (relative, content) => {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, content);
    };
    write('native-src/android/jniLibs/armeabi-v7a/libciadpi.so', 'existing');
    write('.native/ffmpeg-armv7/armeabi-v7a/libffmpegkit.so', 'armv7');
    write('.native/ffmpeg-armv7/licenses/SOURCE.txt', 'pinned source');
    await plugin().copyNative({modRequest: {projectRoot: root}, android: {package: 'vega.app'}});
    const base = path.join(root, 'android/app/src/main');
    assert.equal(fs.readFileSync(path.join(base, 'jniLibs/armeabi-v7a/libciadpi.so'), 'utf8'), 'existing');
    assert.equal(fs.readFileSync(path.join(base, 'jniLibs/armeabi-v7a/libffmpegkit.so'), 'utf8'), 'armv7');
    assert.equal(fs.readFileSync(path.join(base, 'assets/ffmpeg-armv7/SOURCE.txt'), 'utf8'), 'pinned source');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('prebuild aligns existing Maven dependency and adds one mandatory release check', () => {
  const {configureGradle} = plugin();
  const cfg = {modResults: {contents: "dependencies {\n implementation 'dev.ffmpegkit-maintained:ffmpeg-kit-https:8.1.8'\n}\n"}};
  configureGradle(cfg);
  configureGradle(cfg);
  const gradle = cfg.modResults.contents;
  assert.match(gradle, /ffmpeg-kit-https:8\.1\.9/);
  assert.doesNotMatch(gradle, /ffmpeg-kit-https:8\.1\.8/);
  assert.equal((gradle.match(/tasks.register\('verifyFfmpegArmv7'\)/g) || []).length, 1);
  assert.match(gradle, /endsWith\('ReleaseNativeLibs'\).*dependsOn\(verifyFfmpegArmv7\)/);
  assert.match(gradle, /ffmpegkit_abidetect/);
});
