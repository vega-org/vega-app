const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');

test('EBML bounds handle huge, unknown, truncated, and invalid element sizes without integer wraparound', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-ebml-'));
  try {
    const fixture = path.join(dir, 'EbmlBoundsTest.java');
    fs.writeFileSync(fixture, `import com.vega.EbmlBounds;
      public class EbmlBoundsTest {
        static void check(boolean ok) { if (!ok) throw new AssertionError(); }
        public static void main(String[] args) {
          check(EbmlBounds.end(20, 10, 100) == 30);
          check(EbmlBounds.end(20, 0, 100) == 20);
          check(EbmlBounds.end(20, Long.MAX_VALUE, 65536) == 65536);
          check(EbmlBounds.end(20, 0x00ffffffffffffffL, 65536) == 65536);
          check(EbmlBounds.end(20, 0x80000000L, 65536) == 65536);
          check(EbmlBounds.end(20, 200, 64) == 64);
          check(EbmlBounds.end(64, 200, 64) == 64);
          check(EbmlBounds.end(Integer.MAX_VALUE - 1, 10, Integer.MAX_VALUE) == Integer.MAX_VALUE);
          for (int[] bounds : new int[][] {{-1, 10}, {11, 10}}) {
            try { EbmlBounds.end(bounds[0], 1, bounds[1]); throw new AssertionError(); }
            catch (IllegalArgumentException expected) {}
          }
          try { EbmlBounds.end(0, -1, 10); throw new AssertionError(); }
          catch (IllegalArgumentException expected) {}
        }
      }`);
    execFileSync('javac', ['-d', dir, path.join(root, 'native-src/android/com/vega/EbmlBounds.java'), fixture]);
    execFileSync('java', ['-cp', dir, 'EbmlBoundsTest']);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('MKV inspector bounds sizes before integer conversion and guards negative offsets', () => {
  const source = fs.readFileSync(path.join(root, 'native-src/android/com/vega/RemoteDeliveryModule.kt'), 'utf8');
  const parser = source.slice(source.indexOf('private fun parseEbmlTracks'), source.indexOf('private fun tryInspectMkvTracks'));
  assert.doesNotMatch(parser, /(?:elemSize|subSize|sizeInfo|vSize|aSize)\.value\)\.toInt\(\)|(?:elemSize|subSize|sizeInfo|vSize|aSize)\.value\.toInt\(\)/);
  assert.equal((source.match(/offset < 0 \|\| offset >= bytes.size/g) || []).length, 2);
  const plugin = fs.readFileSync(path.join(root, 'plugins/with-custom-native-modules.js'), 'utf8');
  assert.match(plugin, /file.endsWith\('\.java'\)/);
});
