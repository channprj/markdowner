use std::{
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{EditorMode, ThemeSelection, platform::RuntimeError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
struct SerializedWorkspaceSession {
    #[serde(default)]
    recent_documents: Vec<String>,
    #[serde(default)]
    mode: EditorMode,
    #[serde(default)]
    theme: ThemeSelection,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct WorkspaceSession {
    pub(crate) recent_documents: Vec<PathBuf>,
    pub(crate) mode: EditorMode,
    pub(crate) theme: ThemeSelection,
}

pub(crate) fn list_markdown_files(root: &Path) -> Result<Vec<PathBuf>, RuntimeError> {
    let mut documents = Vec::new();
    collect_markdown_files(root, &mut documents)?;
    documents.sort();
    Ok(documents)
}

pub(crate) fn load_workspace_session(path: &Path) -> Result<WorkspaceSession, RuntimeError> {
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
    })
}

pub(crate) fn persist_workspace_session(
    path: &Path,
    recent_documents: &[PathBuf],
    mode: EditorMode,
    theme: &ThemeSelection,
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



pub(crate) fn read_document_source(path: &Path) -> Result<String, RuntimeError> {
    fs::read_to_string(path).map_err(|error| {
        RuntimeError::new(format!(
            "Could not read markdown file '{}': {error}",
            path.display()
        ))
    })
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

fn collect_markdown_files(root: &Path, documents: &mut Vec<PathBuf>) -> Result<(), RuntimeError> {
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
            if is_ignored_directory(&path) {
                continue;
            }

            collect_markdown_files(&path, documents)?;
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

fn is_ignored_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| {
            matches!(
                name,
                ".git"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | ".idea"
                    | ".vscode"
                    | ".next"
            )
        })
}
