const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

test('with-android-okhttp pins WorkManager versions to avoid duplicate classes', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-okhttp-plugin-'));
  const appDir = path.join(projectRoot, 'android', 'app');
  fs.mkdirSync(appDir, {recursive: true});
  fs.writeFileSync(
    path.join(appDir, 'build.gradle'),
    'apply plugin: "com.facebook.react"\n',
    'utf8',
  );

  const module = {exports: {}};
  const code = fs.readFileSync(
    path.join(__dirname, '../../plugins/with-android-okhttp.js'),
    'utf8',
  );
  runInNewContext(`(function(require,module,exports){${code}\n})`, {
    require,
  })(name => {
    if (name === 'expo/config-plugins') {
      return {
        withDangerousMod: (_config, [, mod]) =>
          mod({
            modRequest: {projectRoot},
          }),
      };
    }
    return require(name);
  }, module, module.exports);

  await module.exports({});

  const gradlePatch = fs.readFileSync(path.join(appDir, 'with-okhttp.gradle'), 'utf8');
  assert.match(gradlePatch, /force "androidx\.work:work-runtime:2\.8\.0"/);
  assert.match(gradlePatch, /force "androidx\.work:work-runtime-ktx:2\.8\.0"/);
});
