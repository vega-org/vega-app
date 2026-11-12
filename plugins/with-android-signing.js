const fs = require('fs');
const path = require('path');
const {withDangerousMod} = require('expo/config-plugins');

/**
 * Adds release signing configuration that reads from env vars after prebuild.
 * Uses a Gradle file that applies signing config during the android block evaluation.
 */
module.exports = function withAndroidSigning(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appDir = path.join(projectRoot, 'android', 'app');
      const buildGradle = path.join(appDir, 'build.gradle');
      const signingGradle = path.join(appDir, 'with-signing.gradle');

      // Auto-copy keystore to android/app if it exists
      const keystoreSrc = path.join(projectRoot, 'vega-key.keystore');
      const keystoreDest = path.join(appDir, 'vega-key.keystore');
      if (fs.existsSync(keystoreSrc)) {
        fs.copyFileSync(keystoreSrc, keystoreDest);
      }

      // Create signing gradle that extends signingConfigs during android block
      const signingContent = `// Auto-applied by with-android-signing config plugin
android {
    signingConfigs {
        release {
            def envStoreFile = System.getenv('MYAPP_UPLOAD_STORE_FILE')
            def envStorePassword = System.getenv('MYAPP_UPLOAD_STORE_PASSWORD')
            def envKeyAlias = System.getenv('MYAPP_UPLOAD_KEY_ALIAS')
            def envKeyPassword = System.getenv('MYAPP_UPLOAD_KEY_PASSWORD')
            
            if (envStoreFile && envStorePassword && envKeyAlias && envKeyPassword) {
                def keystoreFile = file(envStoreFile)
                println "Keystore file path: \${envStoreFile}"
                println "Keystore file exists: \${keystoreFile.exists()}"
                
                if (keystoreFile.exists()) {
                    storeFile keystoreFile
                    storePassword envStorePassword
                    keyAlias envKeyAlias
                    keyPassword envKeyPassword
                    println "Release signing config configured successfully"
                } else {
                    println "Keystore file not found: \${envStoreFile}"
                }
            } else {
                println "Missing signing environment variables:"
                println "  MYAPP_UPLOAD_STORE_FILE: \${envStoreFile}"
                println "  MYAPP_UPLOAD_STORE_PASSWORD: \${envStorePassword ? '***' : 'null'}"
                println "  MYAPP_UPLOAD_KEY_ALIAS: \${envKeyAlias}"
                println "  MYAPP_UPLOAD_KEY_PASSWORD: \${envKeyPassword ? '***' : 'null'}"
            }
        }
    }
}

// Use afterEvaluate to forcefully override the release signing config
afterEvaluate {
    def releaseSigningConfig = android.signingConfigs.release
    println "🔧 Final signing config check:"
    println "  Release signingConfig storeFile: \${releaseSigningConfig.storeFile}"
    println "  Current release buildType signingConfig: \${android.buildTypes.release.signingConfig?.name}"
    
    if (releaseSigningConfig.storeFile && releaseSigningConfig.storeFile.exists()) {
        // Force override the signing config
        android.buildTypes.release.signingConfig = releaseSigningConfig
        println "✅ Applied release signing config: \${releaseSigningConfig.storeFile.absolutePath}"
        println "  Final release buildType signingConfig: \${android.buildTypes.release.signingConfig?.name}"
    } else {
        println "❌ Release signing config not applied, using debug keystore"
        if (releaseSigningConfig.storeFile) {
            println "   Keystore file does not exist: \${releaseSigningConfig.storeFile.absolutePath}"
        } else {
            println "   No keystore file configured"
        }
    }
}
`;
      fs.writeFileSync(signingGradle, signingContent, 'utf8');

      // Idempotently add apply from with-signing.gradle
      let gradleText = fs.readFileSync(buildGradle, 'utf8');
      if (!gradleText.includes("apply from: 'with-signing.gradle'")) {
        // Find the last apply from line and add our line after it
        const applyFromLines = gradleText.match(/apply from: '[^']+'/g);
        if (applyFromLines && applyFromLines.length > 0) {
          const lastApplyFrom = applyFromLines[applyFromLines.length - 1];
          gradleText = gradleText.replace(
            lastApplyFrom,
            `${lastApplyFrom}\napply from: 'with-signing.gradle'`,
          );
        } else {
          // If no apply from lines found, add after React plugin
          gradleText = gradleText.replace(
            /apply plugin: "com\.facebook\.react"/,
            `apply plugin: "com.facebook.react"\napply from: 'with-signing.gradle'`,
          );
        }
        fs.writeFileSync(buildGradle, gradleText, 'utf8');
      }

      // Keep debug fallback unless all release signing env vars are provided.
      const hasReleaseSigningEnv =
        !!process.env.MYAPP_UPLOAD_STORE_FILE &&
        !!process.env.MYAPP_UPLOAD_STORE_PASSWORD &&
        !!process.env.MYAPP_UPLOAD_KEY_ALIAS &&
        !!process.env.MYAPP_UPLOAD_KEY_PASSWORD;

      gradleText = fs.readFileSync(buildGradle, 'utf8');
      if (hasReleaseSigningEnv) {
        gradleText = gradleText.replace(
          /release\s*\{[^}]*signingConfig\s+signingConfigs\.debug/,
          match =>
            match.replace('signingConfigs.debug', 'signingConfigs.release'),
        );
      } else {
        gradleText = gradleText.replace(
          /release\s*\{[^}]*signingConfig\s+signingConfigs\.release/,
          match =>
            match.replace('signingConfigs.release', 'signingConfigs.debug'),
        );
      }
      fs.writeFileSync(buildGradle, gradleText, 'utf8');

      return cfg;
    },
  ]);
};
