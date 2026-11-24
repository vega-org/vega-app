const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');
const updateDraft = require('../update-action-build-release.cjs');

function fixture({draft = true, existing = true, latest = 'commit', missingAab = false} = {}) {
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-action-build-'));
  fs.writeFileSync(path.join(artifactDirectory, 'vega-tv.apk'), 'apk');
  fs.writeFileSync(path.join(artifactDirectory, 'apk-name.txt'), 'vega-v5.3.0.apk');
  if (!missingAab) fs.writeFileSync(path.join(artifactDirectory, 'vega-tv-playstore.aab'), 'aab');
  const calls = [], release = {id: 12, draft, tag_name: 'action-build'};
  const record = name => async args => {calls.push([name, args]); return {data: release};};
  const github = {rest: {
    git: {
      getRef: async args => {
        if (args.ref === 'tags/action-build') throw {status: 404};
        return {data: {object: {sha: latest}}};
      }, updateRef: record('tag'),
    },
    repos: {
      listReleases() {}, listReleaseAssets() {},
      createRelease: record('create'), updateRelease: record('update'),
      uploadReleaseAsset: record('upload'), deleteReleaseAsset: record('delete'),
    },
  }, paginate: async method => method === github.rest.repos.listReleases
    ? existing ? [release] : []
    : [{id: 21, name: 'vega-tv.apk'}, {id: 22, name: 'vega-tv-playstore.aab'}]};
  const args = {github, artifactDirectory, core: {info() {}}, context: {
    repo: {owner: 'owner', repo: 'vega'}, sha: 'commit', serverUrl: 'https://github.com', runId: 42,
  }};
  return {calls, args};
}

test('main pushes cancel previous runs and use nightly signing for both TV variants', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../../.github/workflows/action-build.yml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  const job = workflow.jobs.build;
  assert.equal(job.environment, 'nightly');
  assert.equal(job.env.EXPO_TV, '1');
  const androidSetup = job.steps.find(step => step.uses === 'android-actions/setup-android@v3');
  assert.equal(androidSetup.with.packages, 'platform-tools');
  assert.equal(Object.values(job.env).some(value => String(value).includes('runner.')), false);
  const signing = job.steps.find(step => step.name === 'Load nightly signing credentials');
  assert.ok(signing.run.includes('export MYAPP_UPLOAD_STORE_FILE="$RUNNER_TEMP/action-build.keystore"'));
  assert.ok(signing.run.includes('>> "$GITHUB_ENV"'));
  assert.equal(job.env.MYAPP_UPLOAD_STORE_PASSWORD, '${{ secrets.KEYSTORE_PASSWORD }}');
  assert.equal(job.env.MYAPP_UPLOAD_KEY_ALIAS, '${{ secrets.KEY_ALIAS }}');
  assert.equal(job.env.MYAPP_UPLOAD_KEY_PASSWORD, '${{ secrets.KEY_PASSWORD }}');
  assert.equal(job.steps.find(step => step.name === 'Load nightly signing credentials').env.KEYSTORE_BASE64, '${{ secrets.KEYSTORE_BASE64 }}');
  const apk = job.steps.find(step => step.run?.includes(':app:assembleRelease'));
  const aab = job.steps.find(step => step.run?.includes(':app:bundleRelease'));
  assert.equal(apk.env.APP_VARIANT, 'tv');
  assert.equal(aab.env.APP_VARIANT, 'playstore');
  for (const step of [apk, aab]) {
    assert.ok(step.run.includes('--build-cache'));
    assert.ok(step.run.includes('-Xmx4096m'));
    assert.ok(step.run.includes('--max-workers=1 --no-parallel'));
    assert.ok(step.run.includes('-Pkotlin.compiler.execution.strategy=in-process'));
    assert.ok(step.run.includes('--stacktrace'));
  }
  assert.equal(job.steps.filter(step => step.run?.includes('expo prebuild')).length, 2);
  assert.equal(job.steps.some(step => step.uses?.includes('upload-artifact')), false);
});

test('reuses the existing draft and replaces both fixed asset names', async () => {
  const f = fixture(); await updateDraft(f.args);
  assert.equal(f.calls.filter(([name]) => name === 'create').length, 0);
  assert.deepEqual(f.calls.filter(([name]) => name === 'delete').map(([, args]) => args.asset_id), [21, 22]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'upload').map(([, args]) => args.name), ['vega-v5.3.0.apk', 'vega-tv-playstore.aab']);
  const metadata = f.calls.find(([name]) => name === 'update')[1];
  assert.equal(metadata.body.includes('Both builds support TV'), false);
  assert.equal(metadata.body.includes('com.vega'), false);
  assert.equal(metadata.draft, true); assert.equal(metadata.name, 'Action build');
  assert.equal(metadata.release_id, 12); assert.equal(metadata.target_commitish, 'commit');
});

test('creates only the fixed draft on first use', async () => {
  const f = fixture({existing: false}); await updateDraft(f.args);
  const created = f.calls.filter(([name]) => name === 'create');
  assert.equal(created.length, 1); assert.equal(created[0][1].tag_name, 'action-build');
  assert.equal(created[0][1].draft, true);
});

test('never uploads binaries to a published release', async () => {
  const f = fixture({draft: false});
  await assert.rejects(updateDraft(f.args), /public release/);
  assert.deepEqual(f.calls, []);
});

test('obsolete builds cannot replace newer main results', async () => {
  const f = fixture({latest: 'newer-commit'});
  await assert.rejects(updateDraft(f.args), /newer main commit/);
  assert.deepEqual(f.calls, []);
});

test('a missing build preserves the previous draft and assets', async () => {
  const f = fixture({missingAab: true});
  await assert.rejects(updateDraft(f.args), /ENOENT/);
  assert.deepEqual(f.calls, []);
});

for (const [kind, packageName] of [['apk', 'com.vega'], ['aab', 'vega.app']]) {
  for (const quote of ["'", '"']) {
    test(`collector accepts ${kind} with ${quote} quoted applicationId and rejects wrong package`, () => {
      const {spawnSync} = require('node:child_process');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-collector-'));
      try {
        const gradle = path.join(root, 'android/app/build.gradle');
        const output = path.join(root, 'android/app/build/outputs', kind === 'apk' ? 'apk/release' : 'bundle/release');
        fs.mkdirSync(output, {recursive: true});
        fs.writeFileSync(gradle, `android {\n defaultConfig {\n applicationId ${quote}${packageName}${quote}\n }\n}`);
        fs.writeFileSync(path.join(output, `app-release.${kind}`), 'signed build');
        const destination = path.join(root, `collected.${kind}`);
        const script = path.resolve(__dirname, '../collect-action-build.cjs');
        const result = spawnSync(process.execPath, [script, kind, destination], {cwd: root, encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(destination, 'utf8'), 'signed build');
        fs.writeFileSync(gradle, `applicationId ${quote}wrong.package${quote}`);
        const rejected = spawnSync(process.execPath, [script, kind, destination], {cwd: root, encoding: 'utf8'});
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr, /Wrong package/);
      } finally {
        fs.rmSync(root, {recursive: true, force: true});
      }
    });
  }
}
