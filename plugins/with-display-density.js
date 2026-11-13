const {withMainActivity} = require('expo/config-plugins');

const sync = 'com.facebook.react.uimanager.DisplayMetricsHolder.initDisplayMetrics(this)';

// RN's process-wide text metrics can retain the phone density in Samsung DeX.
// Use the Activity's display context on launch and after configuration changes.
// https://github.com/react/react-native/issues/57183
module.exports = config => withMainActivity(config, cfg => {
  if (cfg.modResults.language !== 'kt') {
    throw new Error('Vega display density workaround requires a Kotlin MainActivity');
  }
  let contents = cfg.modResults.contents;
  const injectAfterSuper = (pattern, label) => {
    if (!pattern.test(contents)) throw new Error(`MainActivity ${label} changed; review display density synchronization`);
    contents = contents.replace(pattern, (match, indent, followingSync) =>
      followingSync ? match : `${match}\n${indent}${sync}`);
  };
  injectAfterSuper(/(^[ \t]*)super\.onCreate\([^\r\n]*\)(?:[ \t]*\r?\n[ \t]*(com\.facebook\.react\.uimanager\.DisplayMetricsHolder\.initDisplayMetrics\(this\)))?/m, 'onCreate');
  if (/override fun onConfigurationChanged\(/.test(contents)) {
    injectAfterSuper(/(^[ \t]*)super\.onConfigurationChanged\([^\r\n]*\)(?:[ \t]*\r?\n[ \t]*(com\.facebook\.react\.uimanager\.DisplayMetricsHolder\.initDisplayMetrics\(this\)))?/m, 'onConfigurationChanged');
  } else {
    const end = contents.lastIndexOf('}');
    if (end < 0) throw new Error('MainActivity class closing brace missing');
    contents = contents.slice(0, end) + `
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    ${sync}
  }
` + contents.slice(end);
  }
  cfg.modResults.contents = contents;
  return cfg;
});
