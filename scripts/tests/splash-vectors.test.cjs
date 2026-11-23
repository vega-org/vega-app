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
  for (const {id, color} of variants) {
    const suffix = id.toLowerCase();
    const still = files[`drawable/bootsplash_logo_${suffix}.xml`];
    const motion = files[`drawable/bootsplash_motion_${suffix}.xml`];
    assert.ok(still.includes(`android:fillColor="${color}"`));
    assert.ok(still.includes('android:fillColor="#D7DBDE"'));
    assert.ok(!still.includes('android:fillAlpha="0"'));
    assert.ok(motion.includes('android:trimPathEnd="0"'));
    assert.equal((motion.match(/android:fillAlpha="0"/g) || []).length, 3);
    assert.ok(files['values-v31/vega_splash.xml'].includes(`@drawable/bootsplash_animated_${suffix}`));
  }
  assert.throws(() => createSplashVectorResources('<svg/>', variants), /Unexpected/);
});

test('incremental generation removes stale color bitmaps and leaves other artwork intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-splash-'));
  try {
    const bucket = path.join(root, 'drawable-mdpi');
    fs.mkdirSync(bucket);
    fs.writeFileSync(path.join(bucket, 'bootsplash_logo_white.png'), 'old');
    fs.writeFileSync(path.join(bucket, 'bootsplash_logo.png'), 'original');
    writeSplashVectorResources(projectRoot, root, variants);
    const first = fs.readFileSync(path.join(root, 'drawable/bootsplash_logo_white.xml'), 'utf8');
    writeSplashVectorResources(projectRoot, root, variants);
    assert.equal(fs.existsSync(path.join(bucket, 'bootsplash_logo_white.png')), false);
    assert.equal(fs.readFileSync(path.join(bucket, 'bootsplash_logo.png'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(root, 'drawable/bootsplash_logo_white.xml'), 'utf8'), first);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
