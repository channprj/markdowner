use std::{
    error::Error,
    fmt::{self, Display, Formatter},
    path::{Path, PathBuf},
};

use crate::{
    Document, Inline, InlineRevealSelection, WorkspaceState,
    storage::{
        list_markdown_files, load_workspace_session, persist_workspace_session,
        read_document_source, read_stylesheet_source, write_document_source,
    },
    theme::validate_stylesheet,
};

const MARKDOWN_FILE_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDialogOptions {
    title: String,
    allowed_extensions: Vec<String>,
}

impl FileDialogOptions {
    pub fn new(title: impl Into<String>, allowed_extensions: Vec<String>) -> Self {
        Self {
            title: title.into(),
            allowed_extensions,
        }
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn allowed_extensions(&self) -> &[String] {
        &self.allowed_extensions
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowDescriptor {
    id: String,
    title: String,
}

impl WindowDescriptor {
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    command: String,
    title: String,
}

impl MenuItem {
    pub fn new(command: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            title: title.into(),
        }
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuDescriptor {
    items: Vec<MenuItem>,
}

impl MenuDescriptor {
    pub fn new(items: Vec<MenuItem>) -> Self {
        Self { items }
    }

    pub fn items(&self) -> &[MenuItem] {
        &self.items
    }
}

pub trait PlatformAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf>;
    fn open_folder(&mut self, title: &str) -> Option<PathBuf>;
    fn present_window(&mut self, descriptor: &WindowDescriptor);
    fn install_menu(&mut self, descriptor: &MenuDescriptor);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for RuntimeError {}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EditorRuntime {
    workspace: WorkspaceState,
    session_store: Option<PathBuf>,
}

impl EditorRuntime {
    pub fn new(workspace: WorkspaceState) -> Self {
        Self {
            workspace,
            session_store: None,
        }
    }

    pub fn workspace(&self) -> &WorkspaceState {
        &self.workspace
    }

    pub fn workspace_mut(&mut self) -> &mut WorkspaceState {
        &mut self.workspace
    }

    pub fn with_session_store(mut self, path: PathBuf) -> Self {
        self.session_store = Some(path);
        self
    }

    pub fn set_session_store(&mut self, path: PathBuf) {
        self.session_store = Some(path);
    }

    pub fn session_store_path(&self) -> Option<&Path> {
        self.session_store.as_deref()
    }

    pub fn bootstrap_ui(&mut self, adapter: &mut impl PlatformAdapter) {
        adapter.present_window(&WindowDescriptor::new("main", "Markdowner"));
        adapter.install_menu(&MenuDescriptor::new(vec![
            MenuItem::new("open-document", "Open…"),
            MenuItem::new("open-workspace", "Open Folder…"),
            MenuItem::new("mode-wysiwyg", "WYSIWYG"),
            MenuItem::new("mode-editor", "Editor"),
            MenuItem::new("mode-splitview", "Split-view"),
            MenuItem::new("theme-light", "Light Theme"),
            MenuItem::new("theme-dark", "Dark Theme"),
            MenuItem::new("theme-import-css", "Import CSS Theme…"),
        ]));
    }

    pub fn restore_session(&mut self) -> Result<(), RuntimeError> {
        let Some(session_store) = self.session_store.clone() else {
            return Ok(());
        };

        let session = match load_workspace_session(&session_store) {
            Ok(session) => session,
            Err(error) => return self.fail(error),
        };
        self.workspace
            .restore_recent_documents(session.recent_documents);
        self.workspace.set_mode(session.mode);
        self.workspace.set_theme(session.theme);
        self.workspace.clear_error();
        Ok(())
    }

    pub fn persist_session(&mut self) -> Result<(), RuntimeError> {
        let Some(session_store) = self.session_store.clone() else {
            return Ok(());
        };
        let existing_tabs = load_workspace_session(&session_store).ok();
        let open_tabs = existing_tabs
            .as_ref()
            .map(|session| session.open_tabs.clone())
            .unwrap_or_default();
        let active_tab_path = existing_tabs
            .as_ref()
            .and_then(|session| session.active_tab_path.as_deref());
        let cursor_positions = existing_tabs
            .as_ref()
            .map(|session| session.cursor_positions.clone())
            .unwrap_or_default();

        match persist_workspace_session(
            &session_store,
            self.workspace.recent_documents(),
            self.workspace.mode(),
            self.workspace.theme(),
            &open_tabs,
            active_tab_path,
            &cursor_positions,
        ) {
            Ok(()) => {
                self.workspace.clear_error();
                Ok(())
            }
            Err(error) => self.fail(error),
        }
    }

    pub fn open_document_via(
        &mut self,
        adapter: &mut impl PlatformAdapter,
    ) -> Result<Option<PathBuf>, RuntimeError> {
        let Some(path) = adapter.open_file(&FileDialogOptions::new(
            "Open Markdown",
            MARKDOWN_FILE_EXTENSIONS
                .into_iter()
                .map(str::to_string)
                .collect(),
        )) else {
            return Ok(None);
        };

        self.open_document(&path).map(Some)
    }

    pub fn open_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.open_document_with_message(path, "Could not open document")
    }

    pub fn new_document(&mut self) -> Result<(), RuntimeError> {
        self.workspace.new_document();
        Ok(())
    }

    pub fn import_theme_via(
        &mut self,
        adapter: &mut impl PlatformAdapter,
    ) -> Result<Option<PathBuf>, RuntimeError> {
        let Some(path) = adapter.open_file(&FileDialogOptions::new(
            "Import CSS Theme",
            vec!["css".to_string()],
        )) else {
            return Ok(None);
        };

        self.import_theme_from_path(&path).map(Some)
    }

    pub fn open_recent_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.open_document_with_message(path, "Could not open recent document")
    }

    pub fn import_theme_from_path(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        let previous_theme = self.workspace.theme().clone();
        let stylesheet = match read_stylesheet_source(path) {
            Ok(stylesheet) => stylesheet,
            Err(error) => return self.recover_theme(previous_theme, error),
        };

        if let Err(message) = validate_stylesheet(&stylesheet) {
            return self.recover_theme(
                previous_theme,
                RuntimeError::new(format!(
                    "Could not import CSS theme '{}': {message}",
                    path.display()
                )),
            );
        }

        self.workspace.set_theme(crate::ThemeSelection::imported(
            path.to_string_lossy().into_owned(),
            stylesheet,
        ));
        if let Err(error) = self.persist_session() {
            return self.fail(error);
        }

        self.workspace.clear_error();
        Ok(path.to_path_buf())
    }

    pub fn save_active_document(&mut self) -> Result<PathBuf, RuntimeError> {
        let Some(active_document) = self.workspace.active_document() else {
            return self.fail(RuntimeError::new(
                "Could not save document because no document is open",
            ));
        };
        let Some(path) = active_document.backing_path().map(Path::to_path_buf) else {
            return self.fail(RuntimeError::new(
                "Could not save document because it has no file path yet",
            ));
        };
        let source = active_document.source().to_string();

        if self.active_document_has_external_modifications()? {
            return self.fail(RuntimeError::new(format!(
                "Could not save document '{}' because it has changed on disk",
                path.display()
            )));
        }

        if let Err(error) = write_document_source(&path, &source) {
            return self.fail(error);
        }
        if !self.workspace.mark_active_document_saved() {
            return self.fail(RuntimeError::new(
                "Could not update save state because the active document disappeared",
            ));
        }

        self.workspace.clear_error();
        Ok(path)
    }

    pub fn save_active_document_as(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        let Some(active_document) = self.workspace.active_document() else {
            return self.fail(RuntimeError::new(
                "Could not save document because no document is open",
            ));
        };
        let source = active_document.source().to_string();
        let backing_path = active_document.backing_path().map(Path::to_path_buf);

        if let Some(backing_path) = backing_path {
            if self.active_document_has_external_modifications()? {
                return self.fail(RuntimeError::new(format!(
                    "Could not save document '{}' because it has changed on disk",
                    backing_path.display()
                )));
            }
        }

        if let Err(error) = write_document_source(path, &source) {
            return self.fail(error);
        }
        if !self.workspace.save_active_document_as(path.to_path_buf()) {
            return self.fail(RuntimeError::new(
                "Could not update save state because the active document disappeared",
            ));
        }
        if let Err(error) = self.persist_session() {
            return self.fail(error);
        }

        self.workspace.clear_error();
        Ok(path.to_path_buf())
    }

    pub fn replace_active_document(&mut self, document: Document) -> Result<(), RuntimeError> {
        if self.workspace.replace_active_document(document) {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not edit document because no document is open",
            ))
        }
    }

    pub fn replace_active_document_source(
        &mut self,
        source: impl Into<String>,
    ) -> Result<(), RuntimeError> {
        if self.workspace.replace_active_document_source(source) {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not edit document source because no document is open",
            ))
        }
    }

    pub fn toggle_checklist_item(&mut self, block_index: usize) -> Result<(), RuntimeError> {
        if self.workspace.toggle_checklist_item(block_index) {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not toggle checklist item because the target block is unavailable",
            ))
        }
    }

    pub fn replace_table_cell(
        &mut self,
        block_index: usize,
        row_index: usize,
        column_index: usize,
        cell: Vec<Inline>,
    ) -> Result<(), RuntimeError> {
        if self
            .workspace
            .replace_table_cell(block_index, row_index, column_index, cell)
        {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not edit table cell because the target cell is unavailable",
            ))
        }
    }

    pub fn activate_inline_reveal(
        &mut self,
        selection: InlineRevealSelection,
    ) -> Result<(), RuntimeError> {
        if self.workspace.activate_inline_reveal(selection) {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not activate inline reveal because the target block is unavailable",
            ))
        }
    }

    pub fn deactivate_inline_reveal(&mut self) -> Result<(), RuntimeError> {
        if self.workspace.deactivate_inline_reveal() {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not deactivate inline reveal because no reveal is active",
            ))
        }
    }

    pub fn edit_active_inline_reveal_source(
        &mut self,
        source: impl Into<String>,
        cursor_offset: usize,
    ) -> Result<(), RuntimeError> {
        if self
            .workspace
            .edit_active_inline_reveal_source(source, cursor_offset)
        {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not edit inline reveal because no reveal is active",
            ))
        }
    }

    pub fn set_mode(&mut self, mode: crate::EditorMode) {
        self.workspace.set_mode(mode);
        let _ = self.persist_session();
    }

    pub fn set_theme(&mut self, theme: crate::ThemeSelection) {
        self.workspace.set_theme(theme);
        let _ = self.persist_session();
    }

    pub fn open_workspace_via(
        &mut self,
        adapter: &mut impl PlatformAdapter,
    ) -> Result<Option<PathBuf>, RuntimeError> {
        let Some(path) = adapter.open_folder("Open Workspace") else {
            return Ok(None);
        };
        self.open_workspace(&path).map(Some)
    }

    pub fn open_workspace(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        let documents = match list_markdown_files(path) {
            Ok(documents) => documents,
            Err(error) => return self.fail(error),
        };

        self.workspace
            .set_workspace_documents(path.to_path_buf(), documents);
        self.workspace.clear_error();
        Ok(path.to_path_buf())
    }

    pub fn open_workspace_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        if self
            .workspace
            .workspace_documents()
            .iter()
            .all(|document| document != path)
        {
            return self.fail(RuntimeError::new(format!(
                "Could not open workspace document '{}' because it is not in the current workspace",
                path.display()
            )));
        }

        self.open_document(path)
    }

    fn open_document_with_message(
        &mut self,
        path: &Path,
        prefix: &str,
    ) -> Result<PathBuf, RuntimeError> {
        if self.workspace.activate_open_document(path) {
            if let Err(error) = self.persist_session() {
                return self.fail(error);
            }

            self.workspace.clear_error();
            return Ok(path.to_path_buf());
        }

        let source = match read_document_source(path) {
            Ok(source) => source,
            Err(error) => {
                return self.fail(RuntimeError::new(format!(
                    "{prefix} '{}': {error}",
                    path.display()
                )));
            }
        };

        self.workspace
            .open_document_from_source(path.to_path_buf(), source);
        if let Err(error) = self.persist_session() {
            return self.fail(error);
        }

        self.workspace.clear_error();
        Ok(path.to_path_buf())
    }

    pub fn active_document_has_external_modifications(&mut self) -> Result<bool, RuntimeError> {
        let Some(active_document) = self.workspace.active_document() else {
            self.workspace.clear_error();
            return Ok(false);
        };

        let Some(path) = active_document.backing_path().map(Path::to_path_buf) else {
            self.workspace.clear_error();
            return Ok(false);
        };
        let Some(synced_source) = active_document.synced_source().map(str::to_string) else {
            self.workspace.clear_error();
            return Ok(false);
        };

        let current_source = match read_document_source(&path) {
            Ok(current_source) => current_source,
            Err(error) => {
                self.workspace.set_last_error(error.to_string());
                return Err(error);
            }
        };
        let stale = current_source != synced_source;
        if !stale {
            self.workspace.clear_error();
        } else {
            self.workspace
                .set_last_error("Active document changed on disk".to_string());
        }
        Ok(stale)
    }

    pub fn active_document_disk_source(&mut self) -> Result<String, RuntimeError> {
        let Some(active_document) = self.workspace.active_document() else {
            self.workspace.clear_error();
            return Err(RuntimeError::new("No active document".to_string()));
        };

        let Some(path) = active_document.backing_path() else {
            self.workspace.clear_error();
            return Err(RuntimeError::new("Active document has no path".to_string()));
        };

        let source = match read_document_source(path) {
            Ok(source) => source,
            Err(error) => {
                self.workspace.set_last_error(error.to_string());
                return Err(error.into());
            }
        };

        self.workspace.clear_error();
        Ok(source)
    }

    fn recover_theme<T>(
        &mut self,
        theme: crate::ThemeSelection,
        error: RuntimeError,
    ) -> Result<T, RuntimeError> {
        self.workspace.set_theme(theme);
        let _ = self.persist_session();
        self.fail(error)
    }

    fn fail<T>(&mut self, error: RuntimeError) -> Result<T, RuntimeError> {
        self.workspace.set_last_error(error.to_string());
        Err(error)
    }
}
