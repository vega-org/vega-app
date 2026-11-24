const fs = require('node:fs');
const path = require('node:path');

const [kind, destination] = process.argv.slice(2);
if (!['apk', 'aab'].includes(kind) || !destination) throw new Error('Usage: collect-action-build.cjs apk|aab destination');
const expectedPackage = kind === 'apk' ? 'com.vega' : 'vega.app';
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const packageMatch = gradle.match(/^\s*applicationId\s*(?:=\s*)?(["'])([^"']+)\1\s*;?\s*$/m);
if (packageMatch?.[2] !== expectedPackage) {
  throw new Error(`Wrong package: expected ${expectedPackage}, found ${packageMatch?.[2] || 'no applicationId'}`);
}
const folder = kind === 'apk' ? 'android/app/build/outputs/apk/release' : 'android/app/build/outputs/bundle/release';
const files = fs.readdirSync(folder).filter(name => name.endsWith(`.${kind}`) && !name.includes('unsigned'));
// The release plugin builds one universal ARM APK; fail instead of choosing an ABI at random.
if (files.length !== 1) throw new Error(`Expected one signed ${kind.toUpperCase()}, found ${files.length}`);
fs.copyFileSync(path.join(folder, files[0]), destination);
if (kind === 'apk') fs.writeFileSync(path.join(path.dirname(destination), 'apk-name.txt'), files[0]);
console.log(`Prepared ${path.basename(destination)}`);
