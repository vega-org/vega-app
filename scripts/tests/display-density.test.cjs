const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const path = require('node:path');

let transform;
const pluginModule = {exports: {}};
const source = readFileSync(path.join(__dirname, '../../plugins/with-display-density.js'), 'utf8');
runInNewContext('(function(require,module,exports){' + source + '\n})', {})(name => {
  assert.equal(name, 'expo/config-plugins');
  return {withMainActivity: (config, callback) => {transform = callback; return config;}};
}, pluginModule, pluginModule.exports);
pluginModule.exports({});

for (const newline of ['\n', '\r\n']) {
  for (const existingHandler of [false, true]) {
    test(`activity metrics synchronization preserves lifecycle code (existing handler=${existingHandler}, CRLF=${newline.length === 2})`, () => {
      const original = `package com.vega
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    RNBootSplash.init(this, R.style.BootTheme)
    super.onCreate(null)
    existingStartupWork()
  }
${existingHandler ? `  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    existingConfigurationWork()
  }` : ''}
}
`.replaceAll('\n', newline);
      const config = {modResults: {language: 'kt', contents: original}};
      transform(config);
      const generated = config.modResults.contents;
      assert.equal((generated.match(/initDisplayMetrics\(this\)/g) || []).length, 2);
      assert.equal((generated.match(/override fun onConfigurationChanged/g) || []).length, 1);
      assert.match(generated, /super\.onCreate\(null\)\s+com\.facebook\.react\.uimanager\.DisplayMetricsHolder\.initDisplayMetrics\(this\)\s+existingStartupWork/);
      assert.match(generated, /super\.onConfigurationChanged\(newConfig\)\s+com\.facebook\.react\.uimanager\.DisplayMetricsHolder\.initDisplayMetrics\(this\)/);
      assert.ok(generated.includes('RNBootSplash.init(this, R.style.BootTheme)'));
      if (existingHandler) assert.ok(generated.includes('existingConfigurationWork()'));
      transform(config);
      assert.equal(config.modResults.contents, generated);
    });
  }
}

test('prebuild fails visibly if the expected lifecycle template changes', () => {
  assert.throws(() => transform({modResults: {language: 'kt', contents: 'class MainActivity {}'}}), /onCreate changed/);
  assert.throws(() => transform({modResults: {language: 'java', contents: ''}}), /Kotlin MainActivity/);
});
