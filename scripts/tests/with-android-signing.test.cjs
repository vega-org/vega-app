const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

test('with-android-signing keeps debug signing fallback when release env vars are missing', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-signing-plugin-'));
  const appDir = path.join(projectRoot, 'android', 'app');
  fs.mkdirSync(appDir, {recursive: true});
  fs.writeFileSync(
    path.join(appDir, 'build.gradle'),
    `android {
  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
`,
    'utf8',
  );

  const savedEnv = {
    MYAPP_UPLOAD_STORE_FILE: process.env.MYAPP_UPLOAD_STORE_FILE,
    MYAPP_UPLOAD_STORE_PASSWORD: process.env.MYAPP_UPLOAD_STORE_PASSWORD,
    MYAPP_UPLOAD_KEY_ALIAS: process.env.MYAPP_UPLOAD_KEY_ALIAS,
    MYAPP_UPLOAD_KEY_PASSWORD: process.env.MYAPP_UPLOAD_KEY_PASSWORD,
  };
  delete process.env.MYAPP_UPLOAD_STORE_FILE;
  delete process.env.MYAPP_UPLOAD_STORE_PASSWORD;
  delete process.env.MYAPP_UPLOAD_KEY_ALIAS;
  delete process.env.MYAPP_UPLOAD_KEY_PASSWORD;

  try {
    const module = {exports: {}};
    const code = fs.readFileSync(
      path.join(__dirname, '../../plugins/with-android-signing.js'),
      'utf8',
    );
    runInNewContext(`(function(require,module,exports){${code}\n})`, {
      require,
      process,
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

    const buildGradle = fs.readFileSync(path.join(appDir, 'build.gradle'), 'utf8');
    assert.match(buildGradle, /signingConfig signingConfigs\.debug/);
  } finally {
    process.env.MYAPP_UPLOAD_STORE_FILE = savedEnv.MYAPP_UPLOAD_STORE_FILE;
    process.env.MYAPP_UPLOAD_STORE_PASSWORD = savedEnv.MYAPP_UPLOAD_STORE_PASSWORD;
    process.env.MYAPP_UPLOAD_KEY_ALIAS = savedEnv.MYAPP_UPLOAD_KEY_ALIAS;
    process.env.MYAPP_UPLOAD_KEY_PASSWORD = savedEnv.MYAPP_UPLOAD_KEY_PASSWORD;
  }
});
