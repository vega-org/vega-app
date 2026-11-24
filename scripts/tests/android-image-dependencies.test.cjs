const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const path = require('node:path');

test('native prebuild keeps Fresco alignment across regeneration without duplicating Gradle rules', () => {
  let configureProject;
  const pluginModule = {exports: {}};
  const source = readFileSync(path.join(__dirname, '../../plugins/with-custom-native-modules.js'), 'utf8');
  runInNewContext('(function(require,module,exports){' + source + '\n})', {})(name => {
    if (name !== 'expo/config-plugins') return require(name);
    return {
      withProjectBuildGradle: (config, callback) => {configureProject = callback; return config;},
      withDangerousMod: config => config,
      withMainApplication: config => config,
      withAppBuildGradle: config => config,
      withAndroidManifest: config => config,
    };
  }, pluginModule, pluginModule.exports);
  pluginModule.exports({});
  const original = 'buildscript { repositories { google() } }\n';
  const config = {modResults: {contents: original}};
  configureProject(config);
  const generated = config.modResults.contents;
  assert.ok(generated.startsWith(original));
  assert.match(generated, /requested\.group == 'com\.facebook\.fresco'[\s\S]*?useVersion '3\.7\.0'/);
  assert.match(generated, /requested\.group == 'androidx\.media3'[\s\S]*?useVersion '1\.8\.0'/);
  configureProject(config);
  assert.equal(config.modResults.contents, generated);
});
