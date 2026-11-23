const fs = require('fs');
const {addVideoPlayerAlias} = require('./video-player-intents');
const {writeSplashVectorResources} = require('./splash-vector-resources');
const path = require('path');
const {
  withAndroidManifest,
  withAndroidStyles,
  withDangerousMod,
  withMainActivity,
} = require('expo/config-plugins');

const variants = [
  {id: 'White', color: '#FFFFFFFF', enabled: false},
  {id: 'Tomato', color: '#FFFF6347', enabled: false},
  {id: 'Gray', color: '#FF9E9E9E', enabled: false},
  {id: 'Blue', color: '#FF2196F3', enabled: false},
  {id: 'Lavender', color: '#FFB2A4D4', enabled: false},
];

const setStyleItem = (style, name, value) => {
  style.item = Array.isArray(style.item) ? style.item : [];
  const existing = style.item.find(item => item?.$?.name === name);
  if (existing) {
    existing._ = value;
    return;
  }
  style.item.push({$: {name}, _: value});
};

const upsertStyle = (styles, name, parent, items = []) => {
  let style = styles.find(entry => entry?.$?.name === name);
  if (!style) {
    style = {$: {name}, item: []};
    styles.push(style);
  }
  if (parent) {
    style.$.parent = parent;
  }
  for (const [itemName, value] of items) {
    setStyleItem(style, itemName, value);
  }
};

const createLauncherAlias = (
  packageName,
  variant,
  name = `.Launcher${variant.id}`,
  enabled = variant.enabled,
) => ({
  $: {
    'android:name': name,
    'android:enabled': String(enabled),
    'android:exported': 'true',
    'android:icon': `@drawable/ic_launcher_${variant.id.toLowerCase()}`,
    'android:roundIcon': `@drawable/ic_launcher_${variant.id.toLowerCase()}`,
    'android:banner': `@drawable/tv_banner_${variant.id.toLowerCase()}`,
    'android:targetActivity': '.MainActivity',
    'android:theme': `@style/BootTheme.${variant.id}`,
  },
  'intent-filter': [
    {
      action: [{$: {'android:name': 'android.intent.action.MAIN'}}],
      category: [
        {$: {'android:name': 'android.intent.category.LAUNCHER'}},
        {$: {'android:name': 'android.intent.category.LEANBACK_LAUNCHER'}},
      ],
    },
  ],
});

const removeLauncherIntent = activity => {
  activity['intent-filter'] = (activity['intent-filter'] || []).filter(
    filter =>
      !filter.action?.some(
        action => action?.$?.['android:name'] === 'android.intent.action.MAIN',
      ),
  );
};

const withLauncherManifest = config =>
  withAndroidManifest(config, manifestConfig => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) {
      return manifestConfig;
    }
    // TV artwork belongs to the selected launcher alias. A fixed application
    // banner lets TV launchers keep showing the default color after alias changes.
    delete application.$['android:banner'];
    const mainActivity = application.activity?.find(
      activity => activity?.$?.['android:name'] === '.MainActivity',
    );
    if (mainActivity) {
      removeLauncherIntent(mainActivity);
      delete mainActivity.$['android:banner'];
      mainActivity.$['android:theme'] = '@style/BootTheme';
    }
    // The install-time entry is a separate white alias. Every selectable color,
    // white included, starts disabled so switching always enables a component
    // that was off. Google TV keeps the previous banner when the newly enabled
    // alias is one the manifest already enables.
    const packageName = manifestConfig.android?.package;
    application['activity-alias'] = [
      createLauncherAlias(packageName, variants[0], '.LauncherDefault', true),
      ...variants.map(variant => createLauncherAlias(packageName, variant)),
    ];
    addVideoPlayerAlias(application);
    return manifestConfig;
  });

const withLauncherStyles = config =>
  withAndroidStyles(config, stylesConfig => {
    const styles = stylesConfig.modResults.resources.style || [];
    stylesConfig.modResults.resources.style = styles;
    upsertStyle(styles, 'BootTheme', 'BootTheme.White');
    const bootTheme = styles.find(style => style?.$?.name === 'BootTheme');
    if (bootTheme) {
      bootTheme.item = [];
    }
    upsertStyle(styles, 'BootTheme.Base', 'Theme.BootSplash.EdgeToEdge', [
      ['postBootSplashTheme', '@style/AppTheme'],
      ['bootSplashBackground', '@color/bootsplash_background'],
    ]);
    for (const variant of variants) {
      upsertStyle(styles, `BootTheme.${variant.id}`, 'BootTheme.Base', [
        [
          'bootSplashLogo',
          `@drawable/bootsplash_logo_${variant.id.toLowerCase()}`,
        ],
      ]);
    }
    return stylesConfig;
  });

const bootThemeMethod = `  private fun getBootTheme(): Int {
    val launchedAlias = intent?.component?.className?.substringAfterLast('.')
    val selectedIcon = getSharedPreferences("vega_launcher", MODE_PRIVATE)
      .getString("icon", null) ?: when (launchedAlias) {
      "LauncherWhite" -> "white"
      "LauncherTomato" -> "tomato"
      "LauncherGray" -> "gray"
      "LauncherBlue" -> "blue"
      "LauncherLavender" -> "lavender"
      else -> "white"
    }
    return when (selectedIcon) {
      "tomato" -> R.style.BootTheme_Tomato
      "gray" -> R.style.BootTheme_Gray
      "blue" -> R.style.BootTheme_Blue
      "lavender" -> R.style.BootTheme_Lavender
      else -> R.style.BootTheme_White
    }
  }

`;

const bootSplashInitialization = `val bootTheme = getBootTheme()
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      splashScreen.setSplashScreenTheme(bootTheme)
    }
    RNBootSplash.init(this, bootTheme)`;

const withLauncherMainActivity = config =>
  withMainActivity(config, activityConfig => {
    let contents = activityConfig.modResults.contents;
    if (contents.includes('private fun getBootTheme()')) {
      contents = contents.replace(/  private fun getBootTheme\(\): Int \{[\s\S]*?\r?\n  \}\r?\n(?:\r?\n)?/, bootThemeMethod);
    } else {
      contents = contents.replace(
        /class MainActivity\s*:\s*ReactActivity\(\)\s*\{\n/,
        match => `${match}${bootThemeMethod}`,
      );
    }
    contents = contents.replace(
      /RNBootSplash\.init\(this,\s*(?:R\.style\.BootTheme|getBootTheme\(\))\)/,
      bootSplashInitialization,
    );
    activityConfig.modResults.contents = contents;
    return activityConfig;
  });

const writeLauncherResources = resRoot => {
  const drawable = path.join(resRoot, 'drawable');
  const drawableV26 = path.join(resRoot, 'drawable-v26');
  fs.mkdirSync(drawable, {recursive: true});
  fs.mkdirSync(drawableV26, {recursive: true});
  for (const variant of variants) {
    const id = variant.id.toLowerCase();
    fs.writeFileSync(
      path.join(drawable, `ic_launcher_foreground_${id}.xml`),
      `<bitmap xmlns:android="http://schemas.android.com/apk/res/android"
    android:gravity="center"
    android:src="@mipmap/ic_launcher_foreground"
    android:tint="${variant.color}"
    android:tintMode="src_in" />\n`,
    );
    fs.writeFileSync(
      path.join(drawableV26, `ic_launcher_${id}.xml`),
      `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_${id}" />
</adaptive-icon>\n`,
    );
  }
};

const copyTvBannerResources = (projectRoot, resRoot) => {
  const targetDir = path.join(resRoot, 'drawable-nodpi');
  fs.mkdirSync(targetDir, {recursive: true});
  for (const variant of variants) {
    const filename = `tv_banner_${variant.id.toLowerCase()}.png`;
    fs.copyFileSync(
      path.join(projectRoot, 'assets', 'tv-banners', filename),
      path.join(targetDir, filename),
    );
  }
};

const patchGeneratedBootSplashFiles = (projectRoot, packageName) => {
  const mainActivityPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.'),
    'MainActivity.kt',
  );
  let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
  mainActivity = mainActivity.replace(
    /RNBootSplash\.init\(this,\s*(?:R\.style\.BootTheme|getBootTheme\(\))\)/,
    bootSplashInitialization,
  );
  fs.writeFileSync(mainActivityPath, mainActivity, 'utf8');
};

const withLauncherResources = config =>
  withDangerousMod(config, [
    'android',
    async modConfig => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const resRoot = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
      );
      writeLauncherResources(resRoot);
      copyTvBannerResources(projectRoot, resRoot);
      writeSplashVectorResources(projectRoot, resRoot, variants);
      patchGeneratedBootSplashFiles(
        projectRoot,
        modConfig.android?.package || 'com.vega',
      );
      return modConfig;
    },
  ]);

module.exports = function withDynamicLauncherSplash(config) {
  config = withLauncherManifest(config);
  config = withLauncherStyles(config);
  config = withLauncherMainActivity(config);
  return withLauncherResources(config);
};
