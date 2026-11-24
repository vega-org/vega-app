const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const patch = fs.readFileSync(path.resolve(__dirname, '../../patches/react-native-video+6.19.2.patch'), 'utf8');

test('the media session uses the guarded player while retaining its original registry key', () => {
  assert.match(patch, /^\+\s*val mediaSession = MediaSession.Builder\(this, SafeBufferingPlayer\(player\)\)/m);
  assert.match(patch, /setId\("RNVideoPlaybackService_" \+ player.hashCode\(\)\)/);
});

test('actual native wrapper handles overflowing live timestamps and ordinary VOD percentages', () => {
  const marker = '+++ b/node_modules/react-native-video/android/src/main/java/com/brentvatne/exoplayer/SafeBufferingPlayer.java';
  const block = patch.slice(patch.indexOf(marker)).split(/\r?\n/).slice(1);
  const source = block.filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
  assert.match(source, /public final class SafeBufferingPlayer/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-buffer-percentage-'));
  // These fixtures exercise the shipped wrapper, not a copy of its calculation.
  const player = `package androidx.media3.common;
    public interface Player {
      long getDuration(); long getBufferedPosition(); int getBufferedPercentage();
    }`;
  const forwardingPlayer = `package androidx.media3.common;
    public class ForwardingPlayer implements Player {
      private final Player player;
      public ForwardingPlayer(Player player) { this.player = player; }
      public long getDuration() { return player.getDuration(); }
      public long getBufferedPosition() { return player.getBufferedPosition(); }
      public int getBufferedPercentage() { return player.getBufferedPercentage(); }
    }`;
  const checks = `import androidx.media3.common.Player;
    import com.brentvatne.exoplayer.SafeBufferingPlayer;
    public class BufferPercentageTest {
      static class FakePlayer implements Player {
        long duration, buffered;
        public long getDuration() { return duration; }
        public long getBufferedPosition() { return buffered; }
        public int getBufferedPercentage() { throw new IllegalArgumentException("unsafe delegate called"); }
        public int hashCode() { return 12345; }
      }
      static void check(boolean pass) { if (!pass) throw new AssertionError(); }
      public static void main(String[] args) {
        FakePlayer raw = new FakePlayer();
        SafeBufferingPlayer player = new SafeBufferingPlayer(raw);
        long[][] cases = {
          {100, 14873512055477L, 100}, {100, 14873512055580L, 100},
          {1, Long.MAX_VALUE, 100}, {Long.MAX_VALUE, Long.MAX_VALUE, 100},
          {1000, 250, 25}, {1000, 750, 75}, {300, 100, 33},
          {1000, 0, 0}, {0, 0, 100},
          {-9223372036854775807L, 100, 0}, {100, -9223372036854775807L, 0},
          {-1, 100, 0}, {100, -1, 0}
        };
        for (long[] c : cases) {
          raw.duration = c[0]; raw.buffered = c[1];
          check(player.getBufferedPercentage() == c[2]);
        }
        check(player.hashCode() == raw.hashCode());
        raw.duration = 500; raw.buffered = 300;
        check(player.getDuration() == 500 && player.getBufferedPosition() == 300);
        System.out.println("13 native percentage cases and registry/delegation checks passed");
      }
    }`;
  try {
    const sources = {'Player.java': player, 'ForwardingPlayer.java': forwardingPlayer,
      'SafeBufferingPlayer.java': source, 'BufferPercentageTest.java': checks};
    for (const [name, content] of Object.entries(sources)) fs.writeFileSync(path.join(dir, name), content);
    execFileSync('javac', ['-d', dir, ...Object.keys(sources).map(name => path.join(dir, name))], {stdio: 'pipe'});
    const result = execFileSync('java', ['-cp', dir, 'BufferPercentageTest'], {encoding: 'utf8'});
    assert.match(result, /13 native percentage cases and registry\/delegation checks passed/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
