use std::{
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
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

    fs::write(path, payload).map_err(|error| {
        RuntimeError::new(format!(
            "Could not persist session to '{}': {error}",
            path.display()
        ))
    })
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            RuntimeError::new(format!(
                "Could not prepare document directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    fs::write(path, source).map_err(|error| {
        RuntimeError::new(format!(
            "Could not write markdown file '{}': {error}",
            path.display()
        ))
    })
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

fn is_markdown_file(path: &Path) -> bool {
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
