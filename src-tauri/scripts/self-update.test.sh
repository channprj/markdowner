#!/usr/bin/env bash
# Behavioural tests for scripts/self-update.sh, the in-app self-updater.
#
# External commands are stubbed onto PATH so the tests are hermetic: hdiutil
# fakes a mounted DMG, open/osascript are recorded, and ditto can be forced to
# fail. The headline guarantee under test: a failed update never destroys the
# installed bundle.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_UPDATE="${SCRIPT_DIR}/self-update.sh"

PASS=0
FAIL=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  FAIL=$((FAIL + 1))
}

pass() {
  PASS=$((PASS + 1))
}

write_stub() {
  local path="$1"
  local body="$2"
  printf '%s\n' "$body" >"$path"
  chmod +x "$path"
}

# A PID that is guaranteed dead, so self-update.sh's wait loop exits at once.
dead_pid() {
  ( exit 0 ) &
  local p=$!
  wait "$p" 2>/dev/null || true
  printf '%s' "$p"
}

# hdiutil stub that mounts a fake DMG containing a fresh Markdowner.app marked
# "NEW". Honours `attach ... -mountpoint <dir>` and `detach`.
HDIUTIL_WITH_APP='#!/usr/bin/env bash
if [ "$1" = "attach" ]; then
  mp=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then mp="$2"; shift 2; continue; fi
    shift
  done
  if [ -n "$mp" ]; then
    mkdir -p "$mp/Markdowner.app/Contents"
    printf "NEW" >"$mp/Markdowner.app/Contents/marker.txt"
  fi
  exit 0
fi
exit 0'

# hdiutil stub that mounts an empty volume (DMG without a Markdowner.app).
HDIUTIL_EMPTY='#!/usr/bin/env bash
if [ "$1" = "attach" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then shift 2; continue; fi
    shift
  done
fi
exit 0'

make_common_stubs() {
  local bin="$1"
  write_stub "${bin}/open" '#!/usr/bin/env bash
printf "open %s\n" "$1" >>"${COMMAND_LOG}"'
  write_stub "${bin}/osascript" '#!/usr/bin/env bash
printf "osascript\n" >>"${COMMAND_LOG}"'
}

setup_dest() {
  local dest="$1"
  mkdir -p "${dest}/Contents"
  printf 'OLD' >"${dest}/Contents/marker.txt"
}

marker() {
  cat "$1/Contents/marker.txt" 2>/dev/null || printf 'MISSING'
}

run_self_update() {
  # Usage: run_self_update <bin_dir> <dmg> <dest>
  local bin="$1" dmg="$2" dest="$3"
  PATH="${bin}:/usr/bin:/bin" COMMAND_LOG="${COMMAND_LOG}" \
    bash "${SELF_UPDATE}" "$(dead_pid)" "${dmg}" "${dest}"
}

# --- Test 1: a successful update replaces the bundle ------------------------
test_successful_update_replaces_bundle() {
  local tmp; tmp="$(mktemp -d)"
  local bin="${tmp}/bin"; mkdir -p "${bin}"
  export COMMAND_LOG="${tmp}/log"; : >"${COMMAND_LOG}"
  make_common_stubs "${bin}"
  write_stub "${bin}/hdiutil" "${HDIUTIL_WITH_APP}"

  local dest="${tmp}/Markdowner.app"
  setup_dest "${dest}"
  local dmg="${tmp}/update.dmg"; : >"${dmg}"

  run_self_update "${bin}" "${dmg}" "${dest}"
  local rc=$?

  local ok=1
  [ "$rc" -eq 0 ] || { fail "successful update: expected exit 0, got ${rc}"; ok=0; }
  [ "$(marker "${dest}")" = "NEW" ] || { fail "successful update: bundle not replaced (marker=$(marker "${dest}"))"; ok=0; }
  [ ! -e "${dest}.markdowner-staged" ] || { fail "successful update: staged copy left behind"; ok=0; }
  [ ! -e "${dest}.markdowner-backup" ] || { fail "successful update: backup left behind"; ok=0; }
  [ ! -f "${dmg}" ] || { fail "successful update: DMG not cleaned up"; ok=0; }
  grep -Fq "open ${dest}" "${COMMAND_LOG}" || { fail "successful update: app not relaunched"; ok=0; }
  [ "$ok" -eq 1 ] && pass
  rm -rf "${tmp}"
}

# --- Test 2: a failed copy preserves the existing bundle (regression) -------
test_failed_copy_preserves_existing_bundle() {
  local tmp; tmp="$(mktemp -d)"
  local bin="${tmp}/bin"; mkdir -p "${bin}"
  export COMMAND_LOG="${tmp}/log"; : >"${COMMAND_LOG}"
  make_common_stubs "${bin}"
  write_stub "${bin}/hdiutil" "${HDIUTIL_WITH_APP}"
  # Force the copy to fail, simulating a corrupt/truncated DMG or a full disk.
  write_stub "${bin}/ditto" '#!/usr/bin/env bash
exit 1'

  local dest="${tmp}/Markdowner.app"
  setup_dest "${dest}"
  local dmg="${tmp}/update.dmg"; : >"${dmg}"

  run_self_update "${bin}" "${dmg}" "${dest}"
  local rc=$?

  local ok=1
  [ "$rc" -eq 1 ] || { fail "failed copy: expected exit 1, got ${rc}"; ok=0; }
  [ -d "${dest}" ] || { fail "failed copy: DEST WAS DELETED — the bug under test"; ok=0; }
  [ "$(marker "${dest}")" = "OLD" ] || { fail "failed copy: existing bundle not preserved (marker=$(marker "${dest}"))"; ok=0; }
  [ ! -e "${dest}.markdowner-staged" ] || { fail "failed copy: staged copy left behind"; ok=0; }
  [ ! -e "${dest}.markdowner-backup" ] || { fail "failed copy: backup left behind"; ok=0; }
  grep -Fq "open ${dest}" "${COMMAND_LOG}" || { fail "failed copy: surviving app not relaunched"; ok=0; }
  grep -Fq "osascript" "${COMMAND_LOG}" || { fail "failed copy: user not notified"; ok=0; }
  [ "$ok" -eq 1 ] && pass
  rm -rf "${tmp}"
}

# --- Test 3: a DMG without Markdowner.app preserves the bundle --------------
test_missing_app_preserves_existing_bundle() {
  local tmp; tmp="$(mktemp -d)"
  local bin="${tmp}/bin"; mkdir -p "${bin}"
  export COMMAND_LOG="${tmp}/log"; : >"${COMMAND_LOG}"
  make_common_stubs "${bin}"
  write_stub "${bin}/hdiutil" "${HDIUTIL_EMPTY}"

  local dest="${tmp}/Markdowner.app"
  setup_dest "${dest}"
  local dmg="${tmp}/update.dmg"; : >"${dmg}"

  run_self_update "${bin}" "${dmg}" "${dest}"
  local rc=$?

  local ok=1
  [ "$rc" -eq 1 ] || { fail "missing app: expected exit 1, got ${rc}"; ok=0; }
  [ "$(marker "${dest}")" = "OLD" ] || { fail "missing app: existing bundle not preserved (marker=$(marker "${dest}"))"; ok=0; }
  [ ! -e "${dest}.markdowner-staged" ] || { fail "missing app: staged copy left behind"; ok=0; }
  [ "$ok" -eq 1 ] && pass
  rm -rf "${tmp}"
}

# --- Test 4: final swap failure restores the parked old bundle --------------
test_failed_final_swap_restores_existing_bundle() {
  local tmp; tmp="$(mktemp -d)"
  local bin="${tmp}/bin"; mkdir -p "${bin}"
  export COMMAND_LOG="${tmp}/log"; : >"${COMMAND_LOG}"
  make_common_stubs "${bin}"
  write_stub "${bin}/hdiutil" "${HDIUTIL_WITH_APP}"
  write_stub "${bin}/mv" '#!/usr/bin/env bash
printf "mv %s %s\n" "$1" "$2" >>"${COMMAND_LOG}"
if [[ "$1" == *.markdowner-staged && "$2" == *.app ]]; then
  exit 1
fi
/bin/mv "$@"'

  local dest="${tmp}/Markdowner.app"
  setup_dest "${dest}"
  local dmg="${tmp}/update.dmg"; : >"${dmg}"

  run_self_update "${bin}" "${dmg}" "${dest}"
  local rc=$?

  local ok=1
  [ "$rc" -eq 1 ] || { fail "failed final swap: expected exit 1, got ${rc}"; ok=0; }
  [ "$(marker "${dest}")" = "OLD" ] || { fail "failed final swap: old bundle not restored (marker=$(marker "${dest}"))"; ok=0; }
  [ ! -e "${dest}.markdowner-staged" ] || { fail "failed final swap: staged copy left behind"; ok=0; }
  [ ! -e "${dest}.markdowner-backup" ] || { fail "failed final swap: backup left behind after successful restore"; ok=0; }
  grep -Fq "open ${dest}" "${COMMAND_LOG}" || { fail "failed final swap: restored app not relaunched"; ok=0; }
  grep -Fq "osascript" "${COMMAND_LOG}" || { fail "failed final swap: user not notified"; ok=0; }
  [ "$ok" -eq 1 ] && pass
  rm -rf "${tmp}"
}

# --- Test 5: if backup restore itself fails, keep the backup ----------------
test_failed_restore_keeps_backup_bundle() {
  local tmp; tmp="$(mktemp -d)"
  local bin="${tmp}/bin"; mkdir -p "${bin}"
  export COMMAND_LOG="${tmp}/log"; : >"${COMMAND_LOG}"
  make_common_stubs "${bin}"
  write_stub "${bin}/hdiutil" "${HDIUTIL_WITH_APP}"
  write_stub "${bin}/mv" '#!/usr/bin/env bash
printf "mv %s %s\n" "$1" "$2" >>"${COMMAND_LOG}"
if [[ "$1" == *.markdowner-staged && "$2" == *.app ]]; then
  exit 1
fi
if [[ "$1" == *.markdowner-backup && "$2" == *.app ]]; then
  exit 1
fi
/bin/mv "$@"'

  local dest="${tmp}/Markdowner.app"
  setup_dest "${dest}"
  local dmg="${tmp}/update.dmg"; : >"${dmg}"

  run_self_update "${bin}" "${dmg}" "${dest}"
  local rc=$?

  local ok=1
  [ "$rc" -eq 1 ] || { fail "failed restore: expected exit 1, got ${rc}"; ok=0; }
  [ ! -d "${dest}" ] || { fail "failed restore: destination unexpectedly exists"; ok=0; }
  [ "$(marker "${dest}.markdowner-backup")" = "OLD" ] || { fail "failed restore: backup was not preserved (marker=$(marker "${dest}.markdowner-backup"))"; ok=0; }
  [ ! -e "${dest}.markdowner-staged" ] || { fail "failed restore: staged copy left behind"; ok=0; }
  grep -Fq "open ${dmg}" "${COMMAND_LOG}" || { fail "failed restore: DMG was not opened for manual recovery"; ok=0; }
  grep -Fq "osascript" "${COMMAND_LOG}" || { fail "failed restore: user not notified"; ok=0; }
  [ "$ok" -eq 1 ] && pass
  rm -rf "${tmp}"
}

test_successful_update_replaces_bundle
test_failed_copy_preserves_existing_bundle
test_missing_app_preserves_existing_bundle
test_failed_final_swap_restores_existing_bundle
test_failed_restore_keeps_backup_bundle

printf '\nself-update.sh: %d passed, %d failed\n' "${PASS}" "${FAIL}"
[ "${FAIL}" -eq 0 ]
