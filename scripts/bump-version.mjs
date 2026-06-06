#!/usr/bin/env node
// Bump the repo-root VERSION file using the project's date-based scheme
// (MAJOR.YYMMDD.PATCH) and propagate it into package.json / tauri.conf.json /
// Cargo.toml / Cargo.lock via syncVersion(). By default this only touches
// files; pass --push to also commit those files and push to main, which
// triggers the release workflow (.github/workflows/release.yml).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { syncVersion } from './sync-version.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const versionFile = path.join(projectRoot, 'VERSION');

const versionRe = /^(\d+)\.(\d+)\.(\d+)$/;

function usage() {
  console.log(`Usage:
  pnpm bump refresh          Set the date to today; patch resets to 0 on a new
                             day, otherwise increments (e.g. 0.260528.2 -> 0.260606.0)
  pnpm bump major            Bump the major number; date becomes today, patch
                             resets to 0 (e.g. 0.260606.1 -> 1.260606.0)

Options:
  --push                     After bumping, commit the version files and push to
                             main (must be on main). This triggers the release
                             workflow, which builds the DMG and creates the
                             v<version> tag + GitHub release.`);
}

// YYMMDD for the local date.
function todayStamp(date = new Date()) {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Pure: derive the next version string from the current one.
function nextVersion(current, command, today = todayStamp()) {
  const m = current.match(versionRe);
  if (!m) {
    throw new Error(`invalid VERSION "${current}" — expected MAJOR.YYMMDD.PATCH`);
  }
  const major = Number(m[1]);
  const date = m[2];
  const patch = Number(m[3]);

  switch (command) {
    case 'refresh':
      return date === today ? `${major}.${date}.${patch + 1}` : `${major}.${today}.0`;
    case 'major':
      return `${major + 1}.${today}.0`;
    default:
      throw new Error(`unknown command "${command}" — expected "refresh" or "major"`);
  }
}

// Files the version system owns; committed together so a release commit is
// self-contained (release.yml triggers on a VERSION change pushed to main).
const versionedFiles = [
  'VERSION',
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'Cargo.lock',
];

function git(args, { capture = false } = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim();
}

function bumpVersion(command, { push = false } = {}) {
  // Fail fast before touching files if --push can't proceed from here.
  if (push) {
    const branch = currentBranch();
    if (branch !== 'main') {
      throw new Error(`--push requires the "main" branch (release.yml triggers on main); on "${branch}"`);
    }
  }

  const current = fs.readFileSync(versionFile, 'utf8').trim();
  const next = nextVersion(current, command);
  fs.writeFileSync(versionFile, `${next}\n`);
  console.log(`VERSION ${current} -> ${next}`);
  syncVersion();

  if (push) {
    git(['commit', '-m', `chore(release): bump version to ${next}`, '--', ...versionedFiles]);
    git(['push', 'origin', 'main']);
    console.log(`Pushed v${next} to main — the release workflow will build and publish it.`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(0);
  }
  const push = args.includes('--push');
  const command = args.find((arg) => !arg.startsWith('-'));
  if (!command) {
    usage();
    process.exit(1);
  }
  try {
    bumpVersion(command, { push });
  } catch (err) {
    console.error(`error: ${err.message}`);
    usage();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
