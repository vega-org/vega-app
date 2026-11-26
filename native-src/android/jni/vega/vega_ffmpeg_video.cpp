#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <dlfcn.h>
#include <jni.h>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr const char* kLogTag = "VegaFfmpegVideo";
constexpr const char* kDecoderClassName = "com/vega/FfmpegVideoDecoder";
constexpr int kFfPadding = 64;
constexpr int kSwsFastBilinear = 1;
constexpr int kAvLogError = 16;
constexpr int64_t kAvNoptsValue = static_cast<int64_t>(UINT64_C(0x8000000000000000));
constexpr int kAverrorEof = -((int)('E' | ('O' << 8) | ('F' << 16) | (' ' << 24)));

constexpr const char* kVertexShaderSrc = R"(
attribute vec2 aPos;
attribute vec2 aTex;
varying vec2 vTex;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vTex = aTex;
}
)";

constexpr const char* kFragmentShaderSrc = R"(
precision mediump float;
uniform sampler2D uTex;
varying vec2 vTex;
void main() {
  gl_FragColor = texture2D(uTex, vTex);
}
)";

constexpr GLfloat kQuadVertices[] = {
    -1.0f, -1.0f,
     1.0f, -1.0f,
    -1.0f,  1.0f,
     1.0f,  1.0f,
};

constexpr GLfloat kQuadTexCoords[] = {
    0.0f, 1.0f,
    1.0f, 1.0f,
    0.0f, 0.0f,
    1.0f, 0.0f,
};

struct AVRationalCompat {
  int num;
  int den;
};

struct AVCodecCompat {
  const char* name;
  const char* long_name;
  int type;
  int id;
};

// Verified against FFmpeg 8.1 (Libavcodec 62 / Libavutil 60) on arm64-v8a.
struct AVCodecParametersCompat {
  int codec_type;
  int codec_id;
  uint32_t codec_tag;
  uint8_t* extradata;
  int extradata_size;
  void* coded_side_data;
  int nb_coded_side_data;
  int format;
  int64_t bit_rate;
  int bits_per_coded_sample;
  int bits_per_raw_sample;
  int profile;
  int level;
  int width;
  int height;
};

struct AVPacketCompat {
  void* buf;
  int64_t pts;
  int64_t dts;
  uint8_t* data;
  int size;
};

struct AVFrameCompat {
  uint8_t* data[8];
  int linesize[8];
  uint8_t** extended_data;
  int width;
  int height;
  int nb_samples;
  int format;
  int pict_type;
  AVRationalCompat sample_aspect_ratio;
  int64_t pts;
  int64_t pkt_dts;
};

#if defined(__aarch64__) || defined(__LP64__)
static_assert(offsetof(AVCodecParametersCompat, extradata) == 0x10);
static_assert(offsetof(AVCodecParametersCompat, nb_coded_side_data) == 0x28);
static_assert(offsetof(AVCodecParametersCompat, height) == 0x4c);
static_assert(offsetof(AVPacketCompat, pts) == 0x08);
static_assert(offsetof(AVPacketCompat, data) == 0x18);
static_assert(offsetof(AVPacketCompat, size) == 0x20);
static_assert(offsetof(AVFrameCompat, width) == 0x68);
static_assert(offsetof(AVFrameCompat, format) == 0x74);
static_assert(offsetof(AVFrameCompat, pts) == 0x88);
#endif

struct FfmpegApi {
  void* avutil = nullptr;
  void* avcodec = nullptr;
  void* swscale = nullptr;

  void* (*av_malloc)(size_t size) = nullptr;
  void (*av_free)(void* ptr) = nullptr;
  AVFrameCompat* (*av_frame_alloc)() = nullptr;
  void (*av_frame_free)(AVFrameCompat** frame) = nullptr;
  void (*av_frame_unref)(AVFrameCompat* frame) = nullptr;
  void (*av_frame_move_ref)(AVFrameCompat* dst, AVFrameCompat* src) = nullptr;
  int (*av_opt_set_int)(void* obj, const char* name, int64_t val, int search_flags) = nullptr;
  int (*av_get_pix_fmt)(const char* name) = nullptr;
  void (*av_log_set_level)(int level) = nullptr;
  int (*av_strerror)(int errnum, char* errbuf, size_t errbuf_size) = nullptr;

  const AVCodecCompat* (*avcodec_find_decoder_by_name)(const char* name) = nullptr;
  AVCodecParametersCompat* (*avcodec_parameters_alloc)() = nullptr;
  void (*avcodec_parameters_free)(AVCodecParametersCompat** par) = nullptr;
  int (*avcodec_parameters_to_context)(void* codec, const AVCodecParametersCompat* par) = nullptr;
  void* (*avcodec_alloc_context3)(const AVCodecCompat* codec) = nullptr;
  int (*avcodec_open2)(void* avctx, const AVCodecCompat* codec, void** options) = nullptr;
  void (*avcodec_flush_buffers)(void* avctx) = nullptr;
  int (*avcodec_send_packet)(void* avctx, const AVPacketCompat* avpkt) = nullptr;
  int (*avcodec_receive_frame)(void* avctx, AVFrameCompat* frame) = nullptr;
  void (*avcodec_free_context)(void** avctx) = nullptr;
  AVPacketCompat* (*av_packet_alloc)() = nullptr;
  void (*av_packet_free)(AVPacketCompat** pkt) = nullptr;
  void (*av_packet_unref)(AVPacketCompat* pkt) = nullptr;

  void* (*sws_getCachedContext)(
      void* context,
      int srcW,
      int srcH,
      int srcFormat,
      int dstW,
      int dstH,
      int dstFormat,
      int flags,
      void* srcFilter,
      void* dstFilter,
      const double* param) = nullptr;
  int (*sws_scale)(
      void* c,
      const uint8_t* const srcSlice[],
      const int srcStride[],
      int srcSliceY,
      int srcSliceH,
      uint8_t* const dst[],
      const int dstStride[]) = nullptr;
  void (*sws_freeContext)(void* swsContext) = nullptr;

  int pix_fmt_rgba = -1;
};

std::mutex g_ffMutex;
bool g_ffInitAttempted = false;
bool g_ffLoaded = false;
FfmpegApi g_ff;

void* openSharedLib(const std::string& libDir, const char* soName) {
  if (!libDir.empty()) {
    std::string fullPath = libDir;
    if (fullPath.back() != '/') {
      fullPath.push_back('/');
    }
    fullPath.append(soName);
    void* handle = dlopen(fullPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (handle != nullptr) {
      return handle;
    }
  }
  void* handle = dlopen(soName, RTLD_NOW | RTLD_GLOBAL);
  if (handle == nullptr) {
    __android_log_print(ANDROID_LOG_WARN, kLogTag, "dlopen failed for %s: %s", soName, dlerror());
  }
  return handle;
}

template <typename Fn>
bool resolveSymbol(void* handle, const char* symbol, Fn& out) {
  out = reinterpret_cast<Fn>(dlsym(handle, symbol));
  if (out == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "dlsym missing symbol: %s", symbol);
    return false;
  }
  return true;
}

std::string jstringToUtf8(JNIEnv* env, jstring str) {
  if (str == nullptr) {
    return {};
  }
  const char* chars = env->GetStringUTFChars(str, nullptr);
  if (chars == nullptr) {
    return {};
  }
  std::string result(chars);
  env->ReleaseStringUTFChars(str, chars);
  return result;
}

bool ensureFfmpegLoaded(JNIEnv* env, jstring jNativeLibDir) {
  std::lock_guard<std::mutex> lock(g_ffMutex);
  if (g_ffInitAttempted) {
    return g_ffLoaded;
  }
  g_ffInitAttempted = true;

  std::string libDir = jstringToUtf8(env, jNativeLibDir);
  g_ff.avutil = openSharedLib(libDir, "libavutil.so");
  g_ff.avcodec = openSharedLib(libDir, "libavcodec.so");
  g_ff.swscale = openSharedLib(libDir, "libswscale.so");
  if (!g_ff.avutil || !g_ff.avcodec || !g_ff.swscale) {
    return false;
  }

  bool ok = true;
  ok &= resolveSymbol(g_ff.avutil, "av_malloc", g_ff.av_malloc);
  ok &= resolveSymbol(g_ff.avutil, "av_free", g_ff.av_free);
  ok &= resolveSymbol(g_ff.avutil, "av_frame_alloc", g_ff.av_frame_alloc);
  ok &= resolveSymbol(g_ff.avutil, "av_frame_free", g_ff.av_frame_free);
  ok &= resolveSymbol(g_ff.avutil, "av_frame_unref", g_ff.av_frame_unref);
  ok &= resolveSymbol(g_ff.avutil, "av_frame_move_ref", g_ff.av_frame_move_ref);
  ok &= resolveSymbol(g_ff.avutil, "av_opt_set_int", g_ff.av_opt_set_int);
  ok &= resolveSymbol(g_ff.avutil, "av_get_pix_fmt", g_ff.av_get_pix_fmt);
  ok &= resolveSymbol(g_ff.avutil, "av_log_set_level", g_ff.av_log_set_level);
  ok &= resolveSymbol(g_ff.avutil, "av_strerror", g_ff.av_strerror);

  ok &= resolveSymbol(g_ff.avcodec, "avcodec_find_decoder_by_name", g_ff.avcodec_find_decoder_by_name);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_parameters_alloc", g_ff.avcodec_parameters_alloc);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_parameters_free", g_ff.avcodec_parameters_free);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_parameters_to_context", g_ff.avcodec_parameters_to_context);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_alloc_context3", g_ff.avcodec_alloc_context3);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_open2", g_ff.avcodec_open2);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_flush_buffers", g_ff.avcodec_flush_buffers);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_send_packet", g_ff.avcodec_send_packet);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_receive_frame", g_ff.avcodec_receive_frame);
  ok &= resolveSymbol(g_ff.avcodec, "avcodec_free_context", g_ff.avcodec_free_context);
  ok &= resolveSymbol(g_ff.avcodec, "av_packet_alloc", g_ff.av_packet_alloc);
  ok &= resolveSymbol(g_ff.avcodec, "av_packet_free", g_ff.av_packet_free);
  ok &= resolveSymbol(g_ff.avcodec, "av_packet_unref", g_ff.av_packet_unref);

  ok &= resolveSymbol(g_ff.swscale, "sws_getCachedContext", g_ff.sws_getCachedContext);
  ok &= resolveSymbol(g_ff.swscale, "sws_scale", g_ff.sws_scale);
  ok &= resolveSymbol(g_ff.swscale, "sws_freeContext", g_ff.sws_freeContext);

  if (!ok) {
    return false;
  }

  g_ff.pix_fmt_rgba = g_ff.av_get_pix_fmt("rgba");
  if (g_ff.pix_fmt_rgba < 0) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Failed to resolve rgba pixel format");
    return false;
  }

  g_ff.av_log_set_level(kAvLogError);
  g_ffLoaded = true;
  return true;
}

const AVCodecCompat* findCodecForMime(const std::string& mime) {
  const char* const* candidates = nullptr;
  static const char* const kHevc[] = {"hevc", nullptr};
  static const char* const kH264[] = {"h264", nullptr};
  static const char* const kVp9[] = {"vp9", "libvpx-vp9", nullptr};
  static const char* const kVp8[] = {"vp8", "libvpx", nullptr};
  static const char* const kAv1[] = {"libdav1d", "libaom-av1", nullptr};
  static const char* const kMpeg2[] = {"mpeg2video", nullptr};
  static const char* const kMpeg4[] = {"mpeg4", nullptr};
  static const char* const kWmv[] = {"wmv3", "vc1", nullptr};
  static const char* const kVc1[] = {"vc1", nullptr};
  static const char* const kMjpeg[] = {"mjpeg", nullptr};
  static const char* const kH263[] = {"h263", nullptr};

  if (mime == "video/hevc") {
    candidates = kHevc;
  } else if (mime == "video/avc") {
    candidates = kH264;
  } else if (mime == "video/x-vnd.on2.vp9") {
    candidates = kVp9;
  } else if (mime == "video/x-vnd.on2.vp8") {
    candidates = kVp8;
  } else if (mime == "video/av01") {
    candidates = kAv1;
  } else if (mime == "video/mpeg2") {
    candidates = kMpeg2;
  } else if (mime == "video/mp4v-es") {
    candidates = kMpeg4;
  } else if (mime == "video/x-ms-wmv") {
    candidates = kWmv;
  } else if (mime == "video/wvc1") {
    candidates = kVc1;
  } else if (mime == "video/mjpeg") {
    candidates = kMjpeg;
  } else if (mime == "video/3gpp") {
    candidates = kH263;
  } else {
    return nullptr;
  }

  for (int i = 0; candidates[i] != nullptr; ++i) {
    const AVCodecCompat* codec = g_ff.avcodec_find_decoder_by_name(candidates[i]);
    if (codec != nullptr) {
      return codec;
    }
  }
  return nullptr;
}

void logFfmpegError(const char* action, int err) {
  char errBuf[128] = {};
  if (g_ff.av_strerror != nullptr) {
    g_ff.av_strerror(err, errBuf, sizeof(errBuf));
  }
  __android_log_print(ANDROID_LOG_ERROR, kLogTag, "%s failed (%d): %s", action, err, errBuf);
}

struct DecoderContext {
  void* avctx = nullptr;
  AVPacketCompat* pkt = nullptr;
  AVFrameCompat* tempFrame = nullptr;
  std::vector<uint8_t> packetScratch;
  std::deque<AVFrameCompat*> readyFrames;
};

struct RendererContext {
  jobject surfaceRef = nullptr;
  ANativeWindow* window = nullptr;
  EGLDisplay eglDisplay = EGL_NO_DISPLAY;
  EGLConfig eglConfig = nullptr;
  EGLContext eglContext = EGL_NO_CONTEXT;
  EGLSurface eglSurface = EGL_NO_SURFACE;
  GLuint program = 0;
  GLuint texture = 0;
  GLint posLoc = -1;
  GLint texLoc = -1;
  int texWidth = 0;
  int texHeight = 0;
  void* swsCtx = nullptr;
  std::vector<uint8_t> rgbaScratch;
};

GLuint compileShader(GLenum type, const char* source) {
  GLuint shader = glCreateShader(type);
  if (shader == 0) {
    return 0;
  }
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint compiled = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
  if (compiled == GL_FALSE) {
    char infoLog[256] = {};
    glGetShaderInfoLog(shader, sizeof(infoLog), nullptr, infoLog);
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Shader compile failed: %s", infoLog);
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

bool createGlProgram(RendererContext* rctx) {
  GLuint vs = compileShader(GL_VERTEX_SHADER, kVertexShaderSrc);
  GLuint fs = compileShader(GL_FRAGMENT_SHADER, kFragmentShaderSrc);
  if (vs == 0 || fs == 0) {
    if (vs != 0) glDeleteShader(vs);
    if (fs != 0) glDeleteShader(fs);
    return false;
  }

  GLuint program = glCreateProgram();
  if (program == 0) {
    glDeleteShader(vs);
    glDeleteShader(fs);
    return false;
  }
  glAttachShader(program, vs);
  glAttachShader(program, fs);
  glLinkProgram(program);
  glDeleteShader(vs);
  glDeleteShader(fs);

  GLint linked = 0;
  glGetProgramiv(program, GL_LINK_STATUS, &linked);
  if (linked == GL_FALSE) {
    char infoLog[256] = {};
    glGetProgramInfoLog(program, sizeof(infoLog), nullptr, infoLog);
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Program link failed: %s", infoLog);
    glDeleteProgram(program);
    return false;
  }

  rctx->program = program;
  rctx->posLoc = glGetAttribLocation(program, "aPos");
  rctx->texLoc = glGetAttribLocation(program, "aTex");
  GLint uTexLoc = glGetUniformLocation(program, "uTex");
  if (rctx->posLoc < 0 || rctx->texLoc < 0 || uTexLoc < 0) {
    glDeleteProgram(program);
    rctx->program = 0;
    return false;
  }

  glGenTextures(1, &rctx->texture);
  if (rctx->texture == 0) {
    glDeleteProgram(program);
    rctx->program = 0;
    return false;
  }

  glBindTexture(GL_TEXTURE_2D, rctx->texture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

  glUseProgram(rctx->program);
  glUniform1i(uTexLoc, 0);
  return true;
}

void detachSurface(JNIEnv* env, RendererContext* rctx) {
  if (rctx == nullptr) {
    return;
  }
  if (rctx->eglDisplay != EGL_NO_DISPLAY) {
    if (rctx->eglContext != EGL_NO_CONTEXT && rctx->eglSurface != EGL_NO_SURFACE) {
      if (eglMakeCurrent(rctx->eglDisplay, rctx->eglSurface, rctx->eglSurface, rctx->eglContext) == EGL_TRUE) {
        if (rctx->texture != 0) {
          glDeleteTextures(1, &rctx->texture);
          rctx->texture = 0;
        }
        if (rctx->program != 0) {
          glDeleteProgram(rctx->program);
          rctx->program = 0;
        }
      }
    }
    eglMakeCurrent(rctx->eglDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (rctx->eglSurface != EGL_NO_SURFACE) {
      eglDestroySurface(rctx->eglDisplay, rctx->eglSurface);
      rctx->eglSurface = EGL_NO_SURFACE;
    }
    if (rctx->eglContext != EGL_NO_CONTEXT) {
      eglDestroyContext(rctx->eglDisplay, rctx->eglContext);
      rctx->eglContext = EGL_NO_CONTEXT;
    }
    rctx->eglDisplay = EGL_NO_DISPLAY;
    eglReleaseThread();
  }
  rctx->eglConfig = nullptr;
  rctx->program = 0;
  rctx->texture = 0;
  rctx->posLoc = -1;
  rctx->texLoc = -1;
  rctx->texWidth = 0;
  rctx->texHeight = 0;

  if (rctx->window != nullptr) {
    ANativeWindow_release(rctx->window);
    rctx->window = nullptr;
  }
  if (rctx->surfaceRef != nullptr && env != nullptr) {
    env->DeleteGlobalRef(rctx->surfaceRef);
    rctx->surfaceRef = nullptr;
  }
}

bool attachSurface(JNIEnv* env, RendererContext* rctx, jobject jSurface) {
  detachSurface(env, rctx);

  rctx->window = ANativeWindow_fromSurface(env, jSurface);
  if (rctx->window == nullptr) {
    return false;
  }
  rctx->surfaceRef = env->NewGlobalRef(jSurface);
  if (rctx->surfaceRef == nullptr) {
    detachSurface(env, rctx);
    return false;
  }

  rctx->eglDisplay = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if (rctx->eglDisplay == EGL_NO_DISPLAY ||
      eglInitialize(rctx->eglDisplay, nullptr, nullptr) != EGL_TRUE) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglInitialize failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return false;
  }

  const EGLint configAttribs[] = {
      EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
      EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
      EGL_RED_SIZE, 8,
      EGL_GREEN_SIZE, 8,
      EGL_BLUE_SIZE, 8,
      EGL_ALPHA_SIZE, 8,
      EGL_NONE,
  };
  EGLint numConfigs = 0;
  if (eglChooseConfig(rctx->eglDisplay, configAttribs, &rctx->eglConfig, 1, &numConfigs) != EGL_TRUE ||
      numConfigs < 1) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglChooseConfig failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return false;
  }

  const EGLint ctxAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
  rctx->eglContext = eglCreateContext(rctx->eglDisplay, rctx->eglConfig, EGL_NO_CONTEXT, ctxAttribs);
  if (rctx->eglContext == EGL_NO_CONTEXT) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglCreateContext failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return false;
  }

  rctx->eglSurface = eglCreateWindowSurface(rctx->eglDisplay, rctx->eglConfig, rctx->window, nullptr);
  if (rctx->eglSurface == EGL_NO_SURFACE) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglCreateWindowSurface failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return false;
  }

  if (eglMakeCurrent(rctx->eglDisplay, rctx->eglSurface, rctx->eglSurface, rctx->eglContext) != EGL_TRUE) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglMakeCurrent failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return false;
  }

  if (!createGlProgram(rctx)) {
    detachSurface(env, rctx);
    return false;
  }
  return true;
}

int drainReadyFrames(DecoderContext* ctx) {
  while (true) {
    g_ff.av_frame_unref(ctx->tempFrame);
    int recvRet = g_ff.avcodec_receive_frame(ctx->avctx, ctx->tempFrame);
    if (recvRet == -EAGAIN || recvRet == kAverrorEof) {
      return 0;
    }
    if (recvRet < 0) {
      logFfmpegError("avcodec_receive_frame", recvRet);
      return recvRet;
    }
    AVFrameCompat* outFrame = g_ff.av_frame_alloc();
    if (outFrame == nullptr) {
      g_ff.av_frame_unref(ctx->tempFrame);
      return -ENOMEM;
    }
    g_ff.av_frame_move_ref(outFrame, ctx->tempFrame);
    ctx->readyFrames.push_back(outFrame);
  }
}

void clearReadyFrames(DecoderContext* ctx) {
  while (!ctx->readyFrames.empty()) {
    AVFrameCompat* frame = ctx->readyFrames.front();
    ctx->readyFrames.pop_front();
    if (frame != nullptr) {
      g_ff.av_frame_free(&frame);
    }
  }
}

jboolean nativeIsCodecAvailable(
    JNIEnv* env,
    jclass /* clazz */,
    jstring nativeLibDir,
    jstring mimeType) {
  if (!ensureFfmpegLoaded(env, nativeLibDir)) {
    return JNI_FALSE;
  }
  std::string mime = jstringToUtf8(env, mimeType);
  return findCodecForMime(mime) != nullptr ? JNI_TRUE : JNI_FALSE;
}

jlong nativeCreateDecoder(
    JNIEnv* env,
    jclass /* clazz */,
    jstring nativeLibDir,
    jstring mimeType,
    jbyteArray extraData,
    jint width,
    jint height,
    jint threads) {
  if (!ensureFfmpegLoaded(env, nativeLibDir)) {
    return 0;
  }
  std::string mime = jstringToUtf8(env, mimeType);
  const AVCodecCompat* codec = findCodecForMime(mime);
  if (codec == nullptr) {
    return 0;
  }

  AVCodecParametersCompat* par = g_ff.avcodec_parameters_alloc();
  void* avctx = g_ff.avcodec_alloc_context3(codec);
  if (par == nullptr || avctx == nullptr) {
    if (par != nullptr) g_ff.avcodec_parameters_free(&par);
    if (avctx != nullptr) g_ff.avcodec_free_context(&avctx);
    return 0;
  }

  par->codec_type = codec->type;
  par->codec_id = codec->id;
  par->width = width > 0 ? width : 0;
  par->height = height > 0 ? height : 0;

  if (extraData != nullptr) {
    jsize extraLen = env->GetArrayLength(extraData);
    if (extraLen > 0) {
      uint8_t* extraBuf = static_cast<uint8_t*>(g_ff.av_malloc(static_cast<size_t>(extraLen) + kFfPadding));
      if (extraBuf == nullptr) {
        g_ff.avcodec_parameters_free(&par);
        g_ff.avcodec_free_context(&avctx);
        return 0;
      }
      env->GetByteArrayRegion(extraData, 0, extraLen, reinterpret_cast<jbyte*>(extraBuf));
      std::memset(extraBuf + extraLen, 0, kFfPadding);
      par->extradata = extraBuf;
      par->extradata_size = extraLen;
    }
  }

  int parRes = g_ff.avcodec_parameters_to_context(avctx, par);
  g_ff.avcodec_parameters_free(&par);
  if (parRes < 0) {
    logFfmpegError("avcodec_parameters_to_context", parRes);
    g_ff.avcodec_free_context(&avctx);
    return 0;
  }

  g_ff.av_opt_set_int(avctx, "threads", threads > 0 ? threads : 4, 0);
  g_ff.av_opt_set_int(avctx, "thread_type", 3, 0);

  int openRes = g_ff.avcodec_open2(avctx, codec, nullptr);
  if (openRes < 0) {
    logFfmpegError("avcodec_open2", openRes);
    g_ff.avcodec_free_context(&avctx);
    return 0;
  }

  auto* ctx = new DecoderContext();
  ctx->avctx = avctx;
  ctx->pkt = g_ff.av_packet_alloc();
  ctx->tempFrame = g_ff.av_frame_alloc();
  if (ctx->pkt == nullptr || ctx->tempFrame == nullptr) {
    if (ctx->pkt != nullptr) g_ff.av_packet_free(&ctx->pkt);
    if (ctx->tempFrame != nullptr) g_ff.av_frame_free(&ctx->tempFrame);
    g_ff.avcodec_free_context(&ctx->avctx);
    delete ctx;
    return 0;
  }
  return reinterpret_cast<jlong>(ctx);
}

void nativeFlushDecoder(
    JNIEnv* /* env */,
    jclass /* clazz */,
    jlong handle) {
  if (handle == 0 || !g_ffLoaded) {
    return;
  }
  auto* ctx = reinterpret_cast<DecoderContext*>(handle);
  clearReadyFrames(ctx);
  g_ff.av_frame_unref(ctx->tempFrame);
  g_ff.avcodec_flush_buffers(ctx->avctx);
}

void nativeDecode(
    JNIEnv* env,
    jclass /* clazz */,
    jlong handle,
    jobject inputBuf,
    jint offset,
    jint size,
    jlong timeUs,
    jlongArray outMeta) {
  jlong meta[5] = {0, 0, 0, 0, 0};
  auto finish = [&]() {
    env->SetLongArrayRegion(outMeta, 0, 5, meta);
  };

  if (handle == 0 || !g_ffLoaded) {
    meta[0] = -1;
    finish();
    return;
  }
  auto* ctx = reinterpret_cast<DecoderContext*>(handle);

  if (size > 0 && inputBuf != nullptr) {
    uint8_t* rawPtr = static_cast<uint8_t*>(env->GetDirectBufferAddress(inputBuf));
    jlong cap = env->GetDirectBufferCapacity(inputBuf);
    if (rawPtr == nullptr || offset < 0 || static_cast<jlong>(offset) + size > cap) {
      __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Invalid direct ByteBuffer input");
      meta[0] = -1;
      finish();
      return;
    }

    ctx->packetScratch.resize(static_cast<size_t>(size) + kFfPadding);
    std::memcpy(ctx->packetScratch.data(), rawPtr + offset, static_cast<size_t>(size));
    std::memset(ctx->packetScratch.data() + size, 0, kFfPadding);

    g_ff.av_packet_unref(ctx->pkt);
    ctx->pkt->data = ctx->packetScratch.data();
    ctx->pkt->size = size;
    ctx->pkt->pts = timeUs;
    ctx->pkt->dts = timeUs;

    int sendRet = g_ff.avcodec_send_packet(ctx->avctx, ctx->pkt);
    if (sendRet == -EAGAIN) {
      int drainRet = drainReadyFrames(ctx);
      if (drainRet < 0) {
        ctx->pkt->data = nullptr;
        ctx->pkt->size = 0;
        g_ff.av_packet_unref(ctx->pkt);
        meta[0] = -1;
        finish();
        return;
      }
      sendRet = g_ff.avcodec_send_packet(ctx->avctx, ctx->pkt);
    }

    ctx->pkt->data = nullptr;
    ctx->pkt->size = 0;
    g_ff.av_packet_unref(ctx->pkt);

    if (sendRet < 0 && sendRet != -EAGAIN) {
      logFfmpegError("avcodec_send_packet", sendRet);
      meta[0] = -1;
      finish();
      return;
    }
  }

  int drainRet = drainReadyFrames(ctx);
  if (drainRet < 0) {
    meta[0] = -1;
    finish();
    return;
  }

  if (ctx->readyFrames.empty()) {
    finish();
    return;
  }

  AVFrameCompat* outFrame = ctx->readyFrames.front();
  ctx->readyFrames.pop_front();
  int64_t pts = outFrame->pts != kAvNoptsValue ? outFrame->pts : timeUs;

  meta[0] = 1;
  meta[1] = reinterpret_cast<jlong>(outFrame);
  meta[2] = static_cast<jlong>(outFrame->width);
  meta[3] = static_cast<jlong>(outFrame->height);
  meta[4] = static_cast<jlong>(pts);
  finish();
}

void nativeReleaseFrame(
    JNIEnv* /* env */,
    jclass /* clazz */,
    jlong frameHandle) {
  if (frameHandle == 0 || !g_ffLoaded) {
    return;
  }
  auto* frame = reinterpret_cast<AVFrameCompat*>(frameHandle);
  g_ff.av_frame_free(&frame);
}

void nativeDestroyDecoder(
    JNIEnv* /* env */,
    jclass /* clazz */,
    jlong handle) {
  if (handle == 0 || !g_ffLoaded) {
    return;
  }
  auto* ctx = reinterpret_cast<DecoderContext*>(handle);
  clearReadyFrames(ctx);
  if (ctx->pkt != nullptr) g_ff.av_packet_free(&ctx->pkt);
  if (ctx->tempFrame != nullptr) g_ff.av_frame_free(&ctx->tempFrame);
  if (ctx->avctx != nullptr) g_ff.avcodec_free_context(&ctx->avctx);
  delete ctx;
}

jlong nativeCreateRenderer(JNIEnv* /* env */, jclass /* clazz */) {
  return reinterpret_cast<jlong>(new RendererContext());
}

jboolean nativeRenderFrame(
    JNIEnv* env,
    jclass /* clazz */,
    jlong renderHandle,
    jlong frameHandle,
    jobject jSurface) {
  if (renderHandle == 0 || frameHandle == 0 || jSurface == nullptr || !g_ffLoaded) {
    return JNI_FALSE;
  }
  auto* rctx = reinterpret_cast<RendererContext*>(renderHandle);
  auto* frame = reinterpret_cast<AVFrameCompat*>(frameHandle);
  if (frame->width <= 0 || frame->height <= 0 || frame->format < 0) {
    return JNI_FALSE;
  }

  if (rctx->surfaceRef == nullptr ||
      !env->IsSameObject(rctx->surfaceRef, jSurface) ||
      rctx->eglSurface == EGL_NO_SURFACE) {
    if (!attachSurface(env, rctx, jSurface)) {
      return JNI_FALSE;
    }
  }

  if (eglMakeCurrent(rctx->eglDisplay, rctx->eglSurface, rctx->eglSurface, rctx->eglContext) != EGL_TRUE) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglMakeCurrent in render failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return JNI_FALSE;
  }

  int w = frame->width;
  int h = frame->height;
  rctx->swsCtx = g_ff.sws_getCachedContext(
      rctx->swsCtx,
      w,
      h,
      frame->format,
      w,
      h,
      g_ff.pix_fmt_rgba,
      kSwsFastBilinear,
      nullptr,
      nullptr,
      nullptr);
  if (rctx->swsCtx == nullptr) {
    return JNI_FALSE;
  }

  size_t neededBytes = static_cast<size_t>(w) * static_cast<size_t>(h) * 4u;
  if (rctx->rgbaScratch.size() != neededBytes) {
    rctx->rgbaScratch.resize(neededBytes);
  }
  uint8_t* dstSlice[4] = {rctx->rgbaScratch.data(), nullptr, nullptr, nullptr};
  int dstStride[4] = {w * 4, 0, 0, 0};
  g_ff.sws_scale(rctx->swsCtx, frame->data, frame->linesize, 0, h, dstSlice, dstStride);

  EGLint surfW = 0;
  EGLint surfH = 0;
  eglQuerySurface(rctx->eglDisplay, rctx->eglSurface, EGL_WIDTH, &surfW);
  eglQuerySurface(rctx->eglDisplay, rctx->eglSurface, EGL_HEIGHT, &surfH);
  if (surfW <= 0) surfW = w;
  if (surfH <= 0) surfH = h;

  glViewport(0, 0, surfW, surfH);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, rctx->texture);
  if (rctx->texWidth != w || rctx->texHeight != h) {
    glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        w,
        h,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        rctx->rgbaScratch.data());
    rctx->texWidth = w;
    rctx->texHeight = h;
  } else {
    glTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0,
        0,
        w,
        h,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        rctx->rgbaScratch.data());
  }

  glUseProgram(rctx->program);
  glEnableVertexAttribArray(static_cast<GLuint>(rctx->posLoc));
  glVertexAttribPointer(static_cast<GLuint>(rctx->posLoc), 2, GL_FLOAT, GL_FALSE, 0, kQuadVertices);
  glEnableVertexAttribArray(static_cast<GLuint>(rctx->texLoc));
  glVertexAttribPointer(static_cast<GLuint>(rctx->texLoc), 2, GL_FLOAT, GL_FALSE, 0, kQuadTexCoords);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  glDisableVertexAttribArray(static_cast<GLuint>(rctx->posLoc));
  glDisableVertexAttribArray(static_cast<GLuint>(rctx->texLoc));

  if (eglSwapBuffers(rctx->eglDisplay, rctx->eglSurface) != EGL_TRUE) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "eglSwapBuffers failed (%x)", eglGetError());
    detachSurface(env, rctx);
    return JNI_FALSE;
  }
  return JNI_TRUE;
}

void nativeDetachSurface(
    JNIEnv* env,
    jclass /* clazz */,
    jlong renderHandle) {
  if (renderHandle == 0) {
    return;
  }
  auto* rctx = reinterpret_cast<RendererContext*>(renderHandle);
  detachSurface(env, rctx);
}

void nativeDestroyRenderer(
    JNIEnv* env,
    jclass /* clazz */,
    jlong renderHandle) {
  if (renderHandle == 0) {
    return;
  }
  auto* rctx = reinterpret_cast<RendererContext*>(renderHandle);
  detachSurface(env, rctx);
  if (rctx->swsCtx != nullptr && g_ff.sws_freeContext != nullptr) {
    g_ff.sws_freeContext(rctx->swsCtx);
    rctx->swsCtx = nullptr;
  }
  delete rctx;
}

const JNINativeMethod kNativeMethods[] = {
    {"nativeIsCodecAvailable", "(Ljava/lang/String;Ljava/lang/String;)Z", reinterpret_cast<void*>(nativeIsCodecAvailable)},
    {"nativeCreateDecoder", "(Ljava/lang/String;Ljava/lang/String;[BIII)J", reinterpret_cast<void*>(nativeCreateDecoder)},
    {"nativeFlushDecoder", "(J)V", reinterpret_cast<void*>(nativeFlushDecoder)},
    {"nativeDecode", "(JLjava/nio/ByteBuffer;IIJ[J)V", reinterpret_cast<void*>(nativeDecode)},
    {"nativeReleaseFrame", "(J)V", reinterpret_cast<void*>(nativeReleaseFrame)},
    {"nativeDestroyDecoder", "(J)V", reinterpret_cast<void*>(nativeDestroyDecoder)},
    {"nativeCreateRenderer", "()J", reinterpret_cast<void*>(nativeCreateRenderer)},
    {"nativeRenderFrame", "(JJLandroid/view/Surface;)Z", reinterpret_cast<void*>(nativeRenderFrame)},
    {"nativeDetachSurface", "(J)V", reinterpret_cast<void*>(nativeDetachSurface)},
    {"nativeDestroyRenderer", "(J)V", reinterpret_cast<void*>(nativeDestroyRenderer)},
};

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /* reserved */) {
  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK || env == nullptr) {
    return JNI_ERR;
  }
  jclass clazz = env->FindClass(kDecoderClassName);
  if (clazz == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "FindClass failed for %s", kDecoderClassName);
    return JNI_ERR;
  }
  if (env->RegisterNatives(
          clazz,
          kNativeMethods,
          static_cast<jint>(sizeof(kNativeMethods) / sizeof(kNativeMethods[0]))) != 0) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "RegisterNatives failed for %s", kDecoderClassName);
    return JNI_ERR;
  }
  return JNI_VERSION_1_6;
}
