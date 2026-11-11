#!/usr/bin/env node
// Build the Finder Quick Look appex and leave it where tauri.conf.json copies
// it into Markdowner.app/Contents/PlugIns during bundling.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourceFile = path.join(projectRoot, 'src-tauri', 'quicklook', 'MarkdownerQuickLook.m');
const entitlementsFile = path.join(projectRoot, 'src-tauri', 'quicklook', 'entitlements.plist');
const appexDir = path.join(projectRoot, 'src-tauri', 'quicklook', 'build', 'MarkdownerQuickLook.appex');
const versionFile = path.join(projectRoot, 'VERSION');

export function quicklookPlan(env, platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin') return null;
  const triple = env.TAURI_ENV_TARGET_TRIPLE || hostTriple(arch);
  if (!triple.endsWith('apple-darwin')) return null;
  const triples = triple === 'universal-apple-darwin'
    ? ['aarch64-apple-darwin', 'x86_64-apple-darwin']
    : [triple];
  return {
    profile: env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release',
    triples,
  };
}

export function appexInfoPlist(version) {
  const safeVersion = String(version).replace(/[&<>]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Markdowner Quick Look</string>
  <key>CFBundleExecutable</key>
  <string>MarkdownerQuickLook</string>
  <key>CFBundleIdentifier</key>
  <string>dev.chann.markdowner.quicklook</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>MarkdownerQuickLook</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>${safeVersion}</string>
  <key>CFBundleSupportedPlatforms</key>
  <array>
    <string>MacOSX</string>
  </array>
  <key>CFBundleVersion</key>
  <string>${safeVersion}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>QLIsDataBasedPreview</key>
      <true/>
      <key>QLSupportedContentTypes</key>
      <array>
        <string>net.daringfireball.markdown</string>
      </array>
      <key>QLSupportsSearchableItems</key>
      <false/>
    </dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.quicklook.preview</string>
    <key>NSExtensionPrincipalClass</key>
    <string>MarkdownerQuickLook</string>
  </dict>
</dict>
</plist>
`;
}

function hostTriple(arch) {
  const rustArch = arch === 'arm64' ? 'aarch64' : arch;
  return `${rustArch}-apple-darwin`;
}

function clangArch(triple) {
  if (triple.startsWith('aarch64-')) return 'arm64';
  if (triple.startsWith('x86_64-')) return 'x86_64';
  throw new Error(`unsupported Quick Look target: ${triple}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    fail(`error: failed to run '${command}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function targetRoot(env) {
  const configured = env.CARGO_TARGET_DIR;
  if (!configured) return path.join(projectRoot, 'target');
  return path.isAbsolute(configured) ? configured : path.join(projectRoot, configured);
}

function buildStaticlib(triple, profile, root, env) {
  const args = ['build', '-p', 'markdowner-quicklook', '--target', triple];
  if (profile === 'release') args.push('--release');
  run('cargo', args, {
    ...env,
    CARGO_TARGET_DIR: root,
    MACOSX_DEPLOYMENT_TARGET: '13.0',
  });
  const library = path.join(root, triple, profile, 'libmarkdowner_quicklook.a');
  if (!fs.existsSync(library)) {
    fail(`error: Quick Look static library not found: ${library}`);
  }
  return library;
}

function linkExecutable(triple, library, output, env) {
  run('xcrun', [
    'clang',
    '-fobjc-arc',
    '-fapplication-extension',
    '-mmacosx-version-min=13.0',
    '-arch', clangArch(triple),
    '-framework', 'Foundation',
    '-framework', 'QuickLookUI',
    '-framework', 'UniformTypeIdentifiers',
    sourceFile,
    library,
    '-o', output,
  ], {
    ...env,
    MACOSX_DEPLOYMENT_TARGET: '13.0',
  });
}

function main() {
  const plan = quicklookPlan(process.env);
  if (!plan) {
    console.log('==> Skipping Finder Quick Look build on this target');
    return;
  }

  const root = targetRoot(process.env);
  fs.mkdirSync(root, { recursive: true });
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  const workDir = fs.mkdtempSync(path.join(root, 'quicklook-link-'));
  const binaries = plan.triples.map((triple) => {
    console.log(`==> Building Finder Quick Look (${plan.profile}, ${triple})`);
    const library = buildStaticlib(triple, plan.profile, root, process.env);
    const output = path.join(workDir, `MarkdownerQuickLook-${clangArch(triple)}`);
    linkExecutable(triple, library, output, process.env);
    return output;
  });

  const executable = path.join(workDir, 'MarkdownerQuickLook');
  if (binaries.length === 1) {
    fs.copyFileSync(binaries[0], executable);
  } else {
    run('lipo', ['-create', ...binaries, '-output', executable], process.env);
  }
  fs.chmodSync(executable, 0o755);

  fs.rmSync(appexDir, { recursive: true, force: true });
  const macosDir = path.join(appexDir, 'Contents', 'MacOS');
  fs.mkdirSync(macosDir, { recursive: true });
  fs.copyFileSync(executable, path.join(macosDir, 'MarkdownerQuickLook'));
  fs.chmodSync(path.join(macosDir, 'MarkdownerQuickLook'), 0o755);
  fs.writeFileSync(path.join(appexDir, 'Contents', 'Info.plist'), appexInfoPlist(version));
  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(`==> Signing ${path.relative(projectRoot, appexDir)}`);
  run('codesign', [
    '--force',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', entitlementsFile,
    '--timestamp=none',
    appexDir,
  ], process.env);
  console.log(`==> Finder Quick Look extension: ${path.relative(projectRoot, appexDir)}`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
