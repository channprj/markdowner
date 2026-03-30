use std::{
    error::Error,
    fmt::{self, Display, Formatter},
    path::{Path, PathBuf},
};

use crate::{
    Document, WorkspaceState,
    storage::{
        list_markdown_files, load_recent_documents, persist_recent_documents, read_document_source,
        write_document_source,
    },
};

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

    pub fn bootstrap_ui(&mut self, adapter: &mut impl PlatformAdapter) {
        adapter.present_window(&WindowDescriptor::new("main", "Markdowner"));
        adapter.install_menu(&MenuDescriptor::new(vec![
            MenuItem::new("open-document", "Open…"),
            MenuItem::new("open-workspace", "Open Folder…"),
        ]));
    }

    pub fn restore_session(&mut self) -> Result<(), RuntimeError> {
        let Some(session_store) = self.session_store.clone() else {
            return Ok(());
        };

        let recent_documents = match load_recent_documents(&session_store) {
            Ok(recent_documents) => recent_documents,
            Err(error) => return self.fail(error),
        };
        self.workspace.restore_recent_documents(recent_documents);
        self.workspace.clear_error();
        Ok(())
    }

    pub fn persist_session(&mut self) -> Result<(), RuntimeError> {
        let Some(session_store) = self.session_store.clone() else {
            return Ok(());
        };

        match persist_recent_documents(&session_store, self.workspace.recent_documents()) {
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
            vec!["md".to_string()],
        )) else {
            return Ok(None);
        };

        self.open_document(&path).map(Some)
    }

    pub fn open_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.open_document_with_message(path, "Could not open document")
    }

    pub fn open_recent_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.open_document_with_message(path, "Could not open recent document")
    }

    pub fn save_active_document(&mut self) -> Result<PathBuf, RuntimeError> {
        let Some(active_document) = self.workspace.active_document() else {
            return self.fail(RuntimeError::new(
                "Could not save document because no document is open",
            ));
        };
        let path = active_document.path().to_path_buf();
        let source = active_document.source().to_string();

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

    pub fn replace_active_document(&mut self, document: Document) -> Result<(), RuntimeError> {
        if self.workspace.replace_active_document(document) {
            Ok(())
        } else {
            self.fail(RuntimeError::new(
                "Could not edit document because no document is open",
            ))
        }
    }

    pub fn set_mode(&mut self, mode: crate::EditorMode) {
        self.workspace.set_mode(mode);
    }

    pub fn set_theme(&mut self, theme: crate::ThemeSelection) {
        self.workspace.set_theme(theme);
    }

    pub fn open_workspace_via(
        &mut self,
        adapter: &mut impl PlatformAdapter,
    ) -> Result<Option<PathBuf>, RuntimeError> {
        let Some(path) = adapter.open_folder("Open Workspace") else {
            return Ok(None);
        };
        let documents = match list_markdown_files(&path) {
            Ok(documents) => documents,
            Err(error) => return self.fail(error),
        };

        self.workspace
            .set_workspace_documents(path.clone(), documents);
        self.workspace.clear_error();
        Ok(Some(path))
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

    fn fail<T>(&mut self, error: RuntimeError) -> Result<T, RuntimeError> {
        self.workspace.set_last_error(error.to_string());
        Err(error)
    }
}
