const {
  withAndroidManifest,
  withAndroidStyles,
} = require('expo/config-plugins');

const ADD_SOURCE_ACTION = 'vega.intent.action.ADD_SOURCE';

const withAndroidNativeConfig = config => {
  config = withAndroidManifest(config, manifestConfig => {
    // QR scanning is optional. Its Google scanner activity is portrait-only,
    // which otherwise makes Play filter out landscape-only TVs as well.
    const manifest = manifestConfig.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    for (const name of [
      'android.hardware.camera',
      'android.hardware.camera.any',
      'android.hardware.camera.autofocus',
      'android.hardware.touchscreen',
      'android.hardware.screen.portrait',
      'android.hardware.microphone',
      'android.hardware.wifi',
    ]) {
      const feature = manifest['uses-feature'].find(item => item.$?.['android:name'] === name);
      if (feature) feature.$['android:required'] = 'false';
      else manifest['uses-feature'].push({$: {'android:name': name, 'android:required': 'false'}});
    }
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:usesCleartextTraffic'] = 'true';
      // Larger Java heap for player buffers; the buffer settings cap usage by
      // device RAM, so this only raises the ceiling.
      application.$['android:largeHeap'] = 'true';
    }

    // Custom "add provider source" intent (action + "url" extra, no data URI).
    // BROWSABLE lets web pages fire it through a Chrome intent: URI.
    const mainActivity = application?.activity?.find(
      activity => activity?.$?.['android:name'] === '.MainActivity',
    );
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
      const hasAddSourceFilter = mainActivity['intent-filter'].some(filter =>
        filter.action?.some(
          action => action.$['android:name'] === ADD_SOURCE_ACTION,
        ),
      );
      if (!hasAddSourceFilter) {
        mainActivity['intent-filter'].push({
          action: [{$: {'android:name': ADD_SOURCE_ACTION}}],
          category: [
            {$: {'android:name': 'android.intent.category.DEFAULT'}},
            {$: {'android:name': 'android.intent.category.BROWSABLE'}},
          ],
        });
      }
    }

    return manifestConfig;
  });

  return withAndroidStyles(config, config => {
    // Safely access the styles
    const styles = config.modResults;

    // Ensure we have the basic structure
    if (!styles || !styles.resources) {
      return config;
    }

    // Ensure styles.resources.style exists and is an array
    if (!styles.resources.style || !Array.isArray(styles.resources.style)) {
      styles.resources.style = [];
    }

    // Helper function to safely add text color to a style
    const addTextColorToStyle = styleName => {
      // Find the style element
      const styleElement = styles.resources.style.find(
        style => style && style.$ && style.$.name === styleName,
      );

      if (!styleElement) {
        return; // Style not found, skip
      }

      // Ensure item array exists
      if (!styleElement.item || !Array.isArray(styleElement.item)) {
        styleElement.item = [];
      }

      // Check if text color already exists
      const existingTextColor = styleElement.item.find(
        item => item && item.$ && item.$.name === 'android:textColor',
      );

      if (existingTextColor) {
        // Update existing
        existingTextColor._ = '@android:color/white';
      } else {
        // Add new text color item
        styleElement.item.push({
          $: {name: 'android:textColor'},
          _: '@android:color/white',
        });
      }
    };

    // Apply text color to styles
    addTextColorToStyle('AppTheme');
    addTextColorToStyle('ResetEditText');

    return config;
  });
};

module.exports = withAndroidNativeConfig;
