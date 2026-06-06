#!/usr/bin/env node
// Propagate the repo-root VERSION file into the tooling files that actually
// consume a version string: package.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml, and the workspace Cargo.lock. VERSION is the source of
// truth; this script keeps the others in sync.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const versionFile = path.join(projectRoot, 'VERSION');
const packageJsonFile = path.join(projectRoot, 'package.json');
const tauriConfFile = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlFile = path.join(projectRoot, 'src-tauri', 'Cargo.toml');
const cargoLockFile = path.join(projectRoot, 'Cargo.lock');

const semverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readVersion() {
  let raw;
  try {
    raw = fs.readFileSync(versionFile, 'utf8');
  } catch (err) {
    throw new Error(`failed to read ${path.relative(projectRoot, versionFile)}: ${err.message}`);
  }
  const version = raw.trim();
  if (!semverRe.test(version)) {
    throw new Error(
      `invalid version "${version}" in ${path.relative(projectRoot, versionFile)} — expected MAJOR.MINOR.PATCH[-prerelease]`,
    );
  }
  return version;
}

function readJsonVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function writeJsonVersion(file, version) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const previous = data.version;
  if (previous === version) return { file, changed: false, current: previous };
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return { file, changed: true, previous, current: version };
}

// Read the version from the [package] table of a Cargo.toml.
function readCargoVersion(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inPackage = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const m = line.match(/^\s*version\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

// Replace the first `version = "..."` line inside the [package] table of a
// Cargo.toml without touching dependency version specifiers.
function writeCargoVersion(file, version) {
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  const versionLineRe = /^(\s*version\s*=\s*")([^"]*)(".*)$/;
  let inPackage = false;
  let replaced = false;
  let previous = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const m = line.match(versionLineRe);
    if (m) {
      previous = m[2];
      if (previous === version) {
        return { file, changed: false, current: previous };
      }
      lines[i] = `${m[1]}${version}${m[3]}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    throw new Error(
      `could not find a [package] version line in ${path.relative(projectRoot, file)}`,
    );
  }

  fs.writeFileSync(file, lines.join('\n'));
  return { file, changed: true, previous, current: version };
}

// Read the [package] name from a Cargo.toml — the app crate whose version we
// track in Cargo.lock.
function readCargoPackageName(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inPackage = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const m = line.match(/^\s*name\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  throw new Error(`could not find a [package] name in ${path.relative(projectRoot, file)}`);
}

// Read the locked version of `packageName`. Returns null when the lockfile is
// absent (e.g. a stripped-down build/test fixture) or has no such entry.
function readCargoLockVersion(file, packageName) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== `name = "${packageName}"`) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('[[package]]')) break;
      const m = lines[j].match(/^\s*version\s*=\s*"([^"]*)"/);
      if (m) return m[1];
    }
  }
  return null;
}

// Replace the version of `packageName`'s entry in the workspace Cargo.lock.
// No-ops (skipped) when the lockfile is absent so callers that only sync the
// manifest files keep working.
function writeCargoLockVersion(file, packageName, version) {
  if (!fs.existsSync(file)) return { file, changed: false, skipped: true };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const versionLineRe = /^(\s*version\s*=\s*")([^"]*)(".*)$/;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== `name = "${packageName}"`) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('[[package]]')) break;
      const m = lines[j].match(versionLineRe);
      if (m) {
        const previous = m[2];
        if (previous === version) return { file, changed: false, current: previous };
        lines[j] = `${m[1]}${version}${m[3]}`;
        fs.writeFileSync(file, lines.join('\n'));
        return { file, changed: true, previous, current: version };
      }
    }
  }
  throw new Error(
    `could not find a Cargo.lock entry for package "${packageName}" in ${path.relative(projectRoot, file)}`,
  );
}

function describe(result) {
  const rel = path.relative(projectRoot, result.file);
  return `  ${rel}: ${result.previous} -> ${result.current}`;
}

export function syncVersion({ check = false } = {}) {
  const version = readVersion();
  const packageName = readCargoPackageName(cargoTomlFile);

  if (check) {
    const current = [
      { file: packageJsonFile, current: readJsonVersion(packageJsonFile) },
      { file: tauriConfFile, current: readJsonVersion(tauriConfFile) },
      { file: cargoTomlFile, current: readCargoVersion(cargoTomlFile) },
    ];
    const lockVersion = readCargoLockVersion(cargoLockFile, packageName);
    if (lockVersion !== null) current.push({ file: cargoLockFile, current: lockVersion });
    const mismatched = current.filter((c) => c.current !== version);
    if (mismatched.length > 0) {
      const lines = mismatched.map(
        (c) => `  ${path.relative(projectRoot, c.file)}: ${c.current} (expected ${version})`,
      );
      throw new Error(`version mismatch — VERSION says ${version}:\n${lines.join('\n')}`);
    }
    return { version, results: current };
  }

  const results = [
    writeJsonVersion(packageJsonFile, version),
    writeJsonVersion(tauriConfFile, version),
    writeCargoVersion(cargoTomlFile, version),
    writeCargoLockVersion(cargoLockFile, packageName, version),
  ];

  const changed = results.filter((r) => r.changed);
  if (changed.length > 0) {
    console.log(`Synced VERSION ${version} into:`);
    for (const r of changed) console.log(describe(r));
  }
  return { version, results };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  try {
    syncVersion({ check });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
