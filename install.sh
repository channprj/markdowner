#!/usr/bin/env bash
# Markdowner installer for macOS.
#
# Usage:
#   curl -fsSL https://<your-host>/install.sh | bash
#
# Environment overrides:
#   MARKDOWNER_VERSION       Release tag to install (e.g. v0.1.0). Default: latest
#   MARKDOWNER_INSTALL_PATH  Destination directory.                 Default: /Applications
#   MARKDOWNER_REPO          owner/name on GitHub.                  Default: channprj/markdowner
#   MARKDOWNER_OPEN          1 to launch the app after install.     Default: unset

set -euo pipefail

REPO="${MARKDOWNER_REPO:-channprj/markdowner}"
INSTALL_PATH="${MARKDOWNER_INSTALL_PATH:-/Applications}"
INSTALL_PATH="${INSTALL_PATH/#\~/$HOME}"
VERSION="${MARKDOWNER_VERSION:-latest}"
APP_NAME="Markdowner.app"

if [ -t 2 ]; then
  c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_reset=$'\033[0m'
else
  c_blue=''; c_green=''; c_yellow=''; c_red=''; c_reset=''
fi

info() { printf '%s==>%s %s\n' "$c_blue"  "$c_reset" "$*" >&2; }
ok()   { printf '%s==>%s %s\n' "$c_green" "$c_reset" "$*" >&2; }
warn() { printf '%swarn:%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "Markdowner currently supports macOS only."
for cmd in curl hdiutil ditto xattr awk grep sed mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but was not found in PATH."
done

case "$(uname -m)" in
  arm64)  ARCH_TAGS=("aarch64" "universal") ;;
  x86_64) ARCH_TAGS=("x64" "universal") ;;
  *)      die "Unsupported architecture: $(uname -m)" ;;
esac

if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

info "Fetching release info from ${API_URL}"
RELEASE_JSON="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: markdowner-installer' \
  "$API_URL")" \
  || die "Failed to fetch release info. Check your network or MARKDOWNER_VERSION."

TAG="$(printf '%s' "$RELEASE_JSON" \
  | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | head -1 \
  | sed -E 's/.*"([^"]+)"$/\1/')"
[ -n "$TAG" ] || die "Could not determine release tag from GitHub response."

DOWNLOAD_URL=""
MATCHED_ARCH=""
ALL_DMG_URLS="$(printf '%s' "$RELEASE_JSON" \
  | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+\.dmg"' \
  | sed -E 's/.*"([^"]+)"$/\1/')"

for tag in "${ARCH_TAGS[@]}"; do
  url="$(printf '%s\n' "$ALL_DMG_URLS" | grep -iE "_${tag}\\.dmg$" | head -1 || true)"
  if [ -n "$url" ]; then
    DOWNLOAD_URL="$url"
    MATCHED_ARCH="$tag"
    break
  fi
done

if [ -z "$DOWNLOAD_URL" ]; then
  die "No matching .dmg asset found in release ${TAG}. Tried: ${ARCH_TAGS[*]}"
fi

info "Release: ${TAG}"
info "Asset:   ${DOWNLOAD_URL##*/} (${MATCHED_ARCH})"

WORK_DIR="$(mktemp -d -t markdowner-install)"
MOUNT_POINT=""
# Scratch paths for the atomic install swap (assigned just before the swap).
# Tracked here so the EXIT trap can restore/clean them if the script aborts.
DEST_APP=""
STAGED_APP=""
BACKUP_APP=""

cleanup() {
  # If an aborted swap left the destination missing, put the backup back so the
  # user is never left without an installed app.
  if [ -n "$BACKUP_APP" ] && [ -n "$DEST_APP" ] && [ ! -e "$DEST_APP" ] && [ -e "$BACKUP_APP" ]; then
    ${SUDO:-} mv "$BACKUP_APP" "$DEST_APP" 2>/dev/null || true
  fi
  [ -n "$STAGED_APP" ] && ${SUDO:-} rm -rf "$STAGED_APP" 2>/dev/null || true
  if [ -n "$BACKUP_APP" ] && { [ -z "$DEST_APP" ] || [ -e "$DEST_APP" ]; }; then
    ${SUDO:-} rm -rf "$BACKUP_APP" 2>/dev/null || true
  fi
  if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 \
      || hdiutil detach "$MOUNT_POINT" -force -quiet >/dev/null 2>&1 \
      || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

DMG_PATH="${WORK_DIR}/$(basename "$DOWNLOAD_URL")"
info "Downloading"
curl -fL --progress-bar -o "$DMG_PATH" "$DOWNLOAD_URL" \
  || die "Download failed: $DOWNLOAD_URL"

info "Mounting DMG"
MOUNT_OUT="$(hdiutil attach "$DMG_PATH" -nobrowse -readonly -noverify)" \
  || die "Failed to mount DMG."
MOUNT_POINT="$(printf '%s\n' "$MOUNT_OUT" \
  | awk -F'\t' '$NF ~ "^/Volumes/" {print $NF}' \
  | tail -n1)"
[ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ] \
  || die "Could not determine DMG mount point."

SRC_APP="${MOUNT_POINT}/${APP_NAME}"
[ -d "$SRC_APP" ] || die "${APP_NAME} not found inside the DMG."

DEST_APP="${INSTALL_PATH%/}/${APP_NAME}"
SUDO=""
if [ ! -d "$INSTALL_PATH" ]; then
  die "Install path does not exist: ${INSTALL_PATH}"
fi
if [ ! -w "$INSTALL_PATH" ]; then
  command -v sudo >/dev/null 2>&1 \
    || die "${INSTALL_PATH} is not writable and sudo is not available."
  info "${INSTALL_PATH} is not writable; sudo will be used."
  SUDO="sudo"
fi

STAGED_APP="${DEST_APP}.markdowner-staged"
BACKUP_APP="${DEST_APP}.markdowner-backup"
$SUDO rm -rf "$STAGED_APP" "$BACKUP_APP" 2>/dev/null || true

info "Installing to ${DEST_APP}"
# Stage the new bundle next to the destination, then swap it in with atomic
# renames. The existing install is never removed before the staged copy is in
# place, so a failed copy can never leave the user with no app.
$SUDO ditto "$SRC_APP" "$STAGED_APP"
$SUDO xattr -dr com.apple.quarantine "$STAGED_APP" >/dev/null 2>&1 || true
if [ -e "$DEST_APP" ]; then
  $SUDO mv "$DEST_APP" "$BACKUP_APP"
fi
if ! $SUDO mv "$STAGED_APP" "$DEST_APP"; then
  [ -e "$BACKUP_APP" ] && $SUDO mv "$BACKUP_APP" "$DEST_APP"
  die "Failed to move the new bundle into place."
fi
$SUDO rm -rf "$BACKUP_APP" 2>/dev/null || true

ok "Installed Markdowner ${TAG}"
printf '    Launch with: open "%s"\n' "$DEST_APP" >&2

if [ "${MARKDOWNER_OPEN:-}" = "1" ]; then
  info "Launching"
  open "$DEST_APP"
fi
