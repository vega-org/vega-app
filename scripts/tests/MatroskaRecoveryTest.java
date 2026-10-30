package com.brentvatne.exoplayer;
import androidx.media3.extractor.*;
import androidx.media3.common.ParserException;
import java.io.*;
import java.lang.reflect.Proxy;

public class MatroskaRecoveryTest {
  static class Input {
    byte[] bytes; int position, peek;
    Input(byte[] bytes) { this.bytes = bytes; }
    ExtractorInput view() { return (ExtractorInput) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{ExtractorInput.class}, (p,m,a) -> {
      switch (m.getName()) {
        case "resetPeekPosition": peek=position; return null;
        case "getPosition": return (long) position;
        case "peekFully":
          int count=(int)a[2];
          if (peek+count>bytes.length) {
            if (a.length==4 && (boolean)a[3] && peek==bytes.length) return false;
            throw new EOFException();
          }
          System.arraycopy(bytes,peek,(byte[])a[0],(int)a[1],count); peek+=count;
          return a.length==4 ? true : null;
        case "skipFully": position+=(int)a[0]; if(position>bytes.length)throw new EOFException(); return null;
        default: throw new AssertionError(m.getName());
      }
    }); }
  }
  static class Broken implements Extractor {
    String message="No valid varint length mask found"; int seeks; boolean fail=true;
    public boolean sniff(ExtractorInput i) { return true; }
    public void init(ExtractorOutput o) {}
    public void seek(long p,long t) {seeks++;}
    public void release() {}
    public int read(ExtractorInput i, PositionHolder p) { if(fail)throw new IllegalStateException(message); return RESULT_CONTINUE; }
  }
  static void check(boolean yes) {if(!yes)throw new AssertionError();}
  public static void main(String[] args) throws Exception {
    Broken broken=new Broken(); RecoveringMatroskaExtractor recovery=new RecoveringMatroskaExtractor(broken);
    Input input=new Input(new byte[]{0,0,0x1f,0x43,(byte)0xb6,0x75,(byte)0x81,0});
    check(recovery.read(input.view(),new PositionHolder())==Extractor.RESULT_CONTINUE);
    check(input.position==2 && broken.seeks==1); // next header remains unread
    check(new RecoveringMatroskaExtractor(new Broken()).read(new Input(new byte[100]).view(),new PositionHolder())==Extractor.RESULT_END_OF_INPUT);
    try {new RecoveringMatroskaExtractor(new Broken()).read(new Input(new byte[1024*1024+1]).view(),new PositionHolder());throw new AssertionError();}catch(ParserException expected){}
    broken=new Broken();broken.message="unrelated";
    try {new RecoveringMatroskaExtractor(broken).read(input.view(),new PositionHolder());throw new AssertionError();}catch(IllegalStateException expected){check(expected.getMessage().equals("unrelated"));}
    broken=new Broken();broken.fail=false;input=new Input(new byte[]{0});
    check(new RecoveringMatroskaExtractor(broken).read(input.view(),new PositionHolder())==Extractor.RESULT_CONTINUE);check(input.position==0 && broken.seeks==0);
    recovery=new RecoveringMatroskaExtractor(new Broken());
    for(int i=0;i<8;i++)recovery.read(new Input(new byte[]{0x1f,0x43,(byte)0xb6,0x75,(byte)0x81}).view(),new PositionHolder());
    try {recovery.read(input.view(),new PositionHolder());throw new AssertionError();}catch(ParserException expected){}
    System.out.println("Passed: cluster resync, actual EOF, bounded scan, unrelated errors, normal reads, recovery limit");
  }
}
