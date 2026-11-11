import assert from 'node:assert/strict';
import test from 'node:test';

import { appexInfoPlist, quicklookPlan } from './build-quicklook.mjs';

test('Quick Look build follows the Tauri target and skips other platforms', () => {
  assert.equal(quicklookPlan({}, 'linux', 'x64'), null);
  assert.deepEqual(quicklookPlan({}, 'darwin', 'arm64'), {
    profile: 'release',
    triples: ['aarch64-apple-darwin'],
  });
  assert.deepEqual(
    quicklookPlan({ TAURI_ENV_DEBUG: 'true', TAURI_ENV_TARGET_TRIPLE: 'universal-apple-darwin' }, 'darwin', 'arm64'),
    {
      profile: 'debug',
      triples: ['aarch64-apple-darwin', 'x86_64-apple-darwin'],
    },
  );
  assert.equal(quicklookPlan({ TAURI_ENV_TARGET_TRIPLE: 'x86_64-unknown-linux-gnu' }, 'darwin', 'x64'), null);
});

test('Quick Look Info.plist claims Markdown and the preview extension', () => {
  const plist = appexInfoPlist('0.261111.0');
  assert.match(plist, /<string>0\.261111\.0<\/string>/);
  assert.match(plist, /<key>QLIsDataBasedPreview<\/key>\s*<true\/>/);
  assert.match(plist, /<string>net\.daringfireball\.markdown<\/string>/);
  assert.match(plist, /<string>com\.apple\.quicklook\.preview<\/string>/);
  assert.match(plist, /<string>MarkdownerQuickLook<\/string>/);
  assert.match(plist, /<string>dev\.chann\.markdowner\.quicklook<\/string>/);
});
