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
    const result = {
      status: 0,
      stderr: '',
      stdout: '',
      ...(respond?.(command, args, options, calls) ?? {}),
    };
    if (result.status !== 0 && !options.allowFailure) {
      throw new Error(`'${command} ${args.join(' ')}' failed`);
    }
    return result;
  };
  return { calls, runner };
}

function commandList(calls) {
  return calls.map(({ args, command }) => [command, ...args].join(' '));
}

function publishingRunner(overrides = {}, respond) {
  return fakeRunner((command, args, options, calls) => {
    const response = respond?.(command, args, options, calls);
    if (response) return response;
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

function buildFixture(projectRoot, version) {
  const { runner } = publishingRunner({}, (command, args) => {
    if ([command, ...args].join(' ') === 'pnpm build universal dmg') {
      writeArtifact(projectRoot, version);
    }
  });
  return buildRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });
}

test('build runs local gates before creating and verifying the universal DMG', () => {
  const { projectRoot, version } = fixture();
  try {
    const { calls, runner } = publishingRunner({}, (command, args) => {
      if ([command, ...args].join(' ') === 'pnpm build universal dmg') {
        writeArtifact(projectRoot, version);
      }
    });

    const artifact = buildRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });

    assert.equal(artifact, releaseDmgPath(projectRoot, version));
    assert.ok(fs.existsSync(`${artifact}.build.json`));
    assert.deepEqual(commandList(calls), [
      'git status --porcelain',
      'git rev-parse HEAD',
      'pnpm sync-version --check',
      'pnpm test',
      'cargo test -- --test-threads=1',
      'pnpm build universal dmg',
      `hdiutil verify ${artifact}`,
      'git status --porcelain',
      'git rev-parse HEAD',
    ]);
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

test('publish reuses the current verified build after local and remote preflight checks', () => {
  const { projectRoot, version } = fixture();
  try {
    const artifact = buildFixture(projectRoot, version);
    const { calls, runner } = publishingRunner();

    publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });

    const commands = commandList(calls);
    assert.deepEqual(commands.slice(0, 7), [
      'pnpm sync-version --check',
      'git status --porcelain',
      'git branch --show-current',
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      'git fetch origin main --tags',
      'git rev-list --left-right --count HEAD...origin/main',
      'git rev-parse HEAD',
    ]);
    assert.ok(commands.includes(`hdiutil verify ${artifact}`));
    assert.ok(!commands.includes('pnpm build universal dmg'));
    assert.ok(!commands.includes('pnpm test'));
    assert.ok(!commands.includes('cargo test -- --test-threads=1'));
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

const rebuildCases = {
  'missing DMG': (artifact) => fs.unlinkSync(artifact),
  'missing build record': (artifact) => fs.rmSync(`${artifact}.build.json`, { force: true }),
  'malformed build record': (artifact) => fs.writeFileSync(`${artifact}.build.json`, '{invalid'),
  'null build record': (artifact) => fs.writeFileSync(`${artifact}.build.json`, 'null'),
  'outdated commit': (artifact) => {
    const record = JSON.parse(fs.readFileSync(`${artifact}.build.json`, 'utf8'));
    record.commit = 'previous-commit';
    fs.writeFileSync(`${artifact}.build.json`, JSON.stringify(record));
  },
  'outdated version': (artifact) => {
    const record = JSON.parse(fs.readFileSync(`${artifact}.build.json`, 'utf8'));
    record.version = '0.260905.0';
    fs.writeFileSync(`${artifact}.build.json`, JSON.stringify(record));
  },
  'modified DMG': (artifact) => fs.appendFileSync(artifact, 'modified'),
};

for (const [reason, invalidate] of Object.entries(rebuildCases)) {
  test(`publish builds before releasing when there is a ${reason}`, () => {
    const { projectRoot, version } = fixture();
    try {
      const artifact = buildFixture(projectRoot, version);
      invalidate(artifact);
      const { calls, runner } = publishingRunner({}, (command, args) => {
        if ([command, ...args].join(' ') === 'pnpm build universal dmg') {
          writeArtifact(projectRoot, version);
        }
      });

      publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });

      const commands = commandList(calls);
      const buildIndex = commands.indexOf('pnpm build universal dmg');
      const publishIndex = commands.findIndex((command) => command.startsWith('gh release create '));
      assert.ok(buildIndex > commands.indexOf('gh auth status --hostname github.com'));
      assert.ok(commands.indexOf('pnpm test') < buildIndex);
      assert.ok(commands.includes('pnpm test'));
      assert.ok(commands.indexOf('cargo test -- --test-threads=1') < buildIndex);
      assert.ok(commands.includes('cargo test -- --test-threads=1'));
      assert.ok(publishIndex > commands.indexOf(`hdiutil verify ${artifact}`));
      assert.ok(publishIndex > buildIndex);

      const next = publishingRunner();
      publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner: next.runner });
      assert.ok(!commandList(next.calls).includes('pnpm build universal dmg'));
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true });
    }
  });
}

test('publish builds and releases from a checkout without any prior artifacts', () => {
  const { projectRoot, version } = fixture();
  try {
    const { calls, runner } = publishingRunner({}, (command, args) => {
      if ([command, ...args].join(' ') === 'pnpm build universal dmg') {
        writeArtifact(projectRoot, version);
      }
    });
    publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });
    assert.ok(commandList(calls).includes('pnpm build universal dmg'));
    assert.ok(commandList(calls).some((command) => command.startsWith('gh release create ')));
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

for (const failedCommand of ['pnpm test', 'cargo test -- --test-threads=1', 'pnpm build universal dmg', 'hdiutil verify']) {
  test(`publish stops and invalidates the old build record if ${failedCommand} fails`, () => {
    const { projectRoot, version } = fixture();
    try {
      const artifact = buildFixture(projectRoot, version);
      fs.appendFileSync(artifact, 'modified');
      const { calls, runner } = publishingRunner({}, (command, args) => {
        const full = [command, ...args].join(' ');
        if (full.startsWith(failedCommand)) return { status: 1 };
        if (full === 'pnpm build universal dmg') writeArtifact(projectRoot, version);
      });
      assert.throws(
        () => publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner }),
        /failed/,
      );
      assert.ok(!fs.existsSync(`${artifact}.build.json`));
      assert.ok(!commandList(calls).some((command) => command.startsWith('gh release create ')));
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true });
    }
  });
}

test('build does not mark a dirty checkout as reusable after it becomes clean', () => {
  const { projectRoot, version } = fixture();
  try {
    let built = false;
    const { runner } = publishingRunner({}, (command, args) => {
      const full = [command, ...args].join(' ');
      if (full === 'git status --porcelain') return { stdout: built ? '' : ' M src/App.tsx\n' };
      if (full === 'pnpm build universal dmg') {
        writeArtifact(projectRoot, version);
        built = true;
      }
    });
    const artifact = buildRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner });
    assert.ok(fs.existsSync(artifact));
    assert.ok(!fs.existsSync(`${artifact}.build.json`));
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

for (const change of ['dirty files', 'new commit', 'remote advances']) {
  test(`publish stops if there are ${change} during the build`, () => {
    const { projectRoot, version } = fixture();
    try {
      let built = false;
      const { calls, runner } = publishingRunner({}, (command, args) => {
        const full = [command, ...args].join(' ');
        if (full === 'pnpm build universal dmg') {
          writeArtifact(projectRoot, version);
          built = true;
        }
        if (built && change === 'dirty files' && full === 'git status --porcelain') {
          return { stdout: ' M src/App.tsx\n' };
        }
        if (built && change === 'new commit' && full === 'git rev-parse HEAD') {
          return { stdout: 'new-commit\n' };
        }
        if (built && change === 'remote advances' && full === 'git rev-list --left-right --count HEAD...origin/main') {
          return { stdout: '0\t1\n' };
        }
      });
      assert.throws(
        () => publishRelease({ logger: silentLogger, platform: 'darwin', projectRoot, runner }),
        /working tree must be clean|changed|must exactly match/,
      );
      assert.ok(!commandList(calls).some((command) => command.startsWith('gh release create ')));
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true });
    }
  });
}

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
    assert.ok(!commandList(calls).includes('pnpm build universal dmg'));
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
    assert.ok(!commandList(calls).includes('pnpm build universal dmg'));
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});
