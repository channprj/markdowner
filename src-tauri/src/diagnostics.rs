use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{Value, json};

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "markdowner.log";
const ROTATED_LOG_FILE_NAME: &str = "markdowner.log.1";
const DEFAULT_MAX_LOG_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsLogStatus {
    pub enabled: bool,
    pub log_path: Option<String>,
}

pub fn diagnostics_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_DIR_NAME).join(LOG_FILE_NAME)
}

pub fn diagnostics_status(app_data_dir: &Path, enabled: bool) -> DiagnosticsLogStatus {
    DiagnosticsLogStatus {
        enabled,
        log_path: enabled.then(|| {
            diagnostics_log_path(app_data_dir)
                .to_string_lossy()
                .into_owned()
        }),
    }
}

pub fn write_diagnostics_event(
    app_data_dir: &Path,
    event_name: &str,
    payload: Value,
) -> io::Result<PathBuf> {
    write_diagnostics_event_with_limit(app_data_dir, event_name, payload, DEFAULT_MAX_LOG_BYTES)
}

pub fn write_diagnostics_event_with_limit(
    app_data_dir: &Path,
    event_name: &str,
    payload: Value,
    max_log_bytes: u64,
) -> io::Result<PathBuf> {
    let event_name = event_name.trim();
    if event_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostics event name cannot be empty",
        ));
    }

    let log_path = diagnostics_log_path(app_data_dir);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let line = render_event_line(event_name, payload)?;
    rotate_log_if_needed(&log_path, line.len() as u64, max_log_bytes)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    file.write_all(line.as_bytes())?;
    file.flush()?;
    file.sync_data()?;

    Ok(log_path)
}

fn render_event_line(event_name: &str, payload: Value) -> io::Result<String> {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut line = serde_json::to_string(&json!({
        "timestampMs": timestamp_ms,
        "event": event_name,
        "payload": payload,
    }))
    .map_err(io::Error::other)?;
    line.push('\n');
    Ok(line)
}

fn rotate_log_if_needed(
    log_path: &Path,
    incoming_bytes: u64,
    max_log_bytes: u64,
) -> io::Result<()> {
    if max_log_bytes == 0 || !log_path.exists() {
        return Ok(());
    }

    let current_bytes = fs::metadata(log_path)?.len();
    if current_bytes.saturating_add(incoming_bytes) <= max_log_bytes {
        return Ok(());
    }

    let rotated_path = log_path.with_file_name(ROTATED_LOG_FILE_NAME);
    if rotated_path.exists() {
        fs::remove_file(&rotated_path)?;
    }
    fs::rename(log_path, rotated_path)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::tempdir;

    use super::{
        diagnostics_log_path, diagnostics_status, write_diagnostics_event,
        write_diagnostics_event_with_limit,
    };

    #[test]
    fn disabled_status_does_not_create_log_directory() {
        let temp = tempdir().unwrap();

        let status = diagnostics_status(temp.path(), false);

        assert!(!status.enabled);
        assert_eq!(status.log_path, None);
        assert!(!temp.path().join("logs").exists());
    }

    #[test]
    fn write_event_creates_json_log_under_app_data_logs() {
        let temp = tempdir().unwrap();

        let log_path = write_diagnostics_event(
            temp.path(),
            "settings.changed",
            json!({ "diagnosticsEnabled": true }),
        )
        .unwrap();

        assert_eq!(log_path, diagnostics_log_path(temp.path()));
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("\"event\":\"settings.changed\""));
        assert!(contents.contains("\"diagnosticsEnabled\":true"));
        assert!(contents.ends_with('\n'));
    }

    #[test]
    fn write_event_rotates_existing_log_when_limit_is_reached() {
        let temp = tempdir().unwrap();
        let log_path = diagnostics_log_path(temp.path());
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();
        fs::write(&log_path, "stale log entry that should rotate\n").unwrap();

        write_diagnostics_event_with_limit(
            temp.path(),
            "settings.changed",
            json!({ "editorLineWrap": false }),
            16,
        )
        .unwrap();

        assert!(log_path.with_file_name("markdowner.log.1").exists());
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("\"event\":\"settings.changed\""));
        assert!(!contents.contains("stale log entry"));
    }
}
