//! In-app update notifier: reads the latest GitHub release, compares versions,
//! and (Phase 2) installs the new bundle. Network I/O shells out to `curl`,
//! mirroring `install.sh`, so the webview needs no GitHub CSP allowlist.

use std::{
    cmp::Ordering,
    sync::atomic::{AtomicBool, Ordering as AtomicOrdering},
};

use serde::{Deserialize, Serialize};

/// A semantic version `major.minor.patch` with an optional prerelease tag.
#[derive(Debug, PartialEq, Eq)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

/// Parse `MAJOR.MINOR.PATCH[-prerelease]`, tolerating a leading `v`.
fn parse_version(raw: &str) -> Option<SemVer> {
    let trimmed = raw.trim().trim_start_matches('v');
    let (core, prerelease) = match trimmed.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (trimmed, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(SemVer {
        major,
        minor,
        patch,
        prerelease,
    })
}

fn version_ordering(a: &SemVer, b: &SemVer) -> Ordering {
    (a.major, a.minor, a.patch)
        .cmp(&(b.major, b.minor, b.patch))
        .then_with(|| match (&a.prerelease, &b.prerelease) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater, // a release outranks a prerelease
            (Some(_), None) => Ordering::Less,
            (Some(x), Some(y)) => x.cmp(y),
        })
}

/// True iff `latest` is strictly newer than `current`. Unparseable input is
/// treated as "no update" so a malformed tag never nags the user.
fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => version_ordering(&l, &c) == Ordering::Greater,
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

/// The update status surfaced to the frontend. camelCase to match the TS
/// `UpdateInfo` interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub dmg_url: Option<String>,
    pub release_url: String,
    pub notes: String,
}

fn universal_dmg_url(release: &GithubRelease) -> Option<String> {
    release
        .assets
        .iter()
        .find(|asset| asset.name.ends_with("_universal.dmg"))
        .map(|asset| asset.browser_download_url.clone())
}

/// Pure: turn the GitHub release JSON + the running version into `UpdateInfo`.
fn build_update_info(current_version: &str, release_json: &str) -> Result<UpdateInfo, String> {
    let release: GithubRelease = serde_json::from_str(release_json)
        .map_err(|e| format!("Failed to parse release JSON: {e}"))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateInfo {
        available: is_newer(&latest, current_version),
        current_version: current_version.to_string(),
        latest_version: latest,
        dmg_url: universal_dmg_url(&release),
        release_url: release.html_url,
        notes: release.body,
    })
}

const RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/channprj/markdowner/releases/latest";

/// Fetch the latest-release JSON via `curl` (guaranteed present on macOS and
/// already an `install.sh` dependency).
fn fetch_latest_release_json() -> Result<String, String> {
    let output = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: markdowner",
            RELEASES_LATEST_API,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {e}"))?;
    if !output.status.success() {
        return Err(format!("curl exited with status {}", output.status));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 from curl: {e}"))
}

#[tauri::command]
pub fn check_for_update(app_handle: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app_handle.package_info().version.to_string();
    let json = fetch_latest_release_json()?;
    build_update_info(&current, &json)
}

use std::path::{Path, PathBuf};

/// Locate the `.app` bundle that contains the running executable.
fn app_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().map(|ext| ext == "app").unwrap_or(false))
        .ok_or("Could not locate the .app bundle from the current executable")?;
    Ok(bundle.to_path_buf())
}

/// Probe whether we can write into `dir` by creating and removing a temp file.
fn is_dir_writable(dir: &Path) -> bool {
    let probe = dir.join(".markdowner-write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The detached installer, embedded at compile time. It waits for the running
/// app to exit, then mounts the DMG, stages the new bundle next to the
/// destination, and swaps it in atomically — never removing the live bundle
/// until a verified replacement exists. See `scripts/self-update.sh` for the
/// full safety contract. The running PID, DMG path, and destination are passed
/// as positional arguments so paths are never interpolated into shell source.
const INSTALL_SCRIPT: &str = include_str!("../scripts/self-update.sh");

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, AtomicOrdering::Release);
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    dmg_url: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if UPDATE_IN_PROGRESS.swap(true, AtomicOrdering::AcqRel) {
        return Err("An update is already in progress".into());
    }
    let _guard = UpdateGuard;
    let staged = tauri::async_runtime::spawn_blocking(move || download_and_stage_update(&dmg_url))
        .await
        .map_err(|error| error.to_string())??;
    let Some((bundle, dmg, script)) = staged else {
        return Ok(());
    };

    // Every webview must durably flush and stop editing before the installer
    // is launched. A failed or unresponsive window keeps the application open.
    crate::session_flush::prepare_all(&app_handle).await?;
    let launched = std::process::Command::new("/bin/bash")
        .arg(script)
        .arg(std::process::id().to_string())
        .arg(dmg)
        .arg(bundle)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Err(error) = launched {
        crate::session_flush::release_all(&app_handle);
        return Err(format!("Failed to launch installer: {error}"));
    }
    app_handle.exit(0);
    Ok(())
}

fn download_and_stage_update(dmg_url: &str) -> Result<Option<(PathBuf, PathBuf, PathBuf)>, String> {
    let bundle = app_bundle_path()?;
    let tmp_dir = std::env::temp_dir();
    let dmg_path = tmp_dir.join("markdowner-update.dmg");
    let status = std::process::Command::new("curl")
        .args(["-fL", "--silent", "--show-error", "-o"])
        .arg(&dmg_path)
        .arg(dmg_url)
        .status()
        .map_err(|error| format!("Failed to run curl: {error}"))?;
    if !status.success() {
        return Err(format!("Download failed (curl status {status})"));
    }
    let parent = bundle.parent().ok_or("Bundle has no parent directory")?;
    if !is_dir_writable(parent) {
        std::process::Command::new("open")
            .arg(&dmg_path)
            .spawn()
            .map_err(|error| format!("Failed to open DMG: {error}"))?;
        return Ok(None);
    }
    let script_path = tmp_dir.join("markdowner-update.sh");
    std::fs::write(&script_path, INSTALL_SCRIPT)
        .map_err(|error| format!("Failed to write installer: {error}"))?;
    Ok(Some((bundle, dmg_path, script_path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_patch_minor_and_major_are_detected() {
        assert!(is_newer("0.260528.3", "0.260528.2"));
        assert!(is_newer("0.260601.0", "0.260528.2"));
        assert!(is_newer("1.0.0", "0.260528.2"));
    }

    #[test]
    fn equal_or_older_is_not_newer() {
        assert!(!is_newer("0.260528.2", "0.260528.2"));
        assert!(!is_newer("0.260528.1", "0.260528.2"));
    }

    #[test]
    fn leading_v_is_tolerated() {
        assert!(is_newer("v0.260601.0", "0.260528.2"));
    }

    #[test]
    fn release_outranks_prerelease() {
        assert!(is_newer("0.260601.0", "0.260601.0-beta.1"));
        assert!(!is_newer("0.260601.0-beta.1", "0.260601.0"));
    }

    #[test]
    fn unparseable_versions_are_not_newer() {
        assert!(!is_newer("not-a-version", "0.260528.2"));
        assert!(!is_newer("0.260601.0", "garbage"));
    }

    const SAMPLE_RELEASE: &str = r#"{
        "tag_name": "v0.260601.0",
        "html_url": "https://github.com/channprj/markdowner/releases/tag/v0.260601.0",
        "body": "Release notes here",
        "assets": [
            {"name": "Markdowner_0.260601.0_universal.dmg",
             "browser_download_url": "https://example.com/Markdowner_0.260601.0_universal.dmg"},
            {"name": "other.txt",
             "browser_download_url": "https://example.com/other.txt"}
        ]
    }"#;

    #[test]
    fn build_update_info_flags_available_and_picks_universal_dmg() {
        let info = build_update_info("0.260528.2", SAMPLE_RELEASE).unwrap();
        assert!(info.available);
        assert_eq!(info.latest_version, "0.260601.0");
        assert_eq!(info.current_version, "0.260528.2");
        assert_eq!(
            info.dmg_url.as_deref(),
            Some("https://example.com/Markdowner_0.260601.0_universal.dmg")
        );
        assert_eq!(
            info.release_url,
            "https://github.com/channprj/markdowner/releases/tag/v0.260601.0"
        );
        assert_eq!(info.notes, "Release notes here");
    }

    #[test]
    fn build_update_info_reports_no_update_for_same_version() {
        let info = build_update_info("0.260601.0", SAMPLE_RELEASE).unwrap();
        assert!(!info.available);
    }

    #[test]
    fn build_update_info_handles_missing_dmg() {
        let json = r#"{"tag_name":"v0.260601.0","html_url":"u","body":"","assets":[]}"#;
        let info = build_update_info("0.260528.2", json).unwrap();
        assert!(info.available);
        assert_eq!(info.dmg_url, None);
    }

    #[test]
    fn embedded_install_script_swaps_atomically_and_never_destroys_the_live_bundle() {
        let script = INSTALL_SCRIPT;
        // Reads the running PID, DMG, and destination from positional args
        // rather than interpolated source.
        assert!(script.contains("APP_PID=\"$1\""));
        assert!(script.contains("DMG=\"$2\""));
        assert!(script.contains("DEST=\"$3\""));
        // Waits for the running app to exit before touching the bundle.
        assert!(script.contains("kill -0 \"$APP_PID\""));
        // Stages the new bundle into a scratch path, NOT directly over DEST...
        assert!(script.contains("DITTO_BIN=\"${MARKDOWNER_DITTO_BIN:-/usr/bin/ditto}\""));
        assert!(script.contains("\"$DITTO_BIN\" \"$MOUNT/Markdowner.app\" \"$STAGED\""));
        assert!(script.contains("xattr -dr com.apple.quarantine \"$STAGED\""));
        // ...then swaps it in atomically, with a backup that can be restored.
        assert!(script.contains("mv \"$DEST\" \"$BACKUP\""));
        assert!(script.contains("trap fail INT TERM"));
        assert!(script.contains("mv \"$STAGED\" \"$DEST\""));
        assert!(script.contains("trap - INT TERM"));
        assert!(script.contains("mv \"$BACKUP\" \"$DEST\""));
        assert!(script.contains("open \"$DEST\""));
        // The data-loss pattern (delete the live bundle before a verified
        // replacement exists) must never reappear.
        assert!(!script.contains("rm -rf \"$DEST\""));
    }
}
