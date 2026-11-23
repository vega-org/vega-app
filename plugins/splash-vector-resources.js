const fs = require('fs');
const path = require('path');

const ANDROID = 'http://schemas.android.com/apk/res/android';
const XML = '<?xml version="1.0" encoding="utf-8"?>\n';

// Convert the supplied SVG paths without rasterizing or changing their geometry.
function createSplashVectorResources(svg, variants) {
  const paths = [...svg.matchAll(/<path\b([^>]*)>/g)].map(match => {
    const attrs = {};
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
    return attrs;
  });
  if (paths.length !== 5 || !paths[1]['clip-path'] || !paths.every(p => p.d)) {
    throw new Error('Unexpected Vega splash SVG geometry; review the converter before replacing the source.');
  }
  const [clip, ring, wordmark, camera, play] = paths;
  const files = {};
  // 200 x 146dp artwork centered in Android's 288dp splash icon canvas.
  // Transparent padding protects the artwork from the system icon mask.
  const vector = (color, animated) => `${XML}<vector xmlns:android="${ANDROID}"
    android:width="288dp" android:height="288dp"
    android:viewportWidth="2473.92" android:viewportHeight="2473.92">
  <group android:translateX="377.96" android:translateY="610.96">
    <group>
      <clip-path android:pathData="${clip.d}" />
      <path android:name="ring" android:pathData="${ring.d}"
          android:fillColor="#00000000" android:strokeColor="${ring.stroke}"
          android:strokeWidth="${ring['stroke-width']}" android:trimPathEnd="${animated ? 0 : 1}" />
    </group>
    <path android:name="wordmark" android:pathData="${wordmark.d}"
        android:fillColor="${wordmark.fill}" android:fillAlpha="${animated ? 0 : 1}" />
    <path android:name="camera" android:pathData="${camera.d}"
        android:fillColor="${color}" android:fillAlpha="${animated ? 0 : 1}" />
    <path android:name="play" android:pathData="${play.d}"
        android:fillColor="${color}" android:fillAlpha="${animated ? 0 : 1}" />
  </group>
</vector>\n`;

  for (const variant of variants) {
    const id = variant.id.toLowerCase();
    files[`drawable/bootsplash_logo_${id}.xml`] = vector(variant.color, false);
    files[`drawable/bootsplash_motion_${id}.xml`] = vector(variant.color, true);
    files[`drawable/bootsplash_animated_${id}.xml`] = `${XML}<animated-vector xmlns:android="${ANDROID}"
    android:drawable="@drawable/bootsplash_motion_${id}">
  ${['ring', 'wordmark', 'camera', 'play'].map(name => `<target android:name="${name}" android:animation="@animator/bootsplash_${name}" />`).join('\n  ')}
</animated-vector>\n`;
  }
  for (const [name, property, delay, duration] of [
    ['ring', 'trimPathEnd', 0, 800],
    ['wordmark', 'fillAlpha', 50, 380],
    ['camera', 'fillAlpha', 90, 350],
    ['play', 'fillAlpha', 330, 280],
  ]) {
    files[`animator/bootsplash_${name}.xml`] = `${XML}<objectAnimator xmlns:android="${ANDROID}"
    android:propertyName="${property}" android:valueFrom="0" android:valueTo="1"
    android:valueType="floatType" android:startOffset="${delay}" android:duration="${duration}"
    android:interpolator="@android:interpolator/linear" />\n`;
  }
  files['values-v31/vega_splash.xml'] = `${XML}<resources>
${variants.map(variant => `  <style name="BootTheme.${variant.id}" parent="BootTheme.Base">
    <item name="bootSplashLogo">@drawable/bootsplash_logo_${variant.id.toLowerCase()}</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/bootsplash_animated_${variant.id.toLowerCase()}</item>
    <item name="android:windowSplashScreenAnimationDuration">800</item>
  </style>`).join('\n')}
</resources>\n`;
  return files;
}

function writeSplashVectorResources(projectRoot, resRoot, variants) {
  const svg = fs.readFileSync(path.join(projectRoot, 'assets/bootsplash/vega_circle.svg'), 'utf8');
  const files = createSplashVectorResources(svg, variants);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(resRoot, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, contents);
  }
  // Remove the old color PNGs on incremental prebuilds, otherwise Android may
  // select a density-specific bitmap instead of the new default vector.
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const variant of variants) {
      const old = path.join(resRoot, `drawable-${density}`, `bootsplash_logo_${variant.id.toLowerCase()}.png`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
  }
}

module.exports = {createSplashVectorResources, writeSplashVectorResources};
