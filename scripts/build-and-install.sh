#!/usr/bin/env bash
# Build the Tauri app locally and install the resulting .app bundle into the
# system Applications folder (/Applications).
# Usage:
#   scripts/build-and-install.sh             # release build, install to /Applications
#   scripts/build-and-install.sh --debug     # debug build
#   scripts/build-and-install.sh --no-build  # install an already-built bundle

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

MODE="release"
INSTALL_PATH="/Applications"
DO_BUILD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) MODE="debug"; shift ;;
    --release) MODE="release"; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    -h|--help)
      sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# macOS-only: bundle target in tauri.conf.json is "app" (.app bundle)
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: build-and-install.sh currently supports macOS only" >&2
  exit 1
fi

if [[ "${DO_BUILD}" -eq 1 ]]; then
  for cmd in pnpm cargo; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
      echo "error: '${cmd}' is required but not found in PATH" >&2
      exit 1
    fi
  done

  if [[ ! -d node_modules ]]; then
    echo "==> Installing JS dependencies (pnpm install)"
    pnpm install
  fi

  if [[ "${MODE}" == "debug" ]]; then
    echo "==> Building Tauri app (debug)"
    pnpm tauri build --debug
  else
    echo "==> Building Tauri app (release)"
    pnpm tauri build
  fi
fi

# Resolve source bundle
if [[ "${MODE}" == "debug" ]]; then
  APP_BUNDLE="${PROJECT_ROOT}/target/debug/bundle/macos/Markdowner.app"
else
  APP_BUNDLE="${PROJECT_ROOT}/target/release/bundle/macos/Markdowner.app"
fi

if [[ ! -d "${APP_BUNDLE}" ]]; then
  echo "error: bundle not found: ${APP_BUNDLE}" >&2
  echo "       run without --no-build, or build the app first." >&2
  exit 1
fi

DEST="${INSTALL_PATH%/}/Markdowner.app"

# Determine whether destination needs sudo (/Applications is root-owned).
SUDO=""
if [[ ! -w "${INSTALL_PATH}" ]]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "==> ${INSTALL_PATH} is not writable; using sudo for install"
    SUDO="sudo"
  else
    echo "error: install path '${INSTALL_PATH}' is not writable and sudo is unavailable" >&2
    exit 1
  fi
fi

if [[ -d "${DEST}" ]]; then
  echo "==> Removing existing bundle at ${DEST}"
  ${SUDO} rm -rf "${DEST}"
fi

echo "==> Installing to ${DEST}"
${SUDO} ditto "${APP_BUNDLE}" "${DEST}"

# Clear quarantine attribute so locally built apps launch without Gatekeeper prompt
${SUDO} xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true

echo "==> Done. Installed: ${DEST}"
echo "    Launch with: open '${DEST}'"
