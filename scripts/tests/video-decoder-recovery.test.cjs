const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('runtime video recovery excludes failed decoders and remains bounded', () => {
  const patch = fs.readFileSync(path.join(__dirname, '../../patches/react-native-video+6.19.2.patch'), 'utf8');
  const start = patch.indexOf('+    private boolean recoverFromVideoDecoderFailure');
  const end = patch.indexOf('+        WritableMap event', start);
  let method = patch.slice(start, end).split(/\r?\n/).filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
  method = method.replaceAll('androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException', 'CodecFailure')
    .replaceAll('androidx.media3.exoplayer.ExoPlaybackException', 'ExoError') + '\nreturn true;\n}';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-decoder-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'DecoderRecoveryTest.java'), `
import java.util.*;
public class DecoderRecoveryTest {
  Object player = new Object(); Set<String> failedVideoDecoders = new HashSet<>();
  String activeVideoDecoderName = "bad"; Format decoderSwitchFormat; Boolean recoveryVideoDecoderSoftware;
  static class Format {String sampleMimeType = "video/hevc"; Object drmInitData;}
  static class PlaybackException extends Exception {
    static final int ERROR_CODE_DECODER_INIT_FAILED=1, ERROR_CODE_DECODING_FAILED=2,
      ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES=3, ERROR_CODE_DECODING_FORMAT_UNSUPPORTED=4;
    int errorCode; PlaybackException(int code, Throwable cause) {super(cause);errorCode=code;}
  }
  static class ExoError extends PlaybackException {
    Format rendererFormat = new Format(); ExoError(int code, Throwable cause) {super(code,cause);}
  }
  static class MediaCodecInfo {
    String name; boolean softwareOnly, supported;
    MediaCodecInfo(String n, boolean sw, boolean support) {name=n;softwareOnly=sw;supported=support;}
    boolean isFormatSupported(Format f) {return supported;}
  }
  static class CodecFailure extends Exception {MediaCodecInfo codecInfo;
    CodecFailure(String name) {codecInfo=new MediaCodecInfo(name,false,true);}}
  static class MediaCodecUtil {
    static class DecoderQueryException extends Exception {}
    static List<MediaCodecInfo> available = new ArrayList<>();
    static List<MediaCodecInfo> getDecoderInfos(String mime, boolean secure, boolean tunneling) throws DecoderQueryException {return available;}
  }
  ${method}
  static void check(boolean value) {if(!value) throw new AssertionError();}
  public static void main(String[] args) {
    DecoderRecoveryTest t = new DecoderRecoveryTest();
    MediaCodecUtil.available=Arrays.asList(new MediaCodecInfo("bad",false,true),new MediaCodecInfo("unsupported",true,false),new MediaCodecInfo("other-hardware",false,true));
    check(t.recoverFromVideoDecoderFailure(new ExoError(999,new CodecFailure("bad"))));
    check(t.failedVideoDecoders.contains("bad")); check(!t.recoveryVideoDecoderSoftware);
    check(!t.recoverFromVideoDecoderFailure(new ExoError(2,new CodecFailure("bad"))));
    DecoderRecoveryTest network = new DecoderRecoveryTest();
    check(!network.recoverFromVideoDecoderFailure(new ExoError(999,null)));
    ExoError audio = new ExoError(2,new CodecFailure("bad")); audio.rendererFormat.sampleMimeType="audio/aac";
    check(!network.recoverFromVideoDecoderFailure(audio));
    check(network.failedVideoDecoders.isEmpty());
    t.failedVideoDecoders.add("two");t.failedVideoDecoders.add("three");
    check(!t.recoverFromVideoDecoderFailure(new ExoError(2,new CodecFailure("four"))));
    DecoderRecoveryTest noFallback = new DecoderRecoveryTest();
    MediaCodecUtil.available=Arrays.asList(new MediaCodecInfo("bad",true,true),new MediaCodecInfo("unsupported",false,false));
    check(!noFallback.recoverFromVideoDecoderFailure(new ExoError(2,new CodecFailure("bad"))));
    System.out.println("Decoder recovery cases passed");
  }
}`);
    execFileSync('javac', [path.join(dir, 'DecoderRecoveryTest.java')], {stdio: 'pipe'});
    assert.match(execFileSync('java', ['-cp', dir, 'DecoderRecoveryTest'], {encoding:'utf8'}), /cases passed/);
  } finally {fs.rmSync(dir, {recursive:true, force:true});}
});
