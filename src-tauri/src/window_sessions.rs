use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};

use markdowner_core::EditorMode;

use crate::DesktopBackend;

/// A webview owns both its document runtime and its durable recovery files.
/// The main window retains the legacy paths; no migration rewrites user data.
pub struct DesktopAppState {
    pub(crate) main: Mutex<DesktopBackend>,
    secondary: Mutex<HashMap<String, DesktopBackend>>,
    session_store: Option<PathBuf>,
    startup_mode: EditorMode,
}

impl DesktopAppState {
    pub(crate) fn new(session_store: Option<PathBuf>, startup_mode: EditorMode) -> Self {
        Self {
            main: Mutex::new(DesktopBackend::new_with_mode(
                session_store.clone(),
                startup_mode,
            )),
            secondary: Mutex::new(HashMap::new()),
            session_store,
            startup_mode,
        }
    }

    fn window_store(&self, label: &str) -> Option<PathBuf> {
        self.session_store.as_ref().map(|path| {
            path.with_file_name("windows")
                .join(label)
                .join("workspace-session.json")
        })
    }

    pub(crate) fn contains(&self, label: &str) -> bool {
        label == "main"
            || self.secondary.lock().unwrap().contains_key(label)
            || self
                .window_store(label)
                .is_some_and(|path| path.parent().unwrap().exists())
    }

    pub(crate) fn create_window(&self, label: &str) -> Result<(), String> {
        if !valid_secondary_label(label) || self.contains(label) {
            return Err("Window session already exists or has an invalid label".into());
        }
        let backend = DesktopBackend::new_with_mode(self.window_store(label), self.startup_mode);
        // Reserve the directory before exposing the webview, including empty windows.
        backend.save_open_tabs(&[], None, &HashMap::new())?;
        self.secondary
            .lock()
            .map_err(|_| "Could not lock window sessions")?
            .insert(label.to_string(), backend);
        Ok(())
    }

    pub(crate) fn with_backend<T>(
        &self,
        label: &str,
        operation: impl FnOnce(&mut DesktopBackend) -> Result<T, String>,
    ) -> Result<T, String> {
        if label == "main" {
            let mut backend = self
                .main
                .lock()
                .map_err(|_| "Could not lock main session")?;
            return operation(&mut backend);
        }
        let mut windows = self
            .secondary
            .lock()
            .map_err(|_| "Could not lock window sessions")?;
        let backend = windows
            .get_mut(label)
            .ok_or("Window session is no longer available")?;
        operation(backend)
    }

    pub(crate) fn restore_windows(&self, ignore_list: &[String]) -> Result<Vec<String>, String> {
        let Some(root) = self
            .session_store
            .as_ref()
            .map(|path| path.with_file_name("windows"))
        else {
            return Ok(Vec::new());
        };
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.to_string()),
        };
        let mut labels = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let label = entry.file_name().to_string_lossy().into_owned();
            if !valid_secondary_label(&label)
                || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            {
                continue;
            }
            let mut backend =
                DesktopBackend::new_with_mode(self.window_store(&label), self.startup_mode);
            // A closed clean window need not reappear. Dirty closed windows still recover.
            if entry.path().join("closed").exists() && backend.load_draft_backups()?.is_empty() {
                continue;
            }
            backend.restore_session()?;
            backend.set_ignore_list(ignore_list.to_vec());
            match fs::remove_file(entry.path().join("closed")) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            self.secondary
                .lock()
                .map_err(|_| "Could not lock window sessions")?
                .insert(label.clone(), backend);
            labels.push(label);
        }
        labels.sort();
        Ok(labels)
    }

    /// Only explicit window closes mark a session closed; application quit keeps it open.
    pub(crate) fn mark_closed(&self, label: &str) -> Result<(), String> {
        if label == "main" {
            return Ok(());
        }
        self.with_backend(label, |_| Ok(()))?;
        if let Some(path) = self.window_store(label) {
            fs::write(path.with_file_name("closed"), b"").map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn valid_secondary_label(label: &str) -> bool {
    label
        .strip_prefix(crate::NEW_WINDOW_LABEL_PREFIX)
        .is_some_and(|suffix| {
            !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use markdowner_core::storage::DraftBackupEntry;
    use tempfile::tempdir;

    fn draft(source: &str) -> DraftBackupEntry {
        DraftBackupEntry {
            untitled_id: Some("untitled:1".into()),
            path: None,
            name: Some("Untitled".into()),
            draft: source.into(),
        }
    }

    #[test]
    fn stale_edits_and_saves_cannot_mutate_a_new_or_reopened_document() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("notes.md");
        let copy = dir.path().join("copy.md");
        fs::write(&file, "original").unwrap();
        let mut backend = DesktopBackend::new(None);
        let first = backend
            .open_document(&file)
            .unwrap()
            .active_document_version
            .unwrap();
        backend.new_document().unwrap();
        let target = crate::DocumentVersion {
            id: first.id,
            revision: 1,
        };
        assert!(
            backend
                .mutate_document(target, |b| b.replace_active_document_source("stale"))
                .is_err()
        );
        assert!(
            backend
                .mutate_document(target, |b| b.save_active_document_as(&copy))
                .is_err()
        );
        assert!(!copy.exists());
        backend.open_document(&file).unwrap();
        assert!(
            backend
                .mutate_document(target, DesktopBackend::save_active_document)
                .is_err()
        );
        assert_eq!(fs::read_to_string(file).unwrap(), "original");
    }

    #[test]
    fn out_of_order_edits_cannot_overwrite_a_newer_revision_or_saved_source() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("notes.md");
        fs::write(&file, "original").unwrap();
        let mut backend = DesktopBackend::new(None);
        let id = backend
            .open_document(&file)
            .unwrap()
            .active_document_version
            .unwrap()
            .id;
        backend
            .mutate_document(crate::DocumentVersion { id, revision: 2 }, |b| {
                b.replace_active_document_source("latest")
            })
            .unwrap();
        assert!(
            backend
                .mutate_document(crate::DocumentVersion { id, revision: 1 }, |b| b
                    .replace_active_document_source("stale"))
                .is_err()
        );
        backend
            .mutate_document(
                crate::DocumentVersion { id, revision: 3 },
                DesktopBackend::save_active_document,
            )
            .unwrap();
        assert!(
            backend
                .mutate_document(crate::DocumentVersion { id, revision: 2 }, |b| b
                    .replace_active_document_source("stale"))
                .is_err()
        );
        assert_eq!(
            backend.snapshot().active_document_source.as_deref(),
            Some("latest")
        );
        assert_eq!(fs::read_to_string(file).unwrap(), "latest");
    }

    #[test]
    fn untitled_documents_have_distinct_mutation_targets() {
        let mut backend = DesktopBackend::new(None);
        let first = backend
            .new_document()
            .unwrap()
            .active_document_version
            .unwrap();
        let second = backend
            .new_document()
            .unwrap()
            .active_document_version
            .unwrap();
        assert_ne!(first.id, second.id);
        assert!(
            backend
                .mutate_document(
                    crate::DocumentVersion {
                        id: first.id,
                        revision: 100
                    },
                    |b| b.replace_active_document_source("wrong draft")
                )
                .is_err()
        );
    }

    #[test]
    fn editing_or_clearing_backups_in_one_window_cannot_change_another() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("first.md");
        let second = dir.path().join("second.md");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let state = DesktopAppState::new(
            Some(dir.path().join("workspace-session.json")),
            EditorMode::Editor,
        );
        state.create_window("markdownerWindow1").unwrap();
        state
            .with_backend("main", |backend| {
                backend.open_document(&first)?;
                backend.replace_active_document_source("first draft")?;
                backend.save_draft_backups(&[draft("recovery")])
            })
            .unwrap();
        state
            .with_backend("markdownerWindow1", |backend| {
                backend.open_document(&second)?;
                backend.replace_active_document_source("second draft")?;
                backend.save_active_document()?;
                backend.save_draft_backups(&[])
            })
            .unwrap();
        state
            .with_backend("main", |backend| {
                assert_eq!(
                    backend.snapshot().active_document_source.as_deref(),
                    Some("first draft")
                );
                assert_eq!(backend.load_draft_backups()?[0].draft, "recovery");
                backend.save_active_document().map(|_| ())
            })
            .unwrap();
        assert_eq!(fs::read_to_string(first).unwrap(), "first draft");
        assert_eq!(fs::read_to_string(second).unwrap(), "second draft");
        assert!(state.with_backend("missing", |_| Ok(())).is_err());
    }

    #[test]
    fn restart_preserves_legacy_and_secondary_recovery_and_skips_clean_closed_windows() {
        let dir = tempdir().unwrap();
        let session = dir.path().join("workspace-session.json");
        let state = DesktopAppState::new(Some(session.clone()), EditorMode::Editor);
        state
            .with_backend("main", |backend| {
                backend.save_draft_backups(&[draft("legacy")])
            })
            .unwrap();
        for label in ["markdownerWindow1", "markdownerWindow2"] {
            state.create_window(label).unwrap();
            state.mark_closed(label).unwrap();
        }
        state
            .with_backend("markdownerWindow1", |backend| {
                backend.save_draft_backups(&[draft("second window")])
            })
            .unwrap();
        drop(state);
        let restored = DesktopAppState::new(Some(session), EditorMode::Editor);
        assert_eq!(
            restored.restore_windows(&[]).unwrap(),
            ["markdownerWindow1"]
        );
        restored
            .with_backend("main", |backend| {
                assert_eq!(backend.load_draft_backups()?[0].draft, "legacy");
                Ok(())
            })
            .unwrap();
        restored
            .with_backend("markdownerWindow1", |backend| {
                assert_eq!(backend.load_draft_backups()?[0].draft, "second window");
                Ok(())
            })
            .unwrap();
        assert!(restored.create_window("markdownerWindow1").is_err());
        assert!(restored.create_window("../../main").is_err());
    }
}
