#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_SCRIPT="${PROJECT_ROOT}/scripts/build-and-install.sh"
SOURCE_BUILD_SCRIPT="${PROJECT_ROOT}/scripts/build.mjs"
SOURCE_SYNC_VERSION_SCRIPT="${PROJECT_ROOT}/scripts/sync-version.mjs"
SOURCE_PACKAGE_JSON="${PROJECT_ROOT}/package.json"
SOURCE_RELEASE_WORKFLOW="${PROJECT_ROOT}/.github/workflows/release.yml"
SOURCE_VERSION_FILE="${PROJECT_ROOT}/VERSION"
SOURCE_TAURI_CONF="${PROJECT_ROOT}/src-tauri/tauri.conf.json"
SOURCE_TAURI_CARGO="${PROJECT_ROOT}/src-tauri/Cargo.toml"
REAL_PNPM="$(command -v pnpm || true)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "Expected to find: ${expected}" >&2
    echo "--- ${file} ---" >&2
    sed -n '1,160p' "${file}" >&2
    fail "missing expected output"
  fi
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"

  if grep -Fq -- "${unexpected}" "${file}"; then
    echo "Expected not to find: ${unexpected}" >&2
    echo "--- ${file} ---" >&2
    sed -n '1,160p' "${file}" >&2
    fail "unexpected output"
  fi
}

write_stub() {
  local path="$1"
  local body="$2"

  printf '%s\n' "${body}" >"${path}"
  chmod +x "${path}"
}

copy_build_script_dependencies() {
  local root="$1"

  cp -f "${SOURCE_PACKAGE_JSON}" "${root}/project/package.json"
  cp -f "${SOURCE_BUILD_SCRIPT}" "${root}/project/scripts/build.mjs"
  cp -f "${SOURCE_SYNC_VERSION_SCRIPT}" "${root}/project/scripts/sync-version.mjs"
  cp -f "${SOURCE_VERSION_FILE}" "${root}/project/VERSION"
  mkdir -p "${root}/project/src-tauri"
  cp -f "${SOURCE_TAURI_CONF}" "${root}/project/src-tauri/tauri.conf.json"
  cp -f "${SOURCE_TAURI_CARGO}" "${root}/project/src-tauri/Cargo.toml"
}

make_test_project() {
  local root="$1"

  mkdir -p "${root}/project/scripts"
  cp -f "${SOURCE_SCRIPT}" "${root}/project/scripts/build-and-install.sh"
  copy_build_script_dependencies "${root}"
  chmod +x "${root}/project/scripts/build-and-install.sh"
  mkdir -p "${root}/project/target/release/bundle/macos/Markdowner.app"
}

make_pnpm_test_project() {
  local root="$1"

  mkdir -p "${root}/project/scripts"
  copy_build_script_dependencies "${root}"
  mkdir -p "${root}/project/node_modules"
}

make_stubs() {
  local bin_dir="$1"

  mkdir -p "${bin_dir}"
  write_stub "${bin_dir}/uname" '#!/usr/bin/env bash
echo Darwin'
  write_stub "${bin_dir}/ditto" '#!/usr/bin/env bash
printf "ditto %s %s\n" "$1" "$2" >>"${COMMAND_LOG}"
mkdir -p "$2"'
  write_stub "${bin_dir}/xattr" '#!/usr/bin/env bash
printf "xattr %s\n" "$*" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/open" '#!/usr/bin/env bash
printf "open %s\n" "$1" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/cargo" '#!/usr/bin/env bash
printf "cargo %s\n" "$*" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/rustup" '#!/usr/bin/env bash
if [[ "${1:-}" == "target" && "${2:-}" == "list" && "${3:-}" == "--installed" ]]; then
  printf "aarch64-apple-darwin\nx86_64-apple-darwin\n"
  exit 0
fi
printf "rustup %s\n" "$*" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/pnpm" '#!/usr/bin/env bash
printf "pnpm CARGO_TARGET_DIR=%s args=%s\n" "${CARGO_TARGET_DIR:-}" "$*" >>"${COMMAND_LOG}"
if [[ "${1:-}" == "tauri" && "${2:-}" == "build" ]]; then
  profile="release"
  target=""
  bundles=""
  prev=""
  for arg in "$@"; do
    if [[ "${arg}" == "--debug" ]]; then
      profile="debug"
    elif [[ "${prev}" == "--target" ]]; then
      target="${arg}"
    elif [[ "${prev}" == "--bundles" ]]; then
      bundles="${arg}"
    fi
    prev="${arg}"
  done

  target_root="${CARGO_TARGET_DIR:-target}"
  if [[ -n "${target}" ]]; then
    target_root="${target_root}/${target}"
  fi
  bundle_root="${target_root}/${profile}/bundle"
  mkdir -p "${bundle_root}/macos/Markdowner.app"
  if [[ "${bundles}" == *"dmg"* ]]; then
    mkdir -p "${bundle_root}/dmg"
    printf "fake dmg\n" >"${bundle_root}/dmg/Markdowner_0.1.0_${target:-local}.dmg"
  fi
fi
if [[ "${1:-}" == "install" ]]; then
  mkdir -p node_modules
fi'
}

run_pnpm() {
  if [[ -z "${REAL_PNPM}" ]]; then
    fail "pnpm is required for pnpm script tests"
  fi

  "${REAL_PNPM}" "$@"
}

test_build_uses_isolated_cargo_target_dir() {
  local temp_dir install_path log stdout stderr script isolated_target

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"

  make_test_project "${temp_dir}"
  isolated_target="$(cd "${temp_dir}/project" && pwd -P)/target/tauri-build-and-install"
  rm -rf "${temp_dir}/project/target/release"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR=${isolated_target} args=tauri build"
  assert_file_contains "${log}" "ditto ${isolated_target}/release/bundle/macos/Markdowner.app ${install_path}/Markdowner.app"
}

test_help_lists_open_flag() {
  local temp_dir stdout

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  stdout="${temp_dir}/stdout"

  make_test_project "${temp_dir}"

  "${temp_dir}/project/scripts/build-and-install.sh" --help >"${stdout}"

  assert_file_contains "${stdout}" "--open"
}

test_open_flag_launches_installed_bundle() {
  local temp_dir install_path log stdout stderr script project_root

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"

  make_test_project "${temp_dir}"
  project_root="$(cd "${temp_dir}/project" && pwd -P)"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" --no-build --open >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "ditto ${project_root}/target/release/bundle/macos/Markdowner.app ${install_path}/Markdowner.app"
  assert_file_contains "${log}" "open ${install_path}/Markdowner.app"
  assert_file_contains "${stdout}" "==> Opening ${install_path}/Markdowner.app"
}

test_no_open_does_not_launch_installed_bundle() {
  local temp_dir install_path log stdout stderr script

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"

  make_test_project "${temp_dir}"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" --no-build >"${stdout}" 2>"${stderr}"

  if grep -Fq -- "open " "${log}"; then
    sed -n '1,160p' "${log}" >&2
    fail "expected no open command without --open"
  fi
}

test_package_exposes_build_aliases() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scripts = packageJson.scripts ?? {};
const expected = {
  build: 'node scripts/build.mjs',
  'build:debug': 'pnpm build debug',
  'build:install': 'pnpm build install',
  'build:install:open': 'pnpm build install open',
  'build:mac:dmg': 'pnpm build dmg',
  'build:mac:universal:dmg': 'pnpm build universal dmg',
  'dmg:downloads': 'node scripts/build-dmg-to-downloads.mjs',
};

for (const [name, command] of Object.entries(expected)) {
  if (scripts[name] !== command) {
    console.error(`Expected package script ${name} to be ${JSON.stringify(command)}, got ${JSON.stringify(scripts[name])}`);
    process.exit(1);
  }
}
NODE
}

test_pnpm_build_without_args_runs_frontend_build() {
  local temp_dir log stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"
  make_stubs "${temp_dir}/bin"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    run_pnpm --dir "${temp_dir}/project" build >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR= args=exec tsc"
  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR= args=exec vite build"
}

test_pnpm_build_accepts_double_dash_before_flags() {
  local temp_dir stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"

  run_pnpm --dir "${temp_dir}/project" build -- --help >"${stdout}" 2>"${stderr}"

  assert_file_contains "${stdout}" "pnpm build install [open]"
}

test_pnpm_build_debug_invokes_tauri_debug_build() {
  local temp_dir log stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"
  make_stubs "${temp_dir}/bin"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    run_pnpm --dir "${temp_dir}/project" build debug >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR= args=tauri build --debug"
  if grep -Fq -- "ditto " "${log}"; then
    sed -n '1,160p' "${log}" >&2
    fail "expected debug build without install to skip ditto"
  fi
}

test_pnpm_build_install_open_launches_installed_bundle() {
  local temp_dir install_path isolated_target log stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"
  isolated_target="$(cd "${temp_dir}/project" && pwd -P)/target/tauri-build-and-install"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    run_pnpm --dir "${temp_dir}/project" build install open >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR=${isolated_target} args=tauri build"
  assert_file_contains "${log}" "ditto ${isolated_target}/release/bundle/macos/Markdowner.app ${install_path}/Markdowner.app"
  assert_file_contains "${log}" "open ${install_path}/Markdowner.app"
  assert_file_contains "${stdout}" "==> Opening ${install_path}/Markdowner.app"
}

test_pnpm_build_dmg_invokes_tauri_dmg_build_and_prints_hash() {
  local temp_dir isolated_target log stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"
  isolated_target="$(cd "${temp_dir}/project" && pwd -P)/target/tauri-build-and-install"
  make_stubs "${temp_dir}/bin"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    run_pnpm --dir "${temp_dir}/project" build dmg >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR=${isolated_target} args=tauri build --bundles dmg"
  assert_file_contains "${stdout}" "==> Distribution artifact:"
  assert_file_contains "${stdout}" "==> SHA-256:"
  assert_file_contains "${stdout}" "target/tauri-build-and-install/release/bundle/dmg/Markdowner_0.1.0_local.dmg"
}

test_pnpm_build_universal_dmg_invokes_tauri_universal_dmg_build() {
  local temp_dir isolated_target log stdout stderr

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"

  make_pnpm_test_project "${temp_dir}"
  isolated_target="$(cd "${temp_dir}/project" && pwd -P)/target/tauri-build-and-install"
  make_stubs "${temp_dir}/bin"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    run_pnpm --dir "${temp_dir}/project" build universal dmg >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR=${isolated_target} args=tauri build --target universal-apple-darwin --bundles dmg"
  assert_file_contains "${stdout}" "target/tauri-build-and-install/universal-apple-darwin/release/bundle/dmg/Markdowner_0.1.0_universal-apple-darwin.dmg"
}

test_release_workflow_uploads_only_versioned_dmg_asset() {
  assert_file_not_contains "${SOURCE_RELEASE_WORKFLOW}" 'STABLE_DMG="Markdowner_universal.dmg"'
  assert_file_not_contains "${SOURCE_RELEASE_WORKFLOW}" 'cp "$DMG" "$STABLE_DMG"'
  assert_file_not_contains "${SOURCE_RELEASE_WORKFLOW}" '"$STABLE_DMG"'
}

test_release_workflow_uses_github_generated_notes() {
  assert_file_contains "${SOURCE_RELEASE_WORKFLOW}" '--generate-notes'
  assert_file_not_contains "${SOURCE_RELEASE_WORKFLOW}" '--notes-file RELEASE_NOTES.md'
  assert_file_not_contains "${SOURCE_RELEASE_WORKFLOW}" 'Generate release notes'
}

test_package_exposes_build_aliases
test_pnpm_build_without_args_runs_frontend_build
test_pnpm_build_accepts_double_dash_before_flags
test_pnpm_build_debug_invokes_tauri_debug_build
test_pnpm_build_install_open_launches_installed_bundle
test_pnpm_build_dmg_invokes_tauri_dmg_build_and_prints_hash
test_pnpm_build_universal_dmg_invokes_tauri_universal_dmg_build
test_release_workflow_uploads_only_versioned_dmg_asset
test_release_workflow_uses_github_generated_notes
test_help_lists_open_flag
test_build_uses_isolated_cargo_target_dir
test_open_flag_launches_installed_bundle
test_no_open_does_not_launch_installed_bundle

echo "build-and-install tests passed"
