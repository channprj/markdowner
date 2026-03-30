use std::path::{Path, PathBuf};

use markdowner_core::{
    Document, EditorMode, EditorRuntime, FileDialogOptions, MenuDescriptor, PlatformAdapter,
    RuntimeError, ThemeSelection, WindowDescriptor, WorkspaceState,
};

use crate::appkit_bridge::AppKitBridge;

#[derive(Debug, Default)]
pub struct MacPlatformAdapter {
    bridge: AppKitBridge,
}

impl MacPlatformAdapter {
    pub fn new() -> Self {
        Self {
            bridge: AppKitBridge::new(),
        }
    }

    pub fn with_next_file_selection(mut self, path: Option<PathBuf>) -> Self {
        self.bridge.set_next_file_selection(path);
        self
    }

    pub fn with_next_folder_selection(mut self, path: Option<PathBuf>) -> Self {
        self.bridge.set_next_folder_selection(path);
        self
    }

    #[cfg(test)]
    fn window_titles(&self) -> Vec<String> {
        self.bridge.window_titles()
    }

    #[cfg(test)]
    fn installed_menu_commands(&self) -> Vec<String> {
        self.bridge.installed_menu_commands().to_vec()
    }
}

impl PlatformAdapter for MacPlatformAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf> {
        self.bridge.choose_file(options)
    }

    fn open_folder(&mut self, title: &str) -> Option<PathBuf> {
        self.bridge.choose_folder(title)
    }

    fn present_window(&mut self, descriptor: &WindowDescriptor) {
        self.bridge.create_window(descriptor);
    }

    fn install_menu(&mut self, descriptor: &MenuDescriptor) {
        self.bridge.install_menu(descriptor);
    }
}

#[derive(Debug, Default)]
pub struct MacShell {
    runtime: EditorRuntime,
    adapter: MacPlatformAdapter,
}

impl MacShell {
    pub fn new(workspace: WorkspaceState) -> Self {
        Self {
            runtime: EditorRuntime::new(workspace),
            adapter: MacPlatformAdapter::new(),
        }
    }

    pub fn with_adapter(runtime: EditorRuntime, adapter: MacPlatformAdapter) -> Self {
        Self { runtime, adapter }
    }

    pub fn with_session_store_path(mut self, path: PathBuf) -> Self {
        self.runtime = self.runtime.with_session_store(path);
        self
    }

    pub fn bootstrap(&mut self) {
        self.runtime.bootstrap_ui(&mut self.adapter);
    }

    pub fn restore_session(&mut self) -> Result<(), RuntimeError> {
        self.runtime.restore_session()
    }

    pub fn request_document_open(&mut self) -> Result<Option<PathBuf>, RuntimeError> {
        self.runtime.open_document_via(&mut self.adapter)
    }

    pub fn request_document_save(&mut self) -> Result<PathBuf, RuntimeError> {
        self.runtime.save_active_document()
    }

    pub fn request_workspace_open(&mut self) -> Result<Option<PathBuf>, RuntimeError> {
        self.runtime.open_workspace_via(&mut self.adapter)
    }

    pub fn open_recent_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.runtime.open_recent_document(path)
    }

    pub fn open_workspace_document(&mut self, path: &Path) -> Result<PathBuf, RuntimeError> {
        self.runtime.open_workspace_document(path)
    }

    pub fn replace_active_document(&mut self, document: Document) -> Result<(), RuntimeError> {
        self.runtime.replace_active_document(document)
    }

    pub fn replace_active_document_source(
        &mut self,
        source: impl Into<String>,
    ) -> Result<(), RuntimeError> {
        self.runtime.replace_active_document_source(source)
    }

    pub fn set_mode(&mut self, mode: EditorMode) {
        self.runtime.set_mode(mode);
    }

    pub fn set_theme(&mut self, theme: ThemeSelection) {
        self.runtime.set_theme(theme);
    }

    pub fn workspace(&self) -> &WorkspaceState {
        self.runtime.workspace()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use markdowner_core::{
        Block, Document, EditorMode, Inline, ThemeKind, ThemeSelection, WorkspaceState,
        apply_theme, parse_markdown,
    };
    use tempfile::tempdir;

    use super::{EditorRuntime, MacPlatformAdapter, MacShell};

    #[test]
    fn mac_shell_keeps_appkit_details_behind_private_bridge() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("notes.md");
        let workspace_path = temp.path().join("workspace");
        fs::create_dir_all(&workspace_path).unwrap();
        fs::write(&document_path, "From bridge").unwrap();

        let adapter = MacPlatformAdapter::new()
            .with_next_file_selection(Some(document_path.clone()))
            .with_next_folder_selection(Some(workspace_path.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);

        shell.bootstrap();
        let document = shell.request_document_open().unwrap();
        let workspace = shell.request_workspace_open().unwrap();

        assert_eq!(document.as_deref(), Some(document_path.as_path()));
        assert_eq!(workspace.as_deref(), Some(workspace_path.as_path()));
        assert_eq!(
            shell.workspace().active_document_path(),
            Some(document_path.as_path())
        );
    }

    #[test]
    fn mac_platform_adapter_records_window_and_menu_requests() {
        let mut shell = MacShell::new(WorkspaceState::default());

        shell.bootstrap();

        assert_eq!(
            shell.adapter.window_titles(),
            vec!["Markdowner".to_string()]
        );
        assert_eq!(
            shell.adapter.installed_menu_commands(),
            vec!["open-document".to_string(), "open-workspace".to_string()]
        );
    }

    #[test]
    fn automated_ui_smoke_validates_app_launch() {
        let mut shell = MacShell::new(WorkspaceState::default());

        shell.bootstrap();

        assert_eq!(
            shell.adapter.window_titles(),
            vec!["Markdowner".to_string()]
        );
        assert_eq!(
            shell.adapter.installed_menu_commands(),
            vec!["open-document".to_string(), "open-workspace".to_string()]
        );
    }

    #[test]
    fn automated_ui_smoke_validates_opening_a_markdown_file() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("writer.md");
        fs::write(&document_path, "# Writer\n\nLoaded in editor").unwrap();

        let adapter =
            MacPlatformAdapter::new().with_next_file_selection(Some(document_path.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);

        let opened = shell.request_document_open().unwrap();

        assert_eq!(opened.as_deref(), Some(document_path.as_path()));
        assert_eq!(
            shell.workspace().active_document().unwrap().source(),
            "# Writer\n\nLoaded in editor"
        );
    }

    #[test]
    fn automated_ui_smoke_validates_opening_a_folder_and_navigating_the_file_tree() {
        let temp = tempdir().unwrap();
        let workspace_dir = temp.path().join("docs");
        let nested_dir = workspace_dir.join("guides");
        fs::create_dir_all(&nested_dir).unwrap();
        let root_doc = workspace_dir.join("README.md");
        let nested_doc = nested_dir.join("intro.md");
        fs::write(&root_doc, "# Root").unwrap();
        fs::write(&nested_doc, "# Intro").unwrap();
        fs::write(workspace_dir.join("ignore.txt"), "skip").unwrap();

        let adapter =
            MacPlatformAdapter::new().with_next_folder_selection(Some(workspace_dir.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);

        let opened = shell.request_workspace_open().unwrap();
        let navigated = shell.open_workspace_document(&nested_doc).unwrap();

        assert_eq!(opened.as_deref(), Some(workspace_dir.as_path()));
        assert_eq!(
            shell.workspace().workspace_documents(),
            &[root_doc.clone(), nested_doc.clone()]
        );
        assert_eq!(navigated, nested_doc);
        assert_eq!(
            shell.workspace().active_document().unwrap().document(),
            &Document::new(vec![Block::Heading {
                level: 1,
                text: vec![Inline::Text("Intro".to_string())],
            }])
        );
    }

    #[test]
    fn automated_ui_smoke_preserves_unsaved_document_state_while_navigating_workspace_files() {
        let temp = tempdir().unwrap();
        let workspace_dir = temp.path().join("docs");
        fs::create_dir_all(&workspace_dir).unwrap();
        let first_doc = workspace_dir.join("README.md");
        let second_doc = workspace_dir.join("guide.md");
        fs::write(&first_doc, "# Original").unwrap();
        fs::write(&second_doc, "# Guide").unwrap();

        let adapter =
            MacPlatformAdapter::new().with_next_folder_selection(Some(workspace_dir.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);

        shell.request_workspace_open().unwrap();
        shell.open_workspace_document(&first_doc).unwrap();
        shell
            .replace_active_document(Document::new(vec![Block::Heading {
                level: 1,
                text: vec![Inline::Text("Edited".to_string())],
            }]))
            .unwrap();

        assert!(shell.workspace().active_document().unwrap().is_dirty());

        shell.open_workspace_document(&second_doc).unwrap();
        shell.open_workspace_document(&first_doc).unwrap();

        let active_document = shell.workspace().active_document().unwrap();
        assert_eq!(active_document.source(), "# Edited");
        assert!(active_document.is_dirty());
    }

    #[test]
    fn automated_ui_smoke_validates_editing_formatted_content_in_wysiwyg() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("format.md");
        fs::write(&document_path, "Start").unwrap();

        let adapter =
            MacPlatformAdapter::new().with_next_file_selection(Some(document_path.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);
        shell.request_document_open().unwrap();

        shell
            .replace_active_document(Document::new(vec![
                Block::Heading {
                    level: 1,
                    text: vec![
                        Inline::Text("Formatted ".to_string()),
                        Inline::Bold(vec![Inline::Text("Title".to_string())]),
                    ],
                },
                Block::Paragraph(vec![
                    Inline::Text("Open ".to_string()),
                    Inline::Link {
                        text: vec![Inline::Text("docs".to_string())],
                        destination: "https://example.com".to_string(),
                    },
                    Inline::Text(" with ".to_string()),
                    Inline::Italic(vec![Inline::Text("style".to_string())]),
                    Inline::Text(" and ".to_string()),
                    Inline::Code("code".to_string()),
                ]),
                Block::BulletItem(vec![
                    Inline::Text("Bullet ".to_string()),
                    Inline::Bold(vec![Inline::Text("item".to_string())]),
                ]),
                Block::Quote(vec![
                    Inline::Text("Quote ".to_string()),
                    Inline::Italic(vec![Inline::Text("block".to_string())]),
                ]),
                Block::ChecklistItem {
                    checked: true,
                    text: vec![Inline::Text("Done".to_string())],
                },
                Block::CodeFence {
                    language: Some("rust".to_string()),
                    code: "fn main() {}".to_string(),
                },
            ]))
            .unwrap();
        shell.request_document_save().unwrap();

        assert_eq!(
            fs::read_to_string(&document_path).unwrap(),
            "# Formatted **Title**\n\nOpen [docs](https://example.com) with *style* and `code`\n\n- Bullet **item**\n\n> Quote *block*\n\n- [x] Done\n\n```rust\nfn main() {}\n```"
        );
        assert_eq!(shell.workspace().mode(), EditorMode::Wysiwyg);
    }

    #[test]
    fn automated_ui_smoke_validates_source_markdown_renders_in_wysiwyg_and_preview() {
        let temp = tempdir().unwrap();
        let document_path = temp.path().join("source-rich.md");
        fs::write(&document_path, "Start").unwrap();

        let adapter =
            MacPlatformAdapter::new().with_next_file_selection(Some(document_path.clone()));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);
        shell.request_document_open().unwrap();

        let source =
            "# Source **Heading**\n\n- Bullet with [link](https://example.com)\n\n> `quoted`";
        shell.set_mode(EditorMode::Source);
        shell.replace_active_document_source(source).unwrap();

        shell.set_mode(EditorMode::Preview);
        assert_eq!(
            shell.workspace().active_document().unwrap().document(),
            &parse_markdown(source)
        );

        shell.set_mode(EditorMode::Wysiwyg);
        assert_eq!(
            shell.workspace().active_document().unwrap().source(),
            source
        );
    }

    #[test]
    fn automated_ui_smoke_validates_toggling_modes_and_applying_themes() {
        let mut shell = MacShell::new(WorkspaceState::default());

        shell.set_mode(EditorMode::Source);
        assert_eq!(shell.workspace().mode(), EditorMode::Source);

        shell.set_mode(EditorMode::Preview);
        assert_eq!(shell.workspace().mode(), EditorMode::Preview);

        shell.set_mode(EditorMode::Wysiwyg);
        shell.set_theme(ThemeSelection::new(ThemeKind::BuiltInDark, None));
        let built_in = apply_theme(&Document::default(), shell.workspace().theme());
        assert_eq!(built_in.theme().palette().background(), "#14161a");

        shell.set_theme(ThemeSelection::new(
            ThemeKind::CustomCss,
            Some("body { color: tomato; }".to_string()),
        ));
        let imported = apply_theme(&Document::default(), shell.workspace().theme());
        assert_eq!(
            imported.theme().stylesheet(),
            Some("body { color: tomato; }")
        );
    }
}
