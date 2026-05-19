#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const defaultCargoTargetDir = path.join(projectRoot, 'target', 'tauri-build-and-install');
const targetDirFingerprint = '.markdowner-source-root';

function usage() {
  console.log(`Usage:
  pnpm build
  pnpm build debug
  pnpm build install [open]
  pnpm build debug install [open]

Options:
  debug, --debug       Build the Tauri debug bundle
  release, --release   Build the Tauri release bundle
  install              Install the resulting macOS .app bundle
  open, --open         Open the installed app after installation
  --no-build           Install an already-built bundle
  --path <dir>         Install destination, defaults to /Applications
  -h, --help           Show this help message`);
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error) {
    if (options.allowFailure) {
      return result;
    }
    fail(`error: failed to run '${command}': ${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function requireCommands(commands) {
  for (const command of commands) {
    if (!commandExists(command)) {
      fail(`error: '${command}' is required but not found in PATH`);
    }
  }
}

function parseArgs(argv) {
  const options = {
    doBuild: true,
    install: false,
    installPath: process.env.MARKDOWNER_INSTALL_PATH ?? '/Applications',
    mode: 'release',
    open: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage();
      process.exit(0);
    }

    if (arg === 'debug' || arg === '--debug') {
      options.mode = 'debug';
    } else if (arg === 'release' || arg === '--release') {
      options.mode = 'release';
    } else if (arg === 'install') {
      options.install = true;
    } else if (arg === 'open' || arg === '--open') {
      options.open = true;
      options.install = true;
    } else if (arg === 'no-build' || arg === '--no-build') {
      options.doBuild = false;
      options.install = true;
    } else if (arg === '--path') {
      const value = argv[index + 1];
      if (!value) {
        fail('error: --path requires a directory', 2);
      }
      options.installPath = value;
      index += 1;
    } else if (arg.startsWith('--path=')) {
      options.installPath = arg.slice('--path='.length);
    } else {
      fail(`error: unknown argument: ${arg}`, 2);
    }
  }

  return options;
}

function cargoTargetRoot(env) {
  const cargoTargetDir = env.CARGO_TARGET_DIR;
  if (!cargoTargetDir) {
    return path.join(projectRoot, 'target');
  }
  return path.isAbsolute(cargoTargetDir) ? cargoTargetDir : path.join(projectRoot, cargoTargetDir);
}

// The Tauri build step bakes absolute paths into generated files under
// `<target>/<profile>/build/tauri-*/out/` (notably the `*-permission-files`
// lists). If the project is moved or re-cloned at a different path, those
// cached paths become stale and the next cargo build fails with a missing
// `.toml` under the old location. Detect that and clean automatically so the
// user doesn't have to run `cargo clean` by hand.
function ensureFreshManagedTargetDir(targetDir) {
  if (fs.existsSync(targetDir) && isStaleManagedTargetDir(targetDir)) {
    console.log(`==> Detected stale build cache at ${targetDir}; cleaning`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(targetDir, targetDirFingerprint), projectRoot);
  } catch {
    // Fingerprint is advisory only — never fail the build on a write error.
  }
}

function isStaleManagedTargetDir(targetDir) {
  const fingerprintPath = path.join(targetDir, targetDirFingerprint);
  if (fs.existsSync(fingerprintPath)) {
    try {
      return fs.readFileSync(fingerprintPath, 'utf8').trim() !== projectRoot;
    } catch {
      return true;
    }
  }
  // Legacy cache without a fingerprint — scan the tauri permission lists for
  // absolute paths that don't sit under the current project root.
  return detectStalePermissionPaths(targetDir);
}

function detectStalePermissionPaths(targetDir) {
  const prefix = projectRoot + path.sep;
  for (const variant of ['release', 'debug']) {
    const buildDir = path.join(targetDir, variant, 'build');
    let entries;
    try {
      entries = fs.readdirSync(buildDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith('tauri-')) continue;
      const outDir = path.join(buildDir, entry, 'out');
      let files;
      try {
        files = fs.readdirSync(outDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('-permission-files')) continue;
        let contents;
        try {
          contents = fs.readFileSync(path.join(outDir, file), 'utf8');
        } catch {
          continue;
        }
        const matches = contents.match(/"(\/[^"]+?\.toml)"/g) ?? [];
        for (const raw of matches) {
          if (!raw.slice(1, -1).startsWith(prefix)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function ensureDependencies() {
  requireCommands(['pnpm', 'cargo']);

  if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) {
    console.log('==> Installing JS dependencies (pnpm install)');
    run('pnpm', ['install']);
  }
}

function buildFrontend() {
  run('pnpm', ['exec', 'tsc']);
  run('pnpm', ['exec', 'vite', 'build']);
}

function buildTauri(mode, env = process.env) {
  ensureDependencies();

  if (mode === 'debug') {
    console.log('==> Building Tauri app (debug)');
    run('pnpm', ['tauri', 'build', '--debug'], { env });
  } else {
    console.log('==> Building Tauri app (release)');
    run('pnpm', ['tauri', 'build'], { env });
  }
}

function ensureMacOsInstallTarget() {
  const result = spawnSync('uname', ['-s'], {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0 || result.stdout.trim() !== 'Darwin') {
    fail('error: pnpm build install currently supports macOS only');
  }
}

function canWrite(directory) {
  try {
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function runMaybeSudo(useSudo, command, args, options = {}) {
  if (useSudo) {
    return run('sudo', [command, ...args], options);
  }
  return run(command, args, options);
}

function installBundle(options, env) {
  ensureMacOsInstallTarget();

  const targetRoot = cargoTargetRoot(env);
  const bundleModeDir = options.mode === 'debug' ? 'debug' : 'release';
  const appBundle = path.join(targetRoot, bundleModeDir, 'bundle', 'macos', 'Markdowner.app');

  if (!fs.existsSync(appBundle)) {
    fail(`error: bundle not found: ${appBundle}
       run without --no-build, or build the app first.`);
  }

  const installPath = path.resolve(projectRoot, options.installPath);
  const dest = path.join(installPath, 'Markdowner.app');

  let useSudo = false;
  if (!canWrite(installPath)) {
    if (!commandExists('sudo')) {
      fail(`error: install path '${installPath}' is not writable and sudo is unavailable`);
    }
    console.log(`==> ${installPath} is not writable; using sudo for install`);
    useSudo = true;
  }

  if (fs.existsSync(dest)) {
    console.log(`==> Removing existing bundle at ${dest}`);
    runMaybeSudo(useSudo, 'rm', ['-rf', dest]);
  }

  console.log(`==> Installing to ${dest}`);
  runMaybeSudo(useSudo, 'ditto', [appBundle, dest]);
  runMaybeSudo(useSudo, 'xattr', ['-dr', 'com.apple.quarantine', dest], {
    allowFailure: true,
    stdio: 'ignore',
  });

  console.log(`==> Done. Installed: ${dest}`);

  if (options.open) {
    console.log(`==> Opening ${dest}`);
    run('open', [dest]);
  } else {
    console.log(`    Launch with: open '${dest}'`);
  }
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--');

if (argv.length === 0) {
  buildFrontend();
  process.exit(0);
}

const options = parseArgs(argv);
const env = { ...process.env };

let managedTargetDir = null;
if (options.install && options.doBuild && !env.CARGO_TARGET_DIR) {
  env.CARGO_TARGET_DIR = defaultCargoTargetDir;
  managedTargetDir = defaultCargoTargetDir;
}

if (managedTargetDir && options.doBuild) {
  ensureFreshManagedTargetDir(managedTargetDir);
}

if (options.doBuild) {
  buildTauri(options.mode, env);
}

if (options.install) {
  installBundle(options, env);
}
