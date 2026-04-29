use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use markdowner_core::{EditorMode, EditorRuntime, ThemeKind, ThemeSelection, WorkspaceState};
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State,
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

const MENU_COMMAND_EVENT: &str = "markdowner://menu-command";
const MENU_FILE_ID: &str = "file";
const MENU_VIEW_ID: &str = "view";
const MENU_COMMAND_NEW_DOCUMENT: &str = "new-document";
const MENU_COMMAND_OPEN_DOCUMENT: &str = "open-document";
const MENU_COMMAND_OPEN_WORKSPACE: &str = "open-workspace";
const MENU_COMMAND_SAVE_ACTIVE_DOCUMENT: &str = "save-active-document";
const MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS: &str = "save-active-document-as";
const MENU_COMMAND_SET_MODE_WYSIWYG: &str = "mode-wysiwyg";
const MENU_COMMAND_SET_MODE_SOURCE: &str = "mode-source";
const MENU_COMMAND_SET_MODE_PREVIEW: &str = "mode-preview";
const MENU_FILE_TITLE: &str = "File";
const MENU_VIEW_TITLE: &str = "View";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MenuCommandDescriptor {
    id: &'static str,
    label: &'static str,
    accelerator: &'static str,
}

const FILE_MENU_COMMANDS: &[MenuCommandDescriptor] = &[
    MenuCommandDescriptor {
        id: MENU_COMMAND_NEW_DOCUMENT,
        label: "New Document",
        accelerator: "CmdOrCtrl+N",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_OPEN_DOCUMENT,
        label: "Open Markdown…",
        accelerator: "CmdOrCtrl+O",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_OPEN_WORKSPACE,
        label: "Open Folder…",
        accelerator: "CmdOrCtrl+Shift+O",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
        label: "Save",
        accelerator: "CmdOrCtrl+S",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS,
        label: "Save As…",
        accelerator: "CmdOrCtrl+Shift+S",
    },
];

const VIEW_MENU_COMMANDS: &[MenuCommandDescriptor] = &[
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_WYSIWYG,
        label: "WYSIWYG",
        accelerator: "CmdOrCtrl+1",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_SOURCE,
        label: "Source",
        accelerator: "CmdOrCtrl+2",
    },
    MenuCommandDescriptor {
        id: MENU_COMMAND_SET_MODE_PREVIEW,
        label: "Preview",
        accelerator: "CmdOrCtrl+3",
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub root_dir: Option<String>,
    pub workspace_documents: Vec<String>,
    pub recent_documents: Vec<String>,
    pub active_document_name: Option<String>,
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
            active_document_name: active_document.map(|document| document.display_name()),
            active_document_path: active_document.and_then(|document| {
                document
                    .backing_path()
                    .map(|path| path.to_string_lossy().into_owned())
            }),
            active_document_source: active_document.map(|document| document.source().to_string()),
            active_document_dirty: active_document.is_some_and(|document| document.is_dirty()),
            mode: workspace.mode(),
            theme: workspace.theme().clone(),
            last_error: workspace.last_error().map(ToOwned::to_owned),
        }
    }

    pub fn new_document(&mut self) -> Result<AppSnapshot, String> {
        self.runtime
            .new_document()
            .map_err(|error| error.to_string())?;
        Ok(self.snapshot())
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

    pub fn has_active_document_external_changes(&mut self) -> Result<bool, String> {
        self.runtime
            .active_document_has_external_modifications()
            .map_err(|error| error.to_string())
    }

    pub fn active_document_disk_source(&mut self) -> Result<String, String> {
        self.runtime
            .active_document_disk_source()
            .map_err(|error| error.to_string())
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

fn build_menu_item<R: Runtime>(
    app: &AppHandle<R>,
    descriptor: MenuCommandDescriptor,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    MenuItemBuilder::with_id(descriptor.id, descriptor.label)
        .accelerator(descriptor.accelerator)
        .build(app)
}

fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mut file_menu_builder = SubmenuBuilder::with_id(app, MENU_FILE_ID, MENU_FILE_TITLE);
    for descriptor in FILE_MENU_COMMANDS {
        let item = build_menu_item(app, *descriptor)?;
        file_menu_builder = file_menu_builder.item(&item);
    }
    let file_menu = file_menu_builder.build()?;

    let mut view_menu_builder = SubmenuBuilder::with_id(app, MENU_VIEW_ID, MENU_VIEW_TITLE);
    for descriptor in VIEW_MENU_COMMANDS {
        let item = build_menu_item(app, *descriptor)?;
        view_menu_builder = view_menu_builder.item(&item);
    }
    let view_menu = view_menu_builder.build()?;

    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&view_menu)
        .build()
}

fn menu_command_from_id(id: &str) -> Option<&'static str> {
    match id {
        MENU_COMMAND_NEW_DOCUMENT => Some(MENU_COMMAND_NEW_DOCUMENT),
        MENU_COMMAND_OPEN_DOCUMENT => Some(MENU_COMMAND_OPEN_DOCUMENT),
        MENU_COMMAND_OPEN_WORKSPACE => Some(MENU_COMMAND_OPEN_WORKSPACE),
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT => Some(MENU_COMMAND_SAVE_ACTIVE_DOCUMENT),
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS => Some(MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS),
        MENU_COMMAND_SET_MODE_WYSIWYG => Some(MENU_COMMAND_SET_MODE_WYSIWYG),
        MENU_COMMAND_SET_MODE_SOURCE => Some(MENU_COMMAND_SET_MODE_SOURCE),
        MENU_COMMAND_SET_MODE_PREVIEW => Some(MENU_COMMAND_SET_MODE_PREVIEW),
        _ => None,
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
fn new_document(state: State<'_, DesktopAppState>) -> Result<AppSnapshot, String> {
    with_backend(state, DesktopBackend::new_document)
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
fn has_active_document_external_changes(state: State<'_, DesktopAppState>) -> Result<bool, String> {
    with_backend(state, DesktopBackend::has_active_document_external_changes)
}

#[tauri::command]
fn active_document_disk_source(state: State<'_, DesktopAppState>) -> Result<String, String> {
    with_backend(state, DesktopBackend::active_document_disk_source)
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
        .on_menu_event(|app, event| {
            if let Some(command) = menu_command_from_id(event.id().as_ref()) {
                let _ = app.emit(MENU_COMMAND_EVENT, command);
            }
        })
        .setup(|app| {
            let session_store = session_store_path(app.handle());
            let mut state = DesktopAppState::new(session_store);

            if let Ok(backend) = state.0.get_mut() {
                let _ = backend.restore_session();
            }

            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            new_document,
            open_document,
            open_workspace,
            open_workspace_document,
            replace_active_document_source,
            save_active_document,
            save_active_document_as,
            has_active_document_external_changes,
            active_document_disk_source,
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

    use super::{
        DesktopBackend, FILE_MENU_COMMANDS, MENU_COMMAND_NEW_DOCUMENT, MENU_COMMAND_OPEN_DOCUMENT,
        MENU_COMMAND_OPEN_WORKSPACE, MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
        MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS, MENU_COMMAND_SET_MODE_PREVIEW, MENU_FILE_TITLE,
        MENU_VIEW_TITLE, VIEW_MENU_COMMANDS, menu_command_from_id,
    };

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

    #[test]
    fn backend_new_document_snapshot_exposes_an_untitled_draft_without_a_path() {
        let mut backend = DesktopBackend::new(None);

        let snapshot = backend.new_document().unwrap();

        assert_eq!(snapshot.active_document_path, None);
        assert_eq!(
            snapshot.active_document_name.as_deref(),
            Some("Untitled.md")
        );
        assert_eq!(snapshot.active_document_source.as_deref(), Some(""));
        assert!(snapshot.active_document_dirty);
        assert!(snapshot.recent_documents.is_empty());
    }

    #[test]
    fn app_menu_descriptors_cover_file_and_view_commands() {
        assert_eq!(MENU_FILE_TITLE, "File");
        assert_eq!(MENU_VIEW_TITLE, "View");
        assert_eq!(
            FILE_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>(),
            vec![
                MENU_COMMAND_NEW_DOCUMENT,
                MENU_COMMAND_OPEN_DOCUMENT,
                MENU_COMMAND_OPEN_WORKSPACE,
                MENU_COMMAND_SAVE_ACTIVE_DOCUMENT,
                MENU_COMMAND_SAVE_ACTIVE_DOCUMENT_AS,
            ]
        );
        assert_eq!(
            VIEW_MENU_COMMANDS
                .iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>(),
            vec![
                super::MENU_COMMAND_SET_MODE_WYSIWYG,
                super::MENU_COMMAND_SET_MODE_SOURCE,
                MENU_COMMAND_SET_MODE_PREVIEW,
            ]
        );
    }

    #[test]
    fn backend_reads_active_document_disk_source_for_compare() {
        let temp = tempdir().unwrap();
        let original_path = temp.path().join("notes.md");
        fs::write(&original_path, "# Initial\n").unwrap();

        let mut backend = DesktopBackend::new(None);
        backend.open_document(&original_path).unwrap();
        backend
            .replace_active_document_source("# Initial\nEdited by app")
            .unwrap();

        fs::write(&original_path, "# External update\n").unwrap();

        let disk_source = backend.active_document_disk_source().unwrap();
        assert_eq!(disk_source, "# External update\n");
    }

    #[test]
    fn menu_command_mapping_only_accepts_supported_command_ids() {
        assert_eq!(
            menu_command_from_id(MENU_COMMAND_SET_MODE_PREVIEW),
            Some(MENU_COMMAND_SET_MODE_PREVIEW)
        );
        assert_eq!(menu_command_from_id("unknown-command"), None);
    }
}
