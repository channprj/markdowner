#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDir, '..');
const repository = 'channprj/markdowner';

function usage() {
  console.log(`Usage:
  pnpm release:build      Run local release checks and build a universal DMG
  pnpm release:publish    Reuse a current DMG or build it, then publish with GitHub CLI

The publish command never commits or pushes source changes. It requires a clean main branch
that exactly matches origin/main, an unused VERSION tag, and gh authentication.`);
}

function fail(message) {
  throw new Error(message);
}

export function runCommand(command, args, options = {}) {
  const capture = options.capture ?? false;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    fail(`failed to run '${command}': ${result.error.message}`);
  }

  const normalized = {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
  if (normalized.status !== 0 && !options.allowFailure) {
    const detail = `${normalized.stderr}${normalized.stdout}`.trim();
    fail(`'${command} ${args.join(' ')}' failed${detail ? `: ${detail}` : ''}`);
  }
  return normalized;
}

function run(runner, projectRoot, command, args, options = {}) {
  return runner(command, args, { cwd: projectRoot, ...options });
}

function output(result) {
  return result.stdout.trim();
}

function requireMacOs(platform) {
  if (platform !== 'darwin') {
    fail('local Markdowner releases currently require macOS');
  }
}

export function readVersion(projectRoot = defaultProjectRoot) {
  const version = fs.readFileSync(path.join(projectRoot, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid VERSION: ${JSON.stringify(version)}`);
  }
  return version;
}

export function releaseDmgPath(projectRoot, version) {
  return path.join(
    projectRoot,
    'target',
    'tauri-build-and-install',
    'universal-apple-darwin',
    'release',
    'bundle',
    'dmg',
    `Markdowner_${version}_universal.dmg`,
  );
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireReleaseDmg(projectRoot, version) {
  const artifact = releaseDmgPath(projectRoot, version);
  if (!fs.existsSync(artifact)) {
    fail(`release DMG not found: ${path.relative(projectRoot, artifact)}\nrun: pnpm release:build`);
  }
  return artifact;
}

function readCleanHead(runner, projectRoot) {
  const status = output(
    run(runner, projectRoot, 'git', ['status', '--porcelain'], { capture: true }),
  );
  if (status) return null;
  return output(run(runner, projectRoot, 'git', ['rev-parse', 'HEAD'], { capture: true }));
}

function hasCurrentReleaseDmg(projectRoot, version, commit) {
  const artifact = releaseDmgPath(projectRoot, version);
  try {
    const record = JSON.parse(fs.readFileSync(`${artifact}.build.json`, 'utf8'));
    return record?.version === version && record.commit === commit && record.sha256 === sha256(artifact);
  } catch {
    // Legacy, missing, or damaged build records cannot establish freshness.
    return false;
  }
}

export function buildRelease({
  logger = console,
  platform = process.platform,
  projectRoot = defaultProjectRoot,
  runner = runCommand,
} = {}) {
  requireMacOs(platform);
  const version = readVersion(projectRoot);
  const recordPath = `${releaseDmgPath(projectRoot, version)}.build.json`;
  // A failed rebuild must never leave an earlier success record reusable.
  fs.rmSync(recordPath, { force: true });
  const commit = readCleanHead(runner, projectRoot);

  run(runner, projectRoot, 'pnpm', ['sync-version', '--check']);
  run(runner, projectRoot, 'pnpm', ['test']);
  // Process fixtures exercise short deadlines and shared OS resources.
  run(runner, projectRoot, 'cargo', ['test', '--', '--test-threads=1']);
  run(runner, projectRoot, 'pnpm', ['build', 'universal', 'dmg']);

  const artifact = requireReleaseDmg(projectRoot, version);
  run(runner, projectRoot, 'hdiutil', ['verify', artifact]);

  const checksum = sha256(artifact);
  if (commit && readCleanHead(runner, projectRoot) === commit) {
    fs.writeFileSync(recordPath, `${JSON.stringify({ version, commit, sha256: checksum }, null, 2)}\n`);
  } else {
    logger.log('Build is not reusable for publishing: the checkout was dirty or changed during the build.');
  }

  logger.log(`Release DMG: ${artifact}`);
  logger.log(`SHA-256: ${checksum}`);
  return artifact;
}

function requireCleanMain(runner, projectRoot) {
  const status = output(
    run(runner, projectRoot, 'git', ['status', '--porcelain'], { capture: true }),
  );
  if (status) {
    fail('working tree must be clean before publishing');
  }

  const branch = output(
    run(runner, projectRoot, 'git', ['branch', '--show-current'], { capture: true }),
  );
  if (branch !== 'main') {
    fail(`release publishing requires the main branch; current branch: ${branch || '(detached)'}`);
  }

  const upstream = output(
    run(
      runner,
      projectRoot,
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { capture: true },
    ),
  );
  if (upstream !== 'origin/main') {
    fail(`release publishing requires upstream origin/main; current upstream: ${upstream || '(none)'}`);
  }

  run(runner, projectRoot, 'git', ['fetch', 'origin', 'main', '--tags']);
  const parity = output(
    run(runner, projectRoot, 'git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], {
      capture: true,
    }),
  )
    .split(/\s+/)
    .filter(Boolean);
  if (parity.length !== 2 || parity[0] !== '0' || parity[1] !== '0') {
    fail(`HEAD must exactly match origin/main before publishing; parity: ${parity.join(' ') || '(unknown)'}`);
  }

  return output(run(runner, projectRoot, 'git', ['rev-parse', 'HEAD'], { capture: true }));
}

function requireUnusedRelease(runner, projectRoot, tag) {
  const localTag = run(
    runner,
    projectRoot,
    'git',
    ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`],
    { allowFailure: true },
  );
  if (localTag.status === 0) {
    fail(`local tag already exists: ${tag}`);
  }
  if (localTag.status !== 1) {
    fail(`failed to check local tag ${tag}`);
  }

  const remoteTag = run(
    runner,
    projectRoot,
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`],
    { allowFailure: true, capture: true },
  );
  if (remoteTag.status === 0) {
    fail(`remote tag already exists: ${tag}`);
  }
  if (remoteTag.status !== 2) {
    const detail = `${remoteTag.stderr}${remoteTag.stdout}`.trim();
    fail(`failed to check remote tag ${tag}${detail ? `: ${detail}` : ''}`);
  }

  const existingRelease = run(
    runner,
    projectRoot,
    'gh',
    ['release', 'view', tag, '--repo', repository, '--json', 'url'],
    { allowFailure: true, capture: true },
  );
  if (existingRelease.status === 0) {
    fail(`GitHub Release already exists: ${tag}`);
  }
  const releaseError = `${existingRelease.stderr}${existingRelease.stdout}`.trim();
  if (existingRelease.status !== 1 || !releaseError.toLowerCase().includes('release not found')) {
    fail(`failed to check GitHub Release ${tag}${releaseError ? `: ${releaseError}` : ''}`);
  }
}

export function publishRelease({
  logger = console,
  platform = process.platform,
  projectRoot = defaultProjectRoot,
  runner = runCommand,
} = {}) {
  requireMacOs(platform);
  const version = readVersion(projectRoot);
  const tag = `v${version}`;

  run(runner, projectRoot, 'pnpm', ['sync-version', '--check']);
  const head = requireCleanMain(runner, projectRoot);
  run(runner, projectRoot, 'gh', ['auth', 'status', '--hostname', 'github.com']);
  requireUnusedRelease(runner, projectRoot, tag);

  const artifact = releaseDmgPath(projectRoot, version);
  if (hasCurrentReleaseDmg(projectRoot, version, head)) {
    logger.log(`Reusing release DMG for ${head}`);
    run(runner, projectRoot, 'hdiutil', ['verify', artifact]);
  } else {
    logger.log('No current verified release DMG found; running release checks and building.');
    buildRelease({ logger, platform, projectRoot, runner });
  }

  // Tests and a universal build can take long enough for the checkout or remote to change.
  if (requireCleanMain(runner, projectRoot) !== head || !hasCurrentReleaseDmg(projectRoot, version, head)) {
    fail('source or release DMG changed during preparation; run: pnpm release:publish');
  }

  logger.log(`Publishing ${tag} from ${head}`);
  logger.log(`Asset: ${artifact}`);
  logger.log(`SHA-256: ${sha256(artifact)}`);
  run(runner, projectRoot, 'gh', [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--target',
    head,
    '--title',
    tag,
    '--generate-notes',
    artifact,
  ]);

  const published = run(
    runner,
    projectRoot,
    'gh',
    ['release', 'view', tag, '--repo', repository, '--json', 'url', '--jq', '.url'],
    { capture: true },
  );
  logger.log(`Published: ${output(published)}`);
}

function main() {
  const command = process.argv[2];
  if (command === 'build') {
    buildRelease();
    return;
  }
  if (command === 'publish') {
    publishRelease();
    return;
  }
  usage();
  if (command && command !== '-h' && command !== '--help' && command !== 'help') {
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
