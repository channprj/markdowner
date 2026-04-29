use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    Block, Document, Inline, StyledCodeBlock, StyledDocument, ThemeSelection, apply_theme,
    markdown::{serialize_block, split_markdown_blocks},
    parse_markdown, serialize_markdown,
    storage::is_markdown_file,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
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
    inline_reveal_selection: Option<InlineRevealSelection>,
    last_inline_reveal_selection: Option<InlineRevealSelection>,
}

impl OpenDocument {
    pub fn new(path: PathBuf, document: Document) -> Self {
        let source = serialize_markdown(&document);
        Self {
            path,
            document,
            source,
            dirty: false,
            inline_reveal_selection: None,
            last_inline_reveal_selection: None,
        }
    }

    pub fn from_source(path: PathBuf, source: impl Into<String>) -> Self {
        let source = normalize_source(source.into());
        let document = parse_markdown(&source);
        Self {
            path,
            document,
            source,
            dirty: false,
            inline_reveal_selection: None,
            last_inline_reveal_selection: None,
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

    pub fn active_wysiwyg_view(&self, theme: &ThemeSelection) -> Vec<WysiwygBlockView> {
        let source_blocks = split_markdown_blocks(&self.source);
        let rendered_blocks = self.document.blocks();
        let styled_document = apply_theme(&self.document, theme);
        let len = source_blocks.len().max(rendered_blocks.len());

        (0..len)
            .map(|block_index| {
                let presentation = if self
                    .inline_reveal_selection
                    .as_ref()
                    .is_some_and(|selection| selection.block_index() == block_index)
                {
                    WysiwygBlockPresentation::Editing {
                        source: source_blocks
                            .get(block_index)
                            .cloned()
                            .or_else(|| rendered_blocks.get(block_index).map(serialize_block))
                            .unwrap_or_default(),
                        selection: self
                            .inline_reveal_selection
                            .clone()
                            .expect("checked by is_some_and"),
                    }
                } else if let Some(source_block) = source_blocks.get(block_index) {
                    if let Some(rendered_block) = rendered_blocks.get(block_index) {
                        if requires_raw_fallback(source_block, rendered_block) {
                            WysiwygBlockPresentation::RawFallback(source_block.clone())
                        } else {
                            WysiwygBlockPresentation::Rendered(rendered_block.clone())
                        }
                    } else {
                        WysiwygBlockPresentation::RawFallback(source_block.clone())
                    }
                } else {
                    WysiwygBlockPresentation::Rendered(
                        rendered_blocks
                            .get(block_index)
                            .expect("len derived from rendered blocks")
                            .clone(),
                    )
                };

                let code_block_style = if matches!(
                    &presentation,
                    WysiwygBlockPresentation::Rendered(Block::CodeFence { .. })
                ) {
                    styled_document.code_block_style(block_index).cloned()
                } else {
                    None
                };

                WysiwygBlockView::new(block_index, presentation, code_block_style)
            })
            .collect()
    }

    pub fn inline_reveal_selection(&self) -> Option<&InlineRevealSelection> {
        self.inline_reveal_selection.as_ref()
    }

    pub fn last_inline_reveal_selection(&self) -> Option<&InlineRevealSelection> {
        self.last_inline_reveal_selection.as_ref()
    }

    fn replace_document(&mut self, document: Document) {
        self.source = serialize_markdown(&document);
        self.document = document;
        self.dirty = true;
        self.inline_reveal_selection = None;
        self.last_inline_reveal_selection = None;
    }

    fn replace_source(&mut self, source: impl Into<String>) {
        let source = normalize_source(source.into());
        self.document = parse_markdown(&source);
        self.source = source;
        self.dirty = true;
        self.inline_reveal_selection = None;
        self.last_inline_reveal_selection = None;
    }

    fn activate_inline_reveal(&mut self, selection: InlineRevealSelection) -> bool {
        let source_blocks = split_markdown_blocks(&self.source);
        let Some(source_block) = source_blocks.get(selection.block_index()) else {
            return false;
        };

        let selection = selection.clamp_to_block(source_block.len());
        self.last_inline_reveal_selection = Some(selection.clone());
        self.inline_reveal_selection = Some(selection);
        true
    }

    fn deactivate_inline_reveal(&mut self) -> bool {
        let Some(selection) = self.inline_reveal_selection.take() else {
            return false;
        };

        self.last_inline_reveal_selection = Some(selection);
        true
    }

    fn edit_active_inline_reveal_source(
        &mut self,
        source: impl Into<String>,
        cursor_offset: usize,
    ) -> bool {
        let Some(selection) = self.inline_reveal_selection.clone() else {
            return false;
        };
        let mut source_blocks = split_markdown_blocks(&self.source);
        let Some(existing_block) = source_blocks.get_mut(selection.block_index()) else {
            return false;
        };

        let replacement = normalize_source(source.into());
        *existing_block = replacement.clone();
        let replacement_len = replacement.len();
        let replacement_selection = selection.with_cursor_offset(cursor_offset, replacement_len);

        self.replace_source(source_blocks.join("\n\n"));
        self.inline_reveal_selection = Some(replacement_selection.clone());
        self.last_inline_reveal_selection = Some(replacement_selection);
        true
    }

    fn mark_saved(&mut self) {
        self.dirty = false;
    }

    fn save_as(&mut self, path: PathBuf) {
        self.path = path;
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

    pub fn active_wysiwyg_view(&self) -> Option<Vec<WysiwygBlockView>> {
        Some(self.active_document()?.active_wysiwyg_view(self.theme()))
    }

    pub fn active_preview_document(&self) -> Option<StyledDocument> {
        if self.mode != EditorMode::Preview {
            return None;
        }

        Some(apply_theme(
            self.active_document()?.document(),
            self.theme(),
        ))
    }

    pub fn active_inline_reveal_selection(&self) -> Option<&InlineRevealSelection> {
        self.active_document()?.inline_reveal_selection()
    }

    pub fn last_inline_reveal_selection(&self) -> Option<&InlineRevealSelection> {
        self.active_document()?.last_inline_reveal_selection()
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

    pub fn toggle_checklist_item(&mut self, block_index: usize) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        let mut blocks = active_document.document().blocks().to_vec();
        let Some(Block::ChecklistItem { checked, .. }) = blocks.get_mut(block_index) else {
            return false;
        };

        *checked = !*checked;
        active_document.replace_document(Document::new(blocks));
        self.clear_error();
        true
    }

    pub fn replace_table_cell(
        &mut self,
        block_index: usize,
        row_index: usize,
        column_index: usize,
        cell: Vec<Inline>,
    ) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        let mut blocks = active_document.document().blocks().to_vec();
        let Some(Block::Table { rows, .. }) = blocks.get_mut(block_index) else {
            return false;
        };
        let Some(row) = rows.get_mut(row_index) else {
            return false;
        };
        let Some(target_cell) = row.cells_mut().get_mut(column_index) else {
            return false;
        };

        *target_cell = cell;
        active_document.replace_document(Document::new(blocks));
        self.clear_error();
        true
    }

    pub fn activate_inline_reveal(&mut self, selection: InlineRevealSelection) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        if !active_document.activate_inline_reveal(selection) {
            return false;
        }

        self.clear_error();
        true
    }

    pub fn deactivate_inline_reveal(&mut self) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        if !active_document.deactivate_inline_reveal() {
            return false;
        }

        self.clear_error();
        true
    }

    pub fn edit_active_inline_reveal_source(
        &mut self,
        source: impl Into<String>,
        cursor_offset: usize,
    ) -> bool {
        let Some(active_document) = self.active_document_mut() else {
            return false;
        };

        if !active_document.edit_active_inline_reveal_source(source, cursor_offset) {
            return false;
        }

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

    pub fn save_active_document_as(&mut self, path: PathBuf) -> bool {
        let Some(active_path) = self.active_document.clone() else {
            return false;
        };
        let Some(mut active_index) = self
            .open_documents
            .iter()
            .position(|document| document.path() == active_path.as_path())
        else {
            return false;
        };

        if let Some(existing_index) = self
            .open_documents
            .iter()
            .position(|document| document.path() == path.as_path())
        {
            if existing_index != active_index {
                self.open_documents.remove(existing_index);
                if existing_index < active_index {
                    active_index -= 1;
                }
            }
        }

        self.open_documents[active_index].save_as(path.clone());
        self.active_document = Some(path.clone());

        if self
            .root_dir
            .as_ref()
            .is_some_and(|root_dir| path.starts_with(root_dir) && is_markdown_file(path.as_path()))
            && self
                .workspace_documents
                .iter()
                .all(|document| document != &path)
        {
            self.workspace_documents.push(path.clone());
            self.workspace_documents.sort();
        }

        self.remember_recent(path);
        self.clear_error();
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineRevealRange {
    start: usize,
    end: usize,
}

impl InlineRevealRange {
    pub fn new(start: usize, end: usize) -> Self {
        Self {
            start,
            end: end.max(start),
        }
    }

    pub fn start(&self) -> usize {
        self.start
    }

    pub fn end(&self) -> usize {
        self.end
    }

    fn clamp(&self, len: usize) -> Self {
        let start = self.start.min(len);
        let end = self.end.min(len).max(start);
        Self { start, end }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineRevealSelection {
    block_index: usize,
    range: Option<InlineRevealRange>,
    cursor_offset: usize,
}

impl InlineRevealSelection {
    pub fn new(block_index: usize, range: Option<InlineRevealRange>, cursor_offset: usize) -> Self {
        Self {
            block_index,
            range,
            cursor_offset,
        }
    }

    pub fn block_index(&self) -> usize {
        self.block_index
    }

    pub fn range(&self) -> Option<&InlineRevealRange> {
        self.range.as_ref()
    }

    pub fn cursor_offset(&self) -> usize {
        self.cursor_offset
    }

    fn clamp_to_block(&self, block_len: usize) -> Self {
        Self {
            block_index: self.block_index,
            range: self.range.as_ref().map(|range| range.clamp(block_len)),
            cursor_offset: self.cursor_offset.min(block_len),
        }
    }

    fn with_cursor_offset(&self, cursor_offset: usize, block_len: usize) -> Self {
        Self {
            block_index: self.block_index,
            range: self.range.as_ref().map(|range| range.clamp(block_len)),
            cursor_offset: cursor_offset.min(block_len),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WysiwygBlockPresentation {
    Rendered(Block),
    Editing {
        source: String,
        selection: InlineRevealSelection,
    },
    RawFallback(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WysiwygBlockView {
    block_index: usize,
    presentation: WysiwygBlockPresentation,
    code_block_style: Option<StyledCodeBlock>,
}

impl WysiwygBlockView {
    fn new(
        block_index: usize,
        presentation: WysiwygBlockPresentation,
        code_block_style: Option<StyledCodeBlock>,
    ) -> Self {
        Self {
            block_index,
            presentation,
            code_block_style,
        }
    }

    pub fn block_index(&self) -> usize {
        self.block_index
    }

    pub fn presentation(&self) -> &WysiwygBlockPresentation {
        &self.presentation
    }

    pub fn code_block_style(&self) -> Option<&StyledCodeBlock> {
        self.code_block_style.as_ref()
    }
}

fn normalize_source(source: String) -> String {
    source.replace("\r\n", "\n")
}

fn requires_raw_fallback(source_block: &str, rendered_block: &Block) -> bool {
    contains_unsupported_markdown(source_block)
        || looks_like_unsupported_image(source_block, rendered_block)
        || looks_like_unsupported_table(source_block, rendered_block)
        || serialize_block(rendered_block) != source_block
}

fn contains_unsupported_markdown(source_block: &str) -> bool {
    source_block.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.contains("~~")
            || trimmed.contains("[^")
            || trimmed.starts_with("---")
            || trimmed.starts_with("***")
            || trimmed.starts_with('<')
            || is_ordered_list_item(trimmed)
            || has_indented_list_prefix(line)
    })
}

fn looks_like_unsupported_image(source_block: &str, rendered_block: &Block) -> bool {
    source_block.lines().count() == 1
        && source_block.trim().starts_with("![")
        && !matches!(rendered_block, Block::Image { .. })
}

fn looks_like_unsupported_table(source_block: &str, rendered_block: &Block) -> bool {
    let lines: Vec<&str> = source_block.lines().collect();
    lines.len() >= 2
        && lines
            .iter()
            .all(|line| line.trim().starts_with('|') && line.trim().ends_with('|'))
        && !matches!(rendered_block, Block::Table { .. })
}

fn is_ordered_list_item(line: &str) -> bool {
    let digits = line
        .bytes()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    digits > 0
        && line
            .as_bytes()
            .get(digits..digits + 2)
            .is_some_and(|suffix| suffix == b". ")
}

fn has_indented_list_prefix(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.len() != line.len()
        && (trimmed.starts_with("- ") || trimmed.starts_with("> ") || is_ordered_list_item(trimmed))
}
