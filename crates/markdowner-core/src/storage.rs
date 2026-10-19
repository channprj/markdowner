use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{EditorMode, ThemeSelection, platform::RuntimeError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorPosition {
    pub line: u32,
    pub column: u32,
}

impl Default for CursorPosition {
    fn default() -> Self {
        Self { line: 1, column: 1 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
struct SerializedWorkspaceSession {
    #[serde(default)]
    recent_documents: Vec<String>,
    #[serde(default)]
    mode: EditorMode,
    #[serde(default)]
    theme: ThemeSelection,
    #[serde(default)]
    open_tabs: Vec<String>,
    #[serde(default)]
    active_tab_path: Option<String>,
    /// Remembered caret position per file path, keyed by the absolute path.
    /// BTreeMap keeps the on-disk JSON ordering deterministic between writes.
    #[serde(default)]
    cursor_positions: BTreeMap<String, CursorPosition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorkspaceSession {
    pub recent_documents: Vec<PathBuf>,
    pub mode: EditorMode,
    pub theme: ThemeSelection,
    pub open_tabs: Vec<PathBuf>,
    pub active_tab_path: Option<PathBuf>,
    pub cursor_positions: BTreeMap<PathBuf, CursorPosition>,
}

pub(crate) fn list_markdown_files(
    root: &Path,
    ignore_list: &[String],
) -> Result<Vec<PathBuf>, RuntimeError> {
    let mut documents = Vec::new();
    collect_markdown_files(root, &mut documents, ignore_list)?;
    documents.sort();
    Ok(documents)
}

/// Recommended default folder names hidden from the workspace tree. These are
/// dependency/build/cache directories that rarely hold user markdown. `.git` is
/// always ignored by [`is_ignored_directory`] regardless of this list.
pub fn default_ignore_list() -> Vec<String> {
    [
        // Build output & dependencies
        "node_modules",
        "dist",
        "build",
        "out",
        "target",
        "vendor",
        "wheels",
        // Python environments & caches
        ".venv",
        "venv",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        // Tooling environments & caches
        ".direnv",
        ".cache",
        // Editor metadata
        ".idea",
        ".vscode",
        // Web framework build artifacts
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".turbo",
    ]
    .iter()
    .map(|name| (*name).to_string())
    .collect()
}

pub fn load_workspace_session(path: &Path) -> Result<WorkspaceSession, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(WorkspaceSession::default()),
        Err(error) => {
            return Err(RuntimeError::new(format!(
                "Could not restore session from '{}': {error}",
                path.display()
            )));
        }
    };

    let session: SerializedWorkspaceSession = serde_json::from_str(&raw).map_err(|error| {
        RuntimeError::new(format!(
            "Could not parse session from '{}': {error}",
            path.display()
        ))
    })?;

    Ok(WorkspaceSession {
        recent_documents: session
            .recent_documents
            .into_iter()
            .map(PathBuf::from)
            .collect(),
        mode: session.mode,
        theme: session.theme,
        open_tabs: session.open_tabs.into_iter().map(PathBuf::from).collect(),
        active_tab_path: session.active_tab_path.map(PathBuf::from),
        cursor_positions: session
            .cursor_positions
            .into_iter()
            .map(|(path, cursor)| (PathBuf::from(path), cursor))
            .collect(),
    })
}

pub fn persist_workspace_session(
    path: &Path,
    recent_documents: &[PathBuf],
    mode: EditorMode,
    theme: &ThemeSelection,
    open_tabs: &[PathBuf],
    active_tab_path: Option<&Path>,
    cursor_positions: &BTreeMap<PathBuf, CursorPosition>,
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            RuntimeError::new(format!(
                "Could not prepare session directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    let session = SerializedWorkspaceSession {
        recent_documents: recent_documents
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        mode,
        theme: theme.clone(),
        open_tabs: open_tabs
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        active_tab_path: active_tab_path.map(|path| path.to_string_lossy().into_owned()),
        cursor_positions: cursor_positions
            .iter()
            .map(|(path, cursor)| (path.to_string_lossy().into_owned(), *cursor))
            .collect(),
    };
    let payload = serde_json::to_string_pretty(&session).map_err(|error| {
        RuntimeError::new(format!(
            "Could not serialize session for '{}': {error}",
            path.display()
        ))
    })?;

    // Use atomic write for session as well
    write_document_source(path, &payload)
}

/// One unsaved buffer captured for hot exit. `path` identifies file-backed
/// tabs; `untitled_id` (the frontend tab id) identifies untitled buffers.
/// Serialized in camelCase because the same shape crosses the Tauri boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DraftBackupEntry {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub untitled_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub draft: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
struct SerializedDraftBackups {
    #[serde(default)]
    entries: Vec<DraftBackupEntry>,
}

pub fn load_draft_backups(path: &Path) -> Result<Vec<DraftBackupEntry>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(RuntimeError::new(format!(
                "Could not restore draft backups from '{}': {error}",
                path.display()
            )));
        }
    };

    let backups: SerializedDraftBackups = serde_json::from_str(&raw).map_err(|error| {
        RuntimeError::new(format!(
            "Could not parse draft backups from '{}': {error}",
            path.display()
        ))
    })?;

    Ok(backups.entries)
}

pub fn persist_draft_backups(
    path: &Path,
    entries: &[DraftBackupEntry],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            RuntimeError::new(format!(
                "Could not prepare draft backup directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    let payload = serde_json::to_string_pretty(&SerializedDraftBackups {
        entries: entries.to_vec(),
    })
    .map_err(|error| {
        RuntimeError::new(format!(
            "Could not serialize draft backups for '{}': {error}",
            path.display()
        ))
    })?;

    write_document_source(path, &payload)
}

pub(crate) fn read_document_source(path: &Path) -> Result<String, RuntimeError> {
    fs::read_to_string(path).map_err(|error| {
        RuntimeError::new(format!(
            "Could not read markdown file '{}': {error}",
            path.display()
        ))
    })
}

/// Like `read_document_source`, but a missing file is `Ok(None)` instead of an
/// error — callers that treat "deleted on disk" as a normal state (external
/// change verification) use this to avoid surfacing spurious failures.
pub(crate) fn read_document_source_if_exists(
    path: &Path,
) -> Result<Option<String>, RuntimeError> {
    match fs::read_to_string(path) {
        Ok(source) => Ok(Some(source)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(RuntimeError::new(format!(
            "Could not read markdown file '{}': {error}",
            path.display()
        ))),
    }
}

pub(crate) fn read_stylesheet_source(path: &Path) -> Result<String, RuntimeError> {
    fs::read_to_string(path).map_err(|error| {
        RuntimeError::new(format!(
            "Could not read CSS theme file '{}': {error}",
            path.display()
        ))
    })
}

pub(crate) fn write_document_source(path: &Path, source: &str) -> Result<(), RuntimeError> {
    // Reads follow symlinks, but rename replaces the link itself. Resolve an
    // existing link before staging so the same document receives the atomic
    // write. A dangling link must remain intact and report a failed save.
    let resolved_target = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Some(fs::canonicalize(path).map_err(|error| {
                RuntimeError::new(format!(
                    "Could not resolve markdown file '{}': {error}",
                    path.display()
                ))
            })?)
        }
        Ok(_) => None,
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => {
            return Err(RuntimeError::new(format!(
                "Could not inspect markdown file '{}': {error}",
                path.display()
            )));
        }
    };
    let path = resolved_target.as_deref().unwrap_or(path);
    let parent = document_parent_directory(path);
    fs::create_dir_all(parent).map_err(|error| {
        RuntimeError::new(format!(
            "Could not prepare document directory '{}': {error}",
            parent.display()
        ))
    })?;

    let existing_permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    if existing_permissions
        .as_ref()
        .is_some_and(|permissions| permissions.readonly())
    {
        return Err(RuntimeError::new(format!(
            "Could not write markdown file '{}': {}",
            path.display(),
            std::io::Error::from(ErrorKind::PermissionDenied)
        )));
    }
    let (temp_path, mut temp_file) = create_atomic_write_temp_file(parent, path)?;

    if let Some(permissions) = existing_permissions {
        temp_file.set_permissions(permissions).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            RuntimeError::new(format!(
                "Could not preserve permissions for markdown file '{}': {error}",
                path.display()
            ))
        })?;
    }

    let write_result = (|| -> Result<(), RuntimeError> {
        use std::io::Write;

        temp_file.write_all(source.as_bytes()).map_err(|error| {
            RuntimeError::new(format!(
                "Could not stage markdown file '{}': {error}",
                path.display()
            ))
        })?;
        temp_file.sync_all().map_err(|error| {
            RuntimeError::new(format!(
                "Could not sync markdown file '{}': {error}",
                path.display()
            ))
        })?;
        drop(temp_file);

        replace_file(&temp_path, path).map_err(|error| {
            RuntimeError::new(format!(
                "Could not replace markdown file '{}': {error}",
                path.display()
            ))
        })?;
        sync_directory(parent).map_err(|error| {
            RuntimeError::new(format!(
                "Could not finalize markdown file '{}': {error}",
                path.display()
            ))
        })?;

        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result
}

fn document_parent_directory(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn create_atomic_write_temp_file(
    parent: &Path,
    target_path: &Path,
) -> Result<(PathBuf, File), RuntimeError> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = process::id();
    let stem = target_path
        .file_name()
        .unwrap_or_else(|| OsStr::new("markdowner-document"));

    for attempt in 0..1024u32 {
        let mut temp_name = OsString::from(".");
        temp_name.push(stem);
        temp_name.push(format!(".markdowner-{pid}-{nonce}-{attempt}.tmp"));

        let temp_path = parent.join(temp_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "Could not stage markdown file '{}': {error}",
                    target_path.display()
                )));
            }
        }
    }

    Err(RuntimeError::new(format!(
        "Could not stage markdown file '{}': ran out of unique temporary file names",
        target_path.display()
    )))
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<u16>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<u16>>();

    let replaced = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

fn collect_markdown_files(
    root: &Path,
    documents: &mut Vec<PathBuf>,
    ignore_list: &[String],
) -> Result<(), RuntimeError> {
    let entries = fs::read_dir(root).map_err(|error| {
        RuntimeError::new(format!(
            "Could not read workspace folder '{}': {error}",
            root.display()
        ))
    })?;

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if is_ignored_directory(&path, ignore_list) {
                continue;
            }

            collect_markdown_files(&path, documents, ignore_list)?;
            continue;
        }

        if file_type.is_file() && is_markdown_file(&path) {
            documents.push(path);
        }
    }

    Ok(())
}

pub(crate) fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
}

/// `.git` is always ignored; every other folder name comes from the
/// user-configurable `ignore_list` (matched by exact basename, anywhere).
fn is_ignored_directory(path: &Path, ignore_list: &[String]) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name == ".git" || ignore_list.iter().any(|ignored| ignored == name))
}

#[cfg(test)]
mod scan_tests {
    use super::{default_ignore_list, list_markdown_files};
    use std::fs;
    use tempfile::tempdir;

    fn names(root: &std::path::Path, ignore: &[String]) -> Vec<String> {
        list_markdown_files(root, ignore)
            .unwrap()
            .into_iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    fn make_workspace() -> tempfile::TempDir {
        let temp = tempdir().unwrap();
        let root = temp.path();
        for dir in ["keep", ".git", "node_modules", ".claude"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        fs::write(root.join("top.md"), "#").unwrap();
        fs::write(root.join("keep/nested.md"), "#").unwrap();
        fs::write(root.join(".git/config.md"), "#").unwrap();
        fs::write(root.join("node_modules/dep.md"), "#").unwrap();
        fs::write(root.join(".claude/notes.md"), "#").unwrap();
        temp
    }

    #[test]
    fn custom_list_hides_named_folders_and_git_is_always_hidden() {
        let temp = make_workspace();
        let ignore = vec!["node_modules".to_string(), ".claude".to_string()];
        let found = names(temp.path(), &ignore);
        assert_eq!(found, vec!["keep/nested.md", "top.md"]);
    }

    #[test]
    fn empty_list_shows_everything_except_git() {
        let temp = make_workspace();
        let found = names(temp.path(), &[]);
        // `.git` stays hidden; node_modules and .claude reappear without a list.
        assert_eq!(
            found,
            vec![
                ".claude/notes.md",
                "keep/nested.md",
                "node_modules/dep.md",
                "top.md",
            ]
        );
    }

    #[test]
    fn default_list_hides_node_modules_but_not_dot_claude() {
        let temp = make_workspace();
        let found = names(temp.path(), &default_ignore_list());
        assert_eq!(found, vec![".claude/notes.md", "keep/nested.md", "top.md"]);
    }
}
