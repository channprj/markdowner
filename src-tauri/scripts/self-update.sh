#!/bin/bash
# Markdowner in-app self-updater.
#
# The running app spawns this detached and then quits so we can replace the
# bundle it was launched from. Mirrors install.sh.
#
# Positional arguments (never interpolated into the script source, so paths
# with spaces or shell metacharacters are safe):
#   $1  PID of the running app to wait for
#   $2  path to the downloaded .dmg
#   $3  path to the .app bundle to replace (the install destination)
#
# Safety contract: the new bundle is fully staged next to the destination and
# only then swapped into place with atomic renames. The live bundle is never
# removed before a verified replacement exists, so a failed or interrupted
# update can never leave the user with no app — the previous version is always
# left in place or restored.

APP_PID="$1"
DMG="$2"
DEST="$3"

if [ -z "$APP_PID" ] || [ -z "$DMG" ] || [ -z "$DEST" ]; then
  exit 2
fi

STAGED="${DEST}.markdowner-staged"
BACKUP="${DEST}.markdowner-backup"
MOUNT=""

detach_mount() {
  if [ -n "$MOUNT" ]; then
    hdiutil detach "$MOUNT" -quiet 2>/dev/null \
      || hdiutil detach "$MOUNT" -force -quiet 2>/dev/null \
      || true
    rmdir "$MOUNT" 2>/dev/null || true
    MOUNT=""
  fi
}

# Abort path: restore the previous bundle if the swap had already moved it
# aside, clean up scratch files, warn the user, and relaunch whatever working
# bundle survived (falling back to the DMG for a manual install).
fail() {
  if [ ! -d "$DEST" ] && [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$DEST" 2>/dev/null || true
  fi
  rm -rf "$STAGED" 2>/dev/null || true
  [ -d "$DEST" ] && rm -rf "$BACKUP" 2>/dev/null || true
  detach_mount
  osascript -e 'display notification "Update failed — your existing version was kept." with title "Markdowner"' 2>/dev/null || true
  if [ -d "$DEST" ]; then
    open "$DEST" 2>/dev/null || true
  else
    open "$DMG" 2>/dev/null || true
  fi
  exit 1
}

# Wait for the running app to quit so we can replace its bundle.
while kill -0 "$APP_PID" 2>/dev/null; do sleep 0.2; done

# Recover from a previously interrupted run before discarding scratch state: if
# an earlier swap was cut short (destination gone, backup parked beside it),
# restore the backup rather than deleting the only surviving copy.
if [ ! -d "$DEST" ] && [ -d "$BACKUP" ]; then
  mv "$BACKUP" "$DEST" 2>/dev/null || true
fi
rm -rf "$STAGED" 2>/dev/null || true
[ -d "$DEST" ] && rm -rf "$BACKUP" 2>/dev/null || true

# Mount at a private mountpoint so we never have to guess among /Volumes entries.
MOUNT="$(mktemp -d -t markdowner-update-mnt)" || fail
if ! hdiutil attach "$DMG" -nobrowse -readonly -noverify -mountpoint "$MOUNT" >/dev/null 2>&1; then
  rmdir "$MOUNT" 2>/dev/null || true
  MOUNT=""
  fail
fi
[ -d "$MOUNT/Markdowner.app" ] || fail

# Stage the new bundle next to the destination (same volume => the swap is an
# atomic rename). A failed copy aborts here, before the live bundle is touched.
ditto "$MOUNT/Markdowner.app" "$STAGED" || fail
xattr -dr com.apple.quarantine "$STAGED" 2>/dev/null || true
detach_mount

# Atomic swap: park the old bundle, move the new one in, then drop the backup.
trap fail INT TERM
if [ -d "$DEST" ]; then
  mv "$DEST" "$BACKUP" || fail
fi
mv "$STAGED" "$DEST" || fail
trap - INT TERM
rm -rf "$BACKUP" 2>/dev/null || true
rm -f "$DMG" 2>/dev/null || true

open "$DEST"
