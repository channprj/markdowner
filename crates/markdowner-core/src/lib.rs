mod document;
mod markdown;
mod platform;
pub mod storage;
mod theme;
mod workspace;

pub use document::{Block, Document, Inline, TableAlignment, TableRow};
pub use markdown::{parse_markdown, serialize_markdown};
pub use platform::{
    EditorRuntime, FileDialogOptions, MenuDescriptor, MenuItem, PlatformAdapter, RuntimeError,
    WindowDescriptor,
};
pub use theme::{
    AppliedTheme, CodeBlockStyleKind, CodeToken, CodeTokenKind, StyledCodeBlock, StyledDocument,
    ThemeKind, ThemePalette, ThemeSelection, apply_theme,
};
pub use workspace::{
    EditorMode, InlineRevealRange, InlineRevealSelection, OpenDocument, WorkspaceState,
    WysiwygBlockPresentation, WysiwygBlockView,
};
pub mod settings;

#[doc(hidden)]
pub mod storage_test_helpers {
    use std::{
        collections::BTreeMap,
        path::{Path, PathBuf},
    };

    use crate::{EditorMode, ThemeSelection, platform::RuntimeError, storage::CursorPosition};

    pub struct LoadedSession {
        pub recent_documents: Vec<PathBuf>,
        pub mode: EditorMode,
        pub theme: ThemeSelection,
        pub open_tabs: Vec<PathBuf>,
        pub active_tab_path: Option<PathBuf>,
        pub cursor_positions: BTreeMap<PathBuf, CursorPosition>,
    }

    pub fn load_workspace_session(path: &Path) -> Result<LoadedSession, RuntimeError> {
        let session = crate::storage::load_workspace_session(path)?;
        Ok(LoadedSession {
            recent_documents: session.recent_documents,
            mode: session.mode,
            theme: session.theme,
            open_tabs: session.open_tabs,
            active_tab_path: session.active_tab_path,
            cursor_positions: session.cursor_positions,
        })
    }

    pub fn persist_workspace_session_full(
        path: &Path,
        recent_documents: &[PathBuf],
        mode: EditorMode,
        theme: &ThemeSelection,
        open_tabs: &[PathBuf],
        active_tab_path: Option<PathBuf>,
        cursor_positions: &BTreeMap<PathBuf, CursorPosition>,
    ) -> Result<(), RuntimeError> {
        crate::storage::persist_workspace_session(
            path,
            recent_documents,
            mode,
            theme,
            open_tabs,
            active_tab_path.as_deref(),
            cursor_positions,
        )
    }
}
