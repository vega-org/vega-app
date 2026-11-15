#!/usr/bin/env bash
set -euo pipefail

# Match the Maven dependency in with-custom-native-modules.js. Build the same
# LGPL HTTPS tier; do not combine FFmpeg 6 JNI libraries with the FFmpeg 8 API.
readonly revision=469e560b89a9ba4cab357d2c306c676b0c611745
readonly ndk_version=27.2.12479018
project_root="$(cd "$(dirname "$0")/.." && pwd)"
output="$project_root/.native/ffmpeg-armv7"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:?Android SDK is required}}"
export ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT:-$ANDROID_SDK_ROOT/ndk/$ndk_version}"
test -f "$ANDROID_NDK_ROOT/source.properties"
grep -Eq "Pkg.Revision *= *$ndk_version$" "$ANDROID_NDK_ROOT/source.properties"

work="$(mktemp -d "${TMPDIR:-/tmp}/vega-ffmpeg-armv7.XXXXXXXX")"
on_exit() {
  local result=$?
  if (( result != 0 )) && [[ -f "$work/source/android-8.1-lts/build.log" ]]; then
    tail -200 "$work/source/android-8.1-lts/build.log"
  fi
  echo "FFmpeg source/build logs retained in: $work"
}
trap on_exit EXIT
git clone --filter=blob:none --no-checkout https://github.com/ffmpegkit-maintained/ffmpeg.git "$work/source"
git -C "$work/source" sparse-checkout set android-8.1-lts
git -C "$work/source" checkout --detach "$revision"
cd "$work/source/android-8.1-lts"
./android.sh --enable-gnutls --enable-gmp \
  --enable-android-media-codec --enable-android-zlib \
  --disable-arm-v7a-neon --disable-arm64-v8a --disable-x86 --disable-x86-64 \
  --api-level=28 --no-archive

mkdir -p "$output/armeabi-v7a" "$output/licenses"
for library in android/libs/armeabi-v7a/*.so; do
  # React Native already provides this runtime for each ABI.
  [[ "$(basename "$library")" == libc++_shared.so ]] && continue
  cp "$library" "$output/armeabi-v7a/"
done
cp android/ffmpeg-kit-android-lib/src/main/res/raw/*.txt "$output/licenses/"
printf 'FFmpegKit HTTPS 8.1.9\nSource: https://github.com/ffmpegkit-maintained/ffmpeg/tree/%s\n' "$revision" > "$output/licenses/SOURCE.txt"
python3 "$project_root/scripts/check-ffmpeg-abis.py" "$output" --abis armeabi-v7a
