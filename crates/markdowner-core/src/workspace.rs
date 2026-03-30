use std::path::{Path, PathBuf};

use crate::{Document, ThemeSelection, parse_markdown, serialize_markdown};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EditorMode {
    #[default]
    Wysiwyg,
    Source,
    Preview,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenDocument {
    path: PathBuf,
    document: Document,
    source: String,
    dirty: bool,
}

impl OpenDocument {
    pub fn new(path: PathBuf, document: Document) -> Self {
        let source = serialize_markdown(&document);
        Self {
            path,
            document,
            source,
            dirty: false,
        }
    }

    pub fn from_source(path: PathBuf, source: impl Into<String>) -> Self {
        let source = source.into();
        let document = parse_markdown(&source);
        Self {
            path,
            document,
            source,
            dirty: false,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    fn replace_document(&mut self, document: Document) {
        self.source = serialize_markdown(&document);
        self.document = document;
        self.dirty = true;
    }

    fn replace_source(&mut self, source: impl Into<String>) {
        let source = source.into();
        self.document = parse_markdown(&source);
        self.source = source;
        self.dirty = true;
    }

    fn mark_saved(&mut self) {
        self.dirty = false;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorkspaceState {
    root_dir: Option<PathBuf>,
    workspace_documents: Vec<PathBuf>,
    open_documents: Vec<OpenDocument>,
    recent_documents: Vec<PathBuf>,
    active_document: Option<PathBuf>,
    theme: ThemeSelection,
    mode: EditorMode,
    last_error: Option<String>,
}

impl WorkspaceState {
    pub fn set_root_dir(&mut self, root_dir: PathBuf) {
        self.root_dir = Some(root_dir);
        self.workspace_documents.clear();
    }

    pub fn root_dir(&self) -> Option<&Path> {
        self.root_dir.as_deref()
    }

    pub fn set_workspace_documents(&mut self, root_dir: PathBuf, documents: Vec<PathBuf>) {
        self.root_dir = Some(root_dir);
        self.workspace_documents = documents;
    }

    pub fn workspace_documents(&self) -> &[PathBuf] {
        &self.workspace_documents
    }

    pub fn open_document(&mut self, path: PathBuf, document: Document) {
        self.upsert_open_document(OpenDocument::new(path.clone(), document));
        self.remember_recent(path);
        self.clear_error();
    }

    pub fn open_document_from_source(&mut self, path: PathBuf, source: impl Into<String>) {
        self.upsert_open_document(OpenDocument::from_source(path.clone(), source));
        self.remember_recent(path);
        self.clear_error();
    }

    pub fn activate_open_document(&mut self, path: &Path) -> bool {
        if self
            .open_documents
            .iter()
            .all(|document| document.path() != path)
        {
            return false;
        }

        let path = path.to_path_buf();
        self.active_document = Some(path.clone());
        self.remember_recent(path);
        self.clear_error();
        true
    }

    pub fn open_documents(&self) -> &[OpenDocument] {
        &self.open_documents
    }

    pub fn recent_documents(&self) -> &[PathBuf] {
        &self.recent_documents
    }

    pub fn active_document_path(&self) -> Option<&Path> {
        self.active_document.as_deref()
    }

    pub fn active_document(&self) -> Option<&OpenDocument> {
        let active_document = self.active_document.as_ref()?;

        self.open_documents
            .iter()
            .find(|document| document.path() == active_document.as_path())
    }

    pub fn set_mode(&mut self, mode: EditorMode) {
        self.mode = mode;
    }

    pub fn mode(&self) -> EditorMode {
        self.mode
    }

    pub fn set_theme(&mut self, theme: ThemeSelection) {
        self.theme = theme;
    }

    pub fn theme(&self) -> &ThemeSelection {
        &self.theme
    }

    pub fn remember_recent(&mut self, path: PathBuf) {
        self.recent_documents.retain(|existing| existing != &path);
        self.recent_documents.insert(0, path);
    }

    pub fn restore_recent_documents(&mut self, recent_documents: Vec<PathBuf>) {
        self.recent_documents.clear();

        for path in recent_documents {
            if self
                .recent_documents
                .iter()
                .all(|existing| existing != &path)
            {
                self.recent_documents.push(path);
            }
        }
    }

    pub fn replace_active_document(&mut self, document: Document) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        active_document.replace_document(document);
        self.clear_error();
        true
    }

    pub fn replace_active_document_source(&mut self, source: impl Into<String>) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        active_document.replace_source(source);
        self.clear_error();
        true
    }

    pub fn mark_active_document_saved(&mut self) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        active_document.mark_saved();
        true
    }

    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    pub fn set_last_error(&mut self, message: impl Into<String>) {
        self.last_error = Some(message.into());
    }

    pub fn clear_error(&mut self) {
        self.last_error = None;
    }

    fn active_document_mut(&mut self) -> Option<&mut OpenDocument> {
        let active_document = self.active_document.clone()?;

        self.open_documents
            .iter_mut()
            .find(|document| document.path() == active_document.as_path())
    }

    fn upsert_open_document(&mut self, open_document: OpenDocument) {
        let active_path = open_document.path().to_path_buf();

        if let Some(existing) = self
            .open_documents
            .iter_mut()
            .find(|existing| existing.path() == active_path.as_path())
        {
            *existing = open_document;
        } else {
            self.open_documents.push(open_document);
        }

        self.active_document = Some(active_path);
    }
}
