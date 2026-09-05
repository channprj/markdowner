import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildRelease, publishRelease, releaseDmgPath } from './release.mjs';

const silentLogger = { log() {} };

function fixture(version = '0.260906.0') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'markdowner-release-'));
  fs.writeFileSync(path.join(projectRoot, 'VERSION'), `${version}\n`);
  return { projectRoot, version };
}

function writeArtifact(projectRoot, version) {
  const artifact = releaseDmgPath(projectRoot, version);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, 'fake universal dmg\n');
  return artifact;
}

function fakeRunner(respond) {
  const calls = [];
  const runner = (command, args, options = {}) => {
    calls.push({ args, command, options });
    return {
      status: 0,
      stderr: '',
      stdout: '',
      ...(respond?.(command, args, options, calls) ?? {}),
    };
  };
  return { calls, runner };
}

function commandList(calls) {
  return calls.map(({ args, command }) => [command, ...args].join(' '));
}

function publishingRunner(overrides = {}) {
  return fakeRunner((command, args) => {
    const full = [command, ...args].join(' ');
    if (full === 'git status --porcelain') return { stdout: overrides.status ?? '' };
    if (full === 'git branch --show-current') return { stdout: `${overrides.branch ?? 'main'}\n` };
    if (full === 'git rev-parse --abbrev-ref --symbolic-full-name @{u}') {
      return { stdout: `${overrides.upstream ?? 'origin/main'}\n` };
    }
    if (full === 'git rev-list --left-right --count HEAD...origin/main') {
      return { stdout: `${overrides.parity ?? '0\t0'}\n` };
    }
    if (full === 'git rev-parse HEAD') return { stdout: '0123456789abcdef\n' };
    if (full.startsWith('git show-ref --verify --quiet refs/tags/')) {
      return { status: overrides.localTagStatus ?? 1 };
    }
    if (full.startsWith('git ls-remote --exit-code --tags origin refs/tags/')) {
      return { status: overrides.remoteTagStatus ?? 2 };
    }
    if (full.startsWith('gh release view ') && !args.includes('--jq')) {
      if (overrides.releaseExists) return { stdout: '{"url":"https://example.test/release"}\n' };
      return { status: 1, stderr: 'release not found\n' };
    }
    if (full.startsWith('gh release view ') && args.includes('--jq')) {
      return { stdout: 'https://github.com/channprj/markdowner/releases/tag/v0.260906.0\n' };
    }
    return {};
  });
}

test('build runs local gates before creating and verifying the universal DMG', () => {
  const { projectRoot, version } = fixture();
  try {
    const { calls, runner } = fakeRunner((command, args) => {
      if ([command, ...args].join(' ') === 'pnpm build universal dmg') {
        writeArtifact(projectRoot, version);
      }
      return {};
    });

    const artifact = buildRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });

    assert.equal(artifact, releaseDmgPath(projectRoot, version));
    assert.deepEqual(commandList(calls), [
      'pnpm sync-version --check',
      'pnpm test',
      'cargo test',
      'pnpm build universal dmg',
      `hdiutil verify ${artifact}`,
    ]);
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

test('publish creates a release only after local and remote preflight checks', () => {
  const { projectRoot, version } = fixture();
  try {
    const artifact = writeArtifact(projectRoot, version);
    const { calls, runner } = publishingRunner();

    publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });

    const commands = commandList(calls);
    assert.deepEqual(commands.slice(0, 8), [
      'pnpm sync-version --check',
      'git status --porcelain',
      'git branch --show-current',
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      'git fetch origin main --tags',
      'git rev-list --left-right --count HEAD...origin/main',
      'git rev-parse HEAD',
      `hdiutil verify ${artifact}`,
    ]);
    assert.ok(commands.includes('gh auth status --hostname github.com'));
    assert.ok(commands.includes(`git show-ref --verify --quiet refs/tags/v${version}`));
    assert.ok(commands.includes(`git ls-remote --exit-code --tags origin refs/tags/v${version}`));
    assert.ok(
      commands.includes(
        `gh release create v${version} --repo channprj/markdowner --target 0123456789abcdef --title v${version} --generate-notes ${artifact}`,
      ),
    );
    assert.equal(commands.at(-1), `gh release view v${version} --repo channprj/markdowner --json url --jq .url`);
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

test('publish fails closed on a dirty working tree', () => {
  const { projectRoot, version } = fixture();
  try {
    writeArtifact(projectRoot, version);
    const { calls, runner } = publishingRunner({ status: ' M package.json\n' });

    assert.throws(
      () => publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner }),
      /working tree must be clean/,
    );
    assert.ok(!commandList(calls).some((command) => command.startsWith('gh release create ')));
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

test('publish refuses to replace an existing GitHub Release', () => {
  const { projectRoot, version } = fixture();
  try {
    writeArtifact(projectRoot, version);
    const { calls, runner } = publishingRunner({ releaseExists: true });

    assert.throws(
      () => publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner }),
      /GitHub Release already exists/,
    );
    assert.ok(!commandList(calls).some((command) => command.startsWith('gh release create ')));
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});
