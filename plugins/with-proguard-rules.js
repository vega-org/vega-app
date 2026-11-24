const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const RULES = `
# Add any project specific keep options here:

# libtorrent4j (Required for JNI to find the classes and methods)
-keep class org.libtorrent4j.** { *; }
-keep interface org.libtorrent4j.** { *; }
-keep enum org.libtorrent4j.** { *; }

# Keep custom native modules (both com.vega and dynamic package)
-keep class com.vega.** { *; }
`;
// org.jitsi:webrtc:155.0.1 omits Dav1dDecoder and its Natives interface,
// but includes a leftover Dav1dDecoderJni stub. No decoder factory uses it.
const WEBRTC_RULES = `
# Optional AV1 JNI stub in the WebRTC data-channel dependency
-dontwarn org.webrtc.Dav1dDecoder$Natives
`;

module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const proguardRulesFile = path.join(
        cfg.modRequest.projectRoot,
        'android',
        'app',
        'proguard-rules.pro'
      );
      
      const packageName = cfg.android?.package || 'com.vega';

      if (fs.existsSync(proguardRulesFile)) {
        let content = fs.readFileSync(proguardRulesFile, 'utf8');
        if (!content.includes('org.libtorrent4j')) {
          content += RULES;
          // Add the current package name to proguard rules
          if (packageName !== 'com.vega') {
            content += `-keep class ${packageName}.** { *; }\n`;
          }
        }
        if (!content.includes('-dontwarn org.webrtc.Dav1dDecoder$Natives')) {
          content += WEBRTC_RULES;
        }
        fs.writeFileSync(proguardRulesFile, content, 'utf8');
      }
      return cfg;
    },
  ]);
};
