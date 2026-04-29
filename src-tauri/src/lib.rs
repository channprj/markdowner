use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use markdowner_core::{EditorMode, EditorRuntime, ThemeKind, ThemeSelection, WorkspaceState};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub root_dir: Option<String>,
    pub workspace_documents: Vec<String>,
    pub recent_documents: Vec<String>,
    pub active_document_path: Option<String>,
    pub active_document_source: Option<String>,
    pub active_document_dirty: bool,
    pub mode: EditorMode,
    pub theme: ThemeSelection,
    pub last_error: Option<String>,
}

#[derive(Debug)]
pub struct DesktopBackend {
    runtime: EditorRuntime,
}

impl DesktopBackend {
    pub fn new(session_store: Option<PathBuf>) -> Self {
        let runtime = match session_store {
            Some(path) => EditorRuntime::new(WorkspaceState::default()).with_session_store(path),
            None => EditorRuntime::new(WorkspaceState::default()),
        };

        Self { runtime }
    }

    pub fn restore_session(&mut self) -> Result<(), String> {
        self.runtime
            .restore_session()
            .map_err(|error| error.to_string())
    }

    pub fn snapshot(&self) -> AppSnapshot {
        let workspace = self.runtime.workspace();
        let active_document = workspace.active_document();

        AppSnapshot {
            root_dir: workspace
                .root_dir()
                .map(|path| path.to_string_lossy().into_owned()),
            workspace_documents: workspace
                .workspace_documents()
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            recent_documents: workspace
                .recent_documents()
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            active_document_path: active_document
                .map(|document| document.path().to_string_lossy().into_owned()),
            active_document_source: active_document.map(|document| document.source().to_string()),
            active_document_dirty: active_document.is_some_and(|document| document.is_dirty()),
            mode: workspace.mode(),
            theme: workspace.theme().clone(),
            last_error: workspace.last_error().map(ToOwned::to_owned),
        }
    }

    pub fn open_document(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_document(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn open_workspace(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_workspace(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn open_workspace_document(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .open_workspace_document(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn replace_active_document_source(
        &mut self,
        source: impl Into<String>,
    ) -> Result<AppSnapshot, String> {
        self.runtime
            .replace_active_document_source(source)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn save_active_document(&mut self) -> Result<AppSnapshot, String> {
        self.runtime
            .save_active_document()
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn save_active_document_as(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .save_active_document_as(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }

    pub fn set_mode(&mut self, mode: EditorMode) -> AppSnapshot {
        self.runtime.set_mode(mode);
        self.snapshot()
    }

    pub fn set_theme_kind(&mut self, theme_kind: ThemeKind) -> AppSnapshot {
        self.runtime
            .set_theme(ThemeSelection::new(theme_kind, None));
        self.snapshot()
    }

    pub fn import_theme(&mut self, path: &Path) -> Result<AppSnapshot, String> {
        self.runtime
            .import_theme_from_path(path)
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
    }
}

pub struct DesktopAppState(Mutex<DesktopBackend>);

impl DesktopAppState {
    fn new(session_store: Option<PathBuf>) -> Self {
        Self(Mutex::new(DesktopBackend::new(session_store)))
    }
}

fn session_store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_config_dir()
        .ok()
        .map(|path| path.join("workspace-session.json"))
}

fn with_backend<T>(
    state: State<'_, DesktopAppState>,
    operation: impl FnOnce(&mut DesktopBackend) -> Result<T, String>,
) -> Result<T, String> {
    let mut backend = state
        .0
        .lock()
        .map_err(|_| "Could not lock desktop backend state".to_string())?;
    operation(&mut backend)
}

#[tauri::command]
fn bootstrap(state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.snapshot()))
}

#[tauri::command]
fn open_document(path: String, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| backend.open_document(Path::new(&path)))
}

#[tauri::command]
fn open_workspace(path: String, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| backend.open_workspace(Path::new(&path)))
}

#[tauri::command]
fn open_workspace_document(
    path: String,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| {
        backend.open_workspace_document(Path::new(&path))
    })
}

#[tauri::command]
fn replace_active_document_source(
    source: String,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| {
        backend.replace_active_document_source(source)
    })
}

#[tauri::command]
fn save_active_document(state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, DesktopBackend::save_active_document)
}

#[tauri::command]
fn save_active_document_as(
    path: String,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| {
        backend.save_active_document_as(Path::new(&path))
    })
}

#[tauri::command]
fn set_mode(mode: EditorMode, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.set_mode(mode)))
}

#[tauri::command]
fn set_theme(
    theme_kind: ThemeKind,
    state: State<'_, DesktopAppState>,
) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| Ok(backend.set_theme_kind(theme_kind)))
}

#[tauri::command]
fn import_theme(path: String, state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, |backend| backend.import_theme(Path::new(&path)))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let session_store = session_store_path(app.handle());
            let mut state = DesktopAppState::new(session_store);

            if let Ok(backend) = state.0.get_mut() {
                let _ = backend.restore_session();
            }

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_document,
            open_workspace,
            open_workspace_document,
            replace_active_document_source,
            save_active_document,
            save_active_document_as,
            set_mode,
            set_theme,
            import_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdowner desktop shell");
}

#[cfg(test)]
mod tests {
    use std::fs;

    use markdowner_core::ThemeKind;
    use tempfile::tempdir;

    use super::DesktopBackend;

    #[test]
    fn backend_snapshot_reflects_active_document_mode_and_theme() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("foundation.md");
        fs::write(&document_path, "# Hello\n\nworld").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&document_path).unwrap();
        backend.set_mode(markdowner_core::EditorMode::Preview);
        backend.set_theme_kind(ThemeKind::BuiltInDark);

        let snapshot = backend.snapshot();

        assert_eq!(
            snapshot.active_document_path.as_deref(),
            Some(document_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            snapshot.active_document_source.as_deref(),
            Some("# Hello\n\nworld")
        );
        assert_eq!(snapshot.mode, markdowner_core::EditorMode::Preview);
        assert_eq!(snapshot.theme.kind(), ThemeKind::BuiltInDark);
    }

    #[test]
    fn backend_open_workspace_returns_sorted_markdown_files() {
        let temp = tempdir().unwrap();
        let workspace_path = temp.path().join("workspace");
        let nested_path = workspace_path.join("nested");
        let git_path = workspace_path.join(".git");
        let node_modules_path = workspace_path.join("node_modules");
        let dist_path = workspace_path.join("dist");
        fs::create_dir_all(&nested_path).unwrap();
        fs::create_dir_all(&git_path).unwrap();
        fs::create_dir_all(&node_modules_path).unwrap();
        fs::create_dir_all(&dist_path).unwrap();
        let a = workspace_path.join("a.md");
        let b = nested_path.join("b.markdown");
        let c = nested_path.join("c.mdown");
        let d = nested_path.join("d.MKD");
        let ignored = nested_path.join("notes.txt");
        let git_doc = git_path.join("config.md");
        let dependency_doc = node_modules_path.join("package.md");
        let build_doc = dist_path.join("bundle.md");
        fs::write(&a, "# A").unwrap();
        fs::write(&b, "# B").unwrap();
        fs::write(&c, "# C").unwrap();
        fs::write(&d, "# D").unwrap();
        fs::write(&ignored, "ignore me").unwrap();
        fs::write(&git_doc, "# hidden").unwrap();
        fs::write(&dependency_doc, "# dependency").unwrap();
        fs::write(&build_doc, "# build").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_workspace(&workspace_path).unwrap();

        let snapshot = backend.snapshot();
        assert_eq!(
            snapshot.workspace_documents,
            vec![
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
                c.to_string_lossy().into_owned(),
                d.to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn backend_save_as_retargets_the_snapshot_to_the_new_path() {
        let temp = tempdir().unwrap();
        let original_path = temp.path().join("notes.md");
        let copied_path = temp.path().join("archive").join("notes-copy.md");
        fs::write(&original_path, "# Notes\n\nOriginal").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&original_path).unwrap();
        backend
            .replace_active_document_source("# Notes\n\nCopied")
            .unwrap();
        let snapshot = backend.save_active_document_as(&copied_path).unwrap();

        assert_eq!(
            snapshot.active_document_path.as_deref(),
            Some(copied_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            snapshot.recent_documents,
            vec![
                copied_path.to_string_lossy().into_owned(),
                original_path.to_string_lossy().into_owned(),
            ]
        );
        assert_eq!(
            fs::read_to_string(&copied_path).unwrap(),
            "# Notes\n\nCopied"
        );
        assert_eq!(
            fs::read_to_string(&original_path).unwrap(),
            "# Notes\n\nOriginal"
        );
    }
}
