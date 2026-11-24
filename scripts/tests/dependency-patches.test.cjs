const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parsePatchFile} = require('patch-package/dist/patch/parse');

const patchDirectory = path.resolve(__dirname, '../../patches');
for (const name of fs.readdirSync(patchDirectory).filter(name => name.endsWith('.patch'))) {
  test(`patch-package can parse ${name}`, () => {
    const operations = parsePatchFile(fs.readFileSync(path.join(patchDirectory, name), 'utf8'));
    assert.ok(operations.length > 0);
  });
}
