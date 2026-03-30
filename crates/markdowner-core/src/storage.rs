use std::{
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::platform::RuntimeError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
struct WorkspaceSession {
    recent_documents: Vec<String>,
}

pub(crate) fn list_markdown_files(root: &Path) -> Result<Vec<PathBuf>, RuntimeError> {
    let mut documents = Vec::new();
    collect_markdown_files(root, &mut documents)?;
    documents.sort();
    Ok(documents)
}

pub(crate) fn load_recent_documents(path: &Path) -> Result<Vec<PathBuf>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(RuntimeError::new(format!(
                "Could not restore recent documents from '{}': {error}",
                path.display()
            )));
        }
    };

    let session: WorkspaceSession = serde_json::from_str(&raw).map_err(|error| {
        RuntimeError::new(format!(
            "Could not parse recent documents from '{}': {error}",
            path.display()
        ))
    })?;

    Ok(session
        .recent_documents
        .into_iter()
        .map(PathBuf::from)
        .collect())
}

pub(crate) fn persist_recent_documents(
    path: &Path,
    recent_documents: &[PathBuf],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            RuntimeError::new(format!(
                "Could not prepare session directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    let session = WorkspaceSession {
        recent_documents: recent_documents
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    };
    let payload = serde_json::to_string_pretty(&session).map_err(|error| {
        RuntimeError::new(format!(
            "Could not serialize recent documents for '{}': {error}",
            path.display()
        ))
    })?;

    fs::write(path, payload).map_err(|error| {
        RuntimeError::new(format!(
            "Could not persist recent documents to '{}': {error}",
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
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}
