const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createSplashVectorResources, writeSplashVectorResources} = require('../../plugins/splash-vector-resources');
const projectRoot = path.resolve(__dirname, '../..');
const variants = [
  {id: 'White', color: '#FFFFFFFF'},
  {id: 'Tomato', color: '#FFFF6347'},
  {id: 'Gray', color: '#FF9E9E9E'},
  {id: 'Blue', color: '#FF2196F3'},
  {id: 'Lavender', color: '#FFB2A4D4'},
];

test('every color has a completed fallback and an independently animated launch icon', () => {
  const svg = fs.readFileSync(path.join(projectRoot, 'assets/bootsplash/vega_circle.svg'), 'utf8');
  const files = createSplashVectorResources(svg, variants);
  const dialogBackground = files['drawable/vega_bootsplash_background.xml'];
  assert.match(dialogBackground, /android:drawable="\?attr\/bootSplashLogo" android:gravity="center"/);
  assert.doesNotMatch(dialogBackground, /<bitmap\b/);
  assert.equal(files['animator/bootsplash_play.xml'], undefined);
  assert.match(files['animator/bootsplash_ring_draw.xml'], /android:propertyName="trimPathEnd"/);
  assert.match(files['animator/bootsplash_ring.xml'], /android:propertyName="strokeAlpha"/);
  for (const {id, color} of variants) {
    const suffix = id.toLowerCase();
    const still = files[`drawable/bootsplash_logo_${suffix}.xml`];
    const motion = files[`drawable/bootsplash_motion_${suffix}.xml`];
    const animated = files[`drawable/bootsplash_animated_${suffix}.xml`];
    const playPattern = new RegExp(`<path android:name="play" android:pathData="[^"]+" android:fillColor="${color}" />`);
    assert.ok(still.includes(`android:fillColor="${color}"`));
    assert.ok(still.includes('android:fillColor="#D7DBDE"'));
    assert.ok(!still.includes('android:fillAlpha="0"'));
    // The start frame shows the whole logo: text and camera opaque, ring dim.
    assert.match(motion, /android:name="wordmark"[^/]*\/>/);
    assert.doesNotMatch(motion, /android:fillAlpha="0"/);
    assert.match(motion, /android:name="ring_draw"[^/]*android:trimPathEnd="0"/);
    assert.match(motion, /android:name="ring"[^/]*android:strokeAlpha="0.4"/);
    assert.match(still, playPattern);
    assert.match(motion, playPattern);
    assert.doesNotMatch(animated, /android:name="play"/);
    assert.match(animated, /android:name="ring_draw"/);
    assert.match(animated, /android:name="ring"/);
    assert.doesNotMatch(animated, /android:name="wordmark"/);
    assert.ok(
      files['values-v31/vega_splash.xml'].includes(
        `<item name="bootSplashLogo">@drawable/bootsplash_logo_${suffix}</item>`,
      ),
    );
    assert.ok(
      files['values-v31/vega_splash.xml'].includes(
        `<item name="android:windowSplashScreenAnimatedIcon">@drawable/bootsplash_motion_${suffix}</item>`,
      ),
    );
    assert.ok(!files['values-v31/vega_splash.xml'].includes(`@drawable/bootsplash_animated_${suffix}`));
  }
  assert.ok(!files['values-v31/vega_splash.xml'].includes('windowSplashScreenAnimationDuration'));
  assert.throws(() => createSplashVectorResources('<svg/>', variants), /Unexpected/);
});

test('incremental generation removes stale color bitmaps and leaves other artwork intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-splash-'));
  try {
    const bucket = path.join(root, 'drawable-mdpi');
    fs.mkdirSync(bucket);
    fs.writeFileSync(path.join(bucket, 'bootsplash_logo_white.png'), 'old');
    fs.writeFileSync(path.join(bucket, 'bootsplash_logo.png'), 'original');
    const animatorDir = path.join(root, 'animator');
    fs.mkdirSync(animatorDir);
    fs.writeFileSync(path.join(animatorDir, 'bootsplash_play.xml'), 'stale');
    fs.writeFileSync(path.join(animatorDir, 'other_animation.xml'), 'keep');
    writeSplashVectorResources(projectRoot, root, variants);
    const first = fs.readFileSync(path.join(root, 'drawable/bootsplash_logo_white.xml'), 'utf8');
    writeSplashVectorResources(projectRoot, root, variants);
    assert.equal(fs.existsSync(path.join(bucket, 'bootsplash_logo_white.png')), false);
    assert.equal(fs.readFileSync(path.join(bucket, 'bootsplash_logo.png'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(root, 'drawable/bootsplash_logo_white.xml'), 'utf8'), first);
    assert.equal(fs.existsSync(path.join(animatorDir, 'bootsplash_play.xml')), false);
    assert.equal(fs.readFileSync(path.join(animatorDir, 'other_animation.xml'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
