const {readFileSync, statSync} = require('node:fs');
const path = require('node:path');

module.exports = async ({github, context, core, artifactDirectory}) => {
  const repo = context.repo;
  const tag = 'action-build';
  const apkName = readFileSync(path.join(artifactDirectory, 'apk-name.txt'), 'utf8').trim();
  if (!/^vega-v[0-9][a-zA-Z0-9.+_-]*\.apk$/.test(apkName)) throw new Error('Invalid generated APK name');
  const assets = [
    {name: apkName, file: 'vega-tv.apk', type: 'application/vnd.android.package-archive'},
    {name: 'vega-tv-playstore.aab', type: 'application/octet-stream'},
  ];
  // Both outputs must exist before touching the previous successful draft.
  for (const asset of assets) {
    if (!statSync(path.join(artifactDirectory, asset.file || asset.name)).size) throw new Error(`Empty build: ${asset.name}`);
  }
  const assertLatest = async () => {
    const {data} = await github.rest.git.getRef({...repo, ref: 'heads/main'});
    if (data.object.sha !== context.sha) throw new Error('A newer main commit exists; refusing to replace its draft build.');
  };
  await assertLatest();
  const releases = await github.paginate(github.rest.repos.listReleases, {...repo, per_page: 100});
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) throw new Error('action-build is published. Refusing to upload private build assets to a public release.');
  const metadata = {
    ...repo, tag_name: tag, name: 'Action build', draft: true, prerelease: true,
    target_commitish: context.sha,
    body: `Latest successful main build.\n\nCommit: ${context.sha}\nRun: ${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}\n`,
  };
  if (!release) release = (await github.rest.repos.createRelease(metadata)).data;
  const currentAssets = await github.paginate(github.rest.repos.listReleaseAssets, {...repo, release_id: release.id, per_page: 100});
  for (const asset of assets) {
    await assertLatest();
    for (const previous of currentAssets.filter(item => item.name === asset.name || (asset.file === 'vega-tv.apk' && (item.name === 'vega-tv.apk' || /^vega-v.*\.apk$/.test(item.name))))) {
      await github.rest.repos.deleteReleaseAsset({...repo, asset_id: previous.id});
    }
    await github.rest.repos.uploadReleaseAsset({
      ...repo, release_id: release.id, name: asset.name,
      data: readFileSync(path.join(artifactDirectory, asset.file || asset.name)),
      headers: {'content-type': asset.type},
    });
  }
  await assertLatest();
  // If the fixed tag already exists, move it to the commit these binaries came from.
  try {
    await github.rest.git.getRef({...repo, ref: `tags/${tag}`});
    await github.rest.git.updateRef({...repo, ref: `tags/${tag}`, sha: context.sha, force: true});
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await github.rest.repos.updateRelease({...metadata, release_id: release.id});
  core.info('Updated the Action build draft with the TV APK and Play Store TV AAB.');
};
