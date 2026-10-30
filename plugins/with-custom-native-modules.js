const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
  withProjectBuildGradle,
  withAndroidManifest,
} = require('expo/config-plugins');

function withCustomNativeModules(config) {
  config = withProjectBuildGradle(config, cfg => {
    const marker = '// Vega: align Media3 with react-native-video and its FFmpeg decoder.';
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents += `
${marker}
allprojects {
    configurations.configureEach {
        resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'androidx.media3') {
                details.useVersion '1.8.0'
                details.because 'react-native-video and the FFmpeg decoder require the Media3 1.8 API'
            }
        }
    }
}
`;
    }
    return cfg;
  });
  // 1. Copy the files over
  config = withDangerousMod(config, [
    'android',
    async cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const packageName = cfg.android?.package || 'com.vega';
      const packagePath = packageName.replace(/\./g, '/');
      const targetDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        packagePath,
      );

      fs.mkdirSync(targetDir, {recursive: true});

      // Copy from native-src/android/com/vega
      const sourceDir = path.join(
        projectRoot,
        'native-src',
        'android',
        'com',
        'vega',
      );

      if (fs.existsSync(sourceDir)) {
        const files = fs.readdirSync(sourceDir);
        for (const file of files) {
          if (file.endsWith('.kt')) {
            const sourceFile = path.join(sourceDir, file);
            const targetFile = path.join(targetDir, file);

            // Read the file and update the package name
            let content = fs.readFileSync(sourceFile, 'utf8');
            content = content.replace(
              /^package com\.vega$/m,
              `package ${packageName}`,
            );
            // Imports between these files must follow the package rename,
            // or variant builds (e.g. vega.app) cannot resolve com.vega.*.
            content = content.replace(
              /^import com\.vega\./gm,
              `import ${packageName}.`,
            );

            fs.writeFileSync(targetFile, content, 'utf8');
          }
        }
      }

      // Copy jniLibs if present
      const sourceJniDir = path.join(projectRoot, 'native-src', 'android', 'jniLibs');
      const targetJniDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'jniLibs');
      if (fs.existsSync(sourceJniDir)) {
        fs.cpSync(sourceJniDir, targetJniDir, {recursive: true});
      }

      return cfg;
    },
  ]);

  // 2. Add packages and DoH factory registration to MainApplication.kt
  config = withMainApplication(config, cfg => {
    let currentContents = cfg.modResults.contents;

    const packagesToAdd = [
      'DohPackage()',
      'WarpPackage()',
      'ByeDpiPackage()',
      'HttpDownloadPackage()',
      'TorrentPackage()',
      'LauncherIconPackage()',
      'VideoThumbnailPackage()',
      'AmbientVideoPackage()',
      'VideoDecoderPackage()',
      'ExternalAppsPackage()',
      'ProviderHttpPackage()',
      'RemoteDeliveryPackage()',
      'DlnaPackage()',
      'VideoIntentPackage()',
    ];

    for (const pkg of packagesToAdd) {
      if (!currentContents.includes(`add(${pkg})`)) {
        currentContents = currentContents.replace(
          /PackageList\(this\)\.packages\.apply \{\n/,
          match => `${match}              add(${pkg})\n`,
        );
      }
    }

    // Register DohOkHttpFactory with OkHttpClientProvider in onCreate
    const factoryLine =
      'OkHttpClientProvider.setOkHttpClientFactory(DohOkHttpFactory(cacheDir))';
    if (!currentContents.includes('setOkHttpClientFactory')) {
      // Add the import if missing
      if (
        !currentContents.includes(
          'import com.facebook.react.modules.network.OkHttpClientProvider',
        )
      ) {
        currentContents = currentContents.replace(
          /^(package .+\n)/m,
          match =>
            `${match}\nimport com.facebook.react.modules.network.OkHttpClientProvider\n`,
        );
      }

      // Inject factory registration after loadReactNative(this)
      currentContents = currentContents.replace(
        /loadReactNative\(this\)\n/,
        match =>
          `${match}    OkHttpClientProvider.setOkHttpClientFactory(DohOkHttpFactory(cacheDir))\n`,
      );
    }

    cfg.modResults.contents = currentContents;
    return cfg;
  });

  // 3. Add necessary dependencies to app/build.gradle
  config = withAppBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;

    // Add okhttp-dnsoverhttps if not present
    if (!contents.includes('okhttp-dnsoverhttps')) {
      // Find the dependencies block
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'com.squareup.okhttp3:okhttp-dnsoverhttps:4.12.0'\n`,
      );
    }

    if (!contents.includes('com.squareup.okhttp3:okhttp:4.12.0')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n`,
      );
    }

    // MediaMetadataRetriever can return the first frame for every timestamp
    // on remote videos. Media3's frame extractor performs a real HTTP/HLS seek.
    if (!contents.includes('androidx.media3:media3-transformer')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'androidx.media3:media3-transformer:1.8.0'\n`,
      );
    }

    // Read the active player and rendering surface for confirmed HDR status.
    if (!contents.includes('androidx.media3:media3-ui')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n    implementation 'androidx.media3:media3-ui:1.8.0'\n`,
      );
    }

    if (!contents.includes('androidx.media3:media3-muxer')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n    implementation 'androidx.media3:media3-muxer:1.8.0'\n`,
      );
    }

    // Make sure nanohttpd and libtorrent4j are re-added during prebuild
    if (!contents.includes('org.nanohttpd:nanohttpd')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'org.nanohttpd:nanohttpd:2.3.1'\n`,
      );
    }

    if (!contents.includes('ffmpeg-kit-https')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'dev.ffmpegkit-maintained:ffmpeg-kit-https:8.1.8'\n`,
      );
    }

    if (!contents.includes('libtorrent4j:2.1.0-39')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        match =>
          `${match}\n    implementation 'org.libtorrent4j:libtorrent4j:2.1.0-39'\n    implementation 'org.libtorrent4j:libtorrent4j-android-arm64:2.1.0-39'\n`,
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  // 4. Ensure RemoteDeliveryService is declared in AndroidManifest.xml
  config = withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.queries) manifest.queries = [];
    if (!manifest.queries[0]) manifest.queries[0] = {};
    const queries = manifest.queries[0];
    if (!queries.intent) queries.intent = [];
    for (const [scheme, mime] of [['https', 'video/*'], ['http', 'video/*'], ['content', 'video/*'], ['https', 'application/octet-stream'], ['http', 'application/octet-stream'], ['magnet', null]]) {
      if (!queries.intent.some(item => item.data?.some(data => data.$?.['android:scheme'] === scheme && (data.$?.['android:mimeType'] || null) === mime))) {
        queries.intent.push({action: [{$: {'android:name': 'android.intent.action.VIEW'}}], data: [{$: {'android:scheme': scheme, ...(mime ? {'android:mimeType': mime} : {})}}]});
      }
    }
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      if (!app.service) app.service = [];
      const serviceName = '.RemoteDeliveryService';
      const exists = app.service.some(
        s => s.$ && (s.$['android:name'] === serviceName || s.$['android:name'] === 'com.vega.RemoteDeliveryService'),
      );
      if (!exists) {
        app.service.push({
          $: {
            'android:name': serviceName,
            'android:exported': 'false',
            'android:foregroundServiceType': 'mediaPlayback',
            'android:stopWithTask': 'false',
          },
        });
      }
      const deliveryService = app.service.find(
        s => s.$ && (s.$['android:name'] === serviceName || s.$['android:name'] === 'com.vega.RemoteDeliveryService'),
      );
      if (deliveryService) deliveryService.$['android:stopWithTask'] = 'false';
    }
    return cfg;
  });

  return config;
}

module.exports = withCustomNativeModules;
