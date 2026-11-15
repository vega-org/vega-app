![vega-high-resolution-logo-transparent](https://github.com/Zenda-Cross/vega-app/assets/143804558/b2eb446f-8e7f-4800-81e1-3320c82f33de)

# Vega-App
Android app for streaming and casting media.
### Features
- Stream and Download.
- Cast support: Google Cast/DLNA with custom remuxer supports embedded audio and sub track change support.
- WatchList.
- External player and Downloader support.
- Sync with desktop app
- Create custom plugins.
<br>

[![Discord](https://custom-icon-badges.demolab.com/badge/-Join_Discord-6567a5?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/cr42m6maWy)

___

## Download ![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/vega-org/vega-app/total?link=https%3A%2F%2Fgithub.com%2Fvega-org%2Fvega-app%2Freleases&label=Github%20Downloads)
<!-- > <sub>Download Universal version if you are confused about armeabi-v7a or arm64-v8a or follow this guide https://vega.8man.in/guide/.</sub> -->

<a href="https://play.google.com/store/apps/details?id=vega.app">
  <img src="https://appure.io/badges/playstore/en.svg" width="200" alt="Get it on Google Play">
</a>

[![Download Apk](https://custom-icon-badges.demolab.com/badge/-Download_From_Github-black?style=for-the-badge&logo=download&logoColor=white)](https://github.com/vega-org/vega-app/releases/latest)

[![Download Apk](https://custom-icon-badges.demolab.com/badge/-Website-tomato?style=for-the-badge&logo=download&logoColor=white)](https://vega-app.in/#mobile)

## Vega for Desktop 
https://github.com/vega-org/vega-desktop

## Vega for Web
https://web.vega-app.in


<br>

##
<!--  ![Screenshots](https://github.com/user-attachments/assets/b86af756-e66e-4ae7-b2af-61b25cfd8d4e) -->
<!--<img width="2712" height="1220" alt="Screenshot_2026-08-11-20-07-17-817_com vega" src="https://github.com/user-attachments/assets/e7de4085-fcb1-4504-92e3-a4f011adc879" /> -->
Play any local or remote video
<img width="2946" height="1324" alt="Untitled design" src="https://github.com/user-attachments/assets/76b6adee-861d-4cc9-88c7-d029d0ab2137" />



___

## Stack
<p align="left">
     
[![React-Native](https://custom-icon-badges.demolab.com/badge/-React_Native-287aad?style=for-the-badge&logo=react&logoColor=white)](https://reactnative.dev/)
[![TypeScript](https://custom-icon-badges.demolab.com/badge/Typescript-3078C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NativeWind](https://custom-icon-badges.demolab.com/badge/Native_Wind-0CA6E9?style=for-the-badge&logo=tailwind&logoColor=white)](https://www.nativewind.dev/)
[![React-Navigation](https://custom-icon-badges.demolab.com/badge/React_Navigation-6838d9?style=for-the-badge&logo=menu&logoColor=white)](https://reactnavigation.org/)
[![Expo-Modules](https://custom-icon-badges.demolab.com/badge/Expo_Modules-black?style=for-the-badge&logo=expo&logoColor=white)](https://docs.expo.dev/modules/overview/)
[![React-Native-Video](https://custom-icon-badges.demolab.com/badge/React_native_video-38d9c9?style=for-the-badge&logo=video&logoColor=white)](https://thewidlarzgroup.github.io/react-native-video/)
[![MMKV-Storage](https://custom-icon-badges.demolab.com/badge/MMKV_Storage-yellow?style=for-the-badge&logo=zap&logoColor=white)](https://github.com/mrousavy/react-native-mmkv)



</p>

## Build and Dev
0. Set-up React Native environment if you haven't already. [Guide](https://reactnative.dev/docs/set-up-your-environment)

1. clone
     ```bash
     git clone https://github.com/vega-org/vega-app.git
     ```
     ```
     cd vega-app
     ```
2. Install
     ```
     npm install
     ```
3. Prebuild
   ```
    npx expo prebuild -p android --clean
   ```
5. Open metro dev server
Dev
     ```
     npm run android
     ```
Build apk/aab
https://reactnative.dev/docs/signed-apk-android

---
> [!IMPORTANT]
> Vega App does not host, store, or provide any media content. It is not affiliated with or connected to any external providers or extensions. All content accessed through the app is managed and sourced directly by the user via third-party tools or integrations. Vega App has no control over it.


## Leave a star if this was helpful

<a href="https://www.star-history.com/?repos=vega-org%2Fvega-app&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=vega-org/vega-app&type=date&theme=dark&legend=top-left&sealed_token=ajfKjwdP9VUHI3OOuOW40FrTlJWZRFXQqjUVf51d1HcT6QFCcR2mvv8ykA_FM5u7a9rqhzNtERwdQjth0A63L5tRJ6ImisXf5ktSU4eYU-SB1m3-xp5HOQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=vega-org/vega-app&type=date&legend=top-left&sealed_token=ajfKjwdP9VUHI3OOuOW40FrTlJWZRFXQqjUVf51d1HcT6QFCcR2mvv8ykA_FM5u7a9rqhzNtERwdQjth0A63L5tRJ6ImisXf5ktSU4eYU-SB1m3-xp5HOQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=vega-org/vega-app&type=date&legend=top-left&sealed_token=ajfKjwdP9VUHI3OOuOW40FrTlJWZRFXQqjUVf51d1HcT6QFCcR2mvv8ykA_FM5u7a9rqhzNtERwdQjth0A63L5tRJ6ImisXf5ktSU4eYU-SB1m3-xp5HOQ" />
 </picture>
</a>


### ARMv7 FFmpeg native libraries

The FFmpegKit Maven package supplies 64-bit libraries only. Universal ARM
releases also need matching source-built ARMv7 libraries. On Linux (or WSL),
install the prerequisites in `.github/actions/ffmpeg-armv7/action.yml`, set
`ANDROID_SDK_ROOT` and `ANDROID_NDK_ROOT` (NDK 27.2.12479018), and run
`bash scripts/build-ffmpeg-armv7.sh` before `expo prebuild`. EAS/custom build
pipelines must run this preparation before native project generation too.

The script pins FFmpegKit 8.1.9's source revision and LGPL HTTPS configuration
(gnutls and gmp) to match the Maven dependency. Generated libraries and license
notices are kept under `.native/ffmpeg-armv7` and copied during prebuild.
Release workflows build/cache this output and verify both ARM ABIs in APK/AAB
files. Release builds fail if ARMv7 FFmpegKit is missing instead of shipping
another incomplete universal APK. No separately sourced, older FFmpeg JNI
libraries are mixed into the current FFmpegKit API.
