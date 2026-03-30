mod document;
mod markdown;
mod platform;
mod storage;
mod theme;
mod workspace;

pub use document::{Block, Document, Inline};
pub use markdown::{parse_markdown, serialize_markdown};
pub use platform::{
    EditorRuntime, FileDialogOptions, MenuDescriptor, MenuItem, PlatformAdapter, RuntimeError,
    WindowDescriptor,
};
pub use theme::{
    AppliedTheme, StyledDocument, ThemeKind, ThemePalette, ThemeSelection, apply_theme,
};
pub use workspace::{EditorMode, OpenDocument, WorkspaceState};
