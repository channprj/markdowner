use std::{fs, path::PathBuf};

use markdowner_core::{
    Block, Document, EditorMode, EditorRuntime, FileDialogOptions, Inline, MenuDescriptor,
    MenuItem, PlatformAdapter, ThemeKind, ThemeSelection, WindowDescriptor, WorkspaceState,
    apply_theme, parse_markdown, serialize_markdown,
};
use tempfile::tempdir;

#[test]
fn markdown_round_trip_covers_core_document_model() {
    let source = "# Title **Bold** *Italic*\n\nParagraph with [link](https://example.com) and `code`.\n\n> Quote with *style*\n\n- Bullet with **weight**\n\n- [x] done\n\n```rust\nfn main() {}\n```";

    let document = parse_markdown(source);

    assert_eq!(
        document.blocks(),
        &[
            Block::Heading {
                level: 1,
                text: vec![
                    Inline::Text("Title ".to_string()),
                    Inline::Bold(vec![Inline::Text("Bold".to_string())]),
                    Inline::Text(" ".to_string()),
                    Inline::Italic(vec![Inline::Text("Italic".to_string())]),
                ],
            },
            Block::Paragraph(vec![
                Inline::Text("Paragraph with ".to_string()),
                Inline::Link {
                    text: vec![Inline::Text("link".to_string())],
                    destination: "https://example.com".to_string(),
                },
                Inline::Text(" and ".to_string()),
                Inline::Code("code".to_string()),
                Inline::Text(".".to_string()),
            ]),
            Block::Quote(vec![
                Inline::Text("Quote with ".to_string()),
                Inline::Italic(vec![Inline::Text("style".to_string())]),
            ]),
            Block::BulletItem(vec![
                Inline::Text("Bullet with ".to_string()),
                Inline::Bold(vec![Inline::Text("weight".to_string())]),
            ]),
            Block::ChecklistItem {
                checked: true,
                text: vec![Inline::Text("done".to_string())],
            },
            Block::CodeFence {
                language: Some("rust".to_string()),
                code: "fn main() {}".to_string(),
            },
        ]
    );
    assert_eq!(serialize_markdown(&document), source);
}

#[test]
fn theme_application_is_pure_core_logic() {
    let document = Document::new(vec![Block::Paragraph(vec![Inline::Text(
        "Hello".to_string(),
    )])]);
    let styled = apply_theme(
        &document,
        &ThemeSelection::new(
            ThemeKind::CustomCss,
            Some("body { font-size: 18px; }".to_string()),
        ),
    );

    assert_eq!(styled.document(), &document);
    assert_eq!(
        styled.theme().stylesheet(),
        Some("body { font-size: 18px; }")
    );
    assert_eq!(styled.theme().palette().accent(), "#4c7fff");
}

#[test]
fn workspace_state_tracks_documents_without_ui_runtime() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/note.md");
    let document = Document::new(vec![Block::Paragraph(vec![Inline::Text(
        "Workspace".to_string(),
    )])]);

    workspace.open_document(path.clone(), document.clone());
    workspace.set_mode(EditorMode::Preview);

    assert_eq!(workspace.active_document_path(), Some(path.as_path()));
    assert_eq!(workspace.open_documents()[0].document(), &document);
    assert_eq!(workspace.recent_documents(), &[path]);
    assert_eq!(workspace.mode(), EditorMode::Preview);
}

#[test]
fn runtime_uses_platform_adapter_boundary_for_native_capabilities() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("from-dialog.md");
    let workspace_path = temp.path().join("workspace");
    fs::create_dir_all(&workspace_path).unwrap();
    fs::write(&document_path, "Opened via dialog").unwrap();

    let mut runtime = EditorRuntime::default();
    let mut adapter =
        RecordingAdapter::new(Some(document_path.clone()), Some(workspace_path.clone()));

    runtime.bootstrap_ui(&mut adapter);
    let opened = runtime.open_document_via(&mut adapter).unwrap();
    let folder = runtime.open_workspace_via(&mut adapter).unwrap();

    assert_eq!(opened.as_deref(), Some(document_path.as_path()));
    assert_eq!(folder.as_deref(), Some(workspace_path.as_path()));
    assert_eq!(
        adapter.window_requests,
        vec![WindowDescriptor::new("main", "Markdowner")]
    );
    assert_eq!(
        adapter.menu_requests,
        vec![MenuDescriptor::new(vec![
            MenuItem::new("open-document", "Open…"),
            MenuItem::new("open-workspace", "Open Folder…"),
        ])]
    );
    assert_eq!(
        adapter.file_requests,
        vec![FileDialogOptions::new(
            "Open Markdown",
            vec!["md".to_string()]
        )]
    );
}

#[test]
fn runtime_loads_markdown_contents_and_saves_active_document() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("daily.md");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "# Daily\n\nLoaded from disk").unwrap();

    let mut runtime = EditorRuntime::default().with_session_store(session_path);
    let mut adapter = RecordingAdapter::new(Some(document_path.clone()), None);

    let opened = runtime.open_document_via(&mut adapter).unwrap();

    assert_eq!(opened.as_deref(), Some(document_path.as_path()));
    assert_eq!(
        runtime.workspace().active_document().unwrap().document(),
        &parse_markdown("# Daily\n\nLoaded from disk")
    );
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Daily\n\nLoaded from disk"
    );

    runtime
        .replace_active_document(Document::new(vec![
            Block::Heading {
                level: 1,
                text: vec![Inline::Text("Updated".to_string())],
            },
            Block::Paragraph(vec![Inline::Text("Saved back to disk".to_string())]),
        ]))
        .unwrap();
    runtime.save_active_document().unwrap();

    assert_eq!(
        fs::read_to_string(&document_path).unwrap(),
        "# Updated\n\nSaved back to disk"
    );
}

#[test]
fn runtime_round_trips_rich_text_edits_after_save_and_reopen() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("rich.md");
    fs::write(&document_path, "Start").unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    let edited_document = Document::new(vec![
        Block::Heading {
            level: 2,
            text: vec![
                Inline::Text("Rich ".to_string()),
                Inline::Bold(vec![Inline::Text("Title".to_string())]),
            ],
        },
        Block::Paragraph(vec![
            Inline::Text("Visit ".to_string()),
            Inline::Link {
                text: vec![Inline::Text("docs".to_string())],
                destination: "https://example.com/docs".to_string(),
            },
            Inline::Text(" and use ".to_string()),
            Inline::Code("cargo test".to_string()),
        ]),
        Block::Quote(vec![
            Inline::Italic(vec![Inline::Text("Quoted".to_string())]),
            Inline::Text(" insight".to_string()),
        ]),
    ]);

    runtime
        .replace_active_document(edited_document.clone())
        .unwrap();
    runtime.save_active_document().unwrap();

    let mut reopened_runtime = EditorRuntime::default();
    reopened_runtime.open_document(&document_path).unwrap();

    assert_eq!(
        fs::read_to_string(&document_path).unwrap(),
        "## Rich **Title**\n\nVisit [docs](https://example.com/docs) and use `cargo test`\n\n> *Quoted* insight"
    );
    assert_eq!(
        reopened_runtime
            .workspace()
            .active_document()
            .unwrap()
            .document(),
        &edited_document
    );
}

#[test]
fn runtime_reparses_source_edits_for_rendered_modes() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("source.md");
    fs::write(&document_path, "Initial").unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    runtime.set_mode(EditorMode::Source);

    let source = "# Source **mode**\n\n- Item with [link](https://example.com)\n\n> `quoted`";
    runtime.replace_active_document_source(source).unwrap();

    runtime.set_mode(EditorMode::Preview);
    assert_eq!(
        runtime.workspace().active_document().unwrap().document(),
        &parse_markdown(source)
    );

    runtime.set_mode(EditorMode::Wysiwyg);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        source
    );
}

#[test]
fn runtime_restores_recent_documents_across_relaunches() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("recent.md");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "Recent").unwrap();

    let mut first_runtime = EditorRuntime::default().with_session_store(session_path.clone());
    let mut adapter = RecordingAdapter::new(Some(document_path.clone()), None);
    first_runtime.open_document_via(&mut adapter).unwrap();

    let mut second_runtime = EditorRuntime::default().with_session_store(session_path);
    second_runtime.restore_session().unwrap();

    assert_eq!(
        second_runtime.workspace().recent_documents(),
        std::slice::from_ref(&document_path)
    );
}

#[test]
fn runtime_reports_error_when_recent_document_is_missing() {
    let temp = tempdir().unwrap();
    let missing_path = temp.path().join("missing.md");
    let session_path = temp.path().join("session.json");
    let mut runtime = EditorRuntime::default().with_session_store(session_path);

    runtime
        .workspace_mut()
        .restore_recent_documents(vec![missing_path.clone()]);
    runtime.persist_session().unwrap();

    let error = runtime.open_recent_document(&missing_path).unwrap_err();

    assert!(error.to_string().contains("missing.md"));
    assert!(
        runtime
            .workspace()
            .last_error()
            .unwrap()
            .contains("missing.md")
    );
}

#[derive(Debug, Default)]
struct RecordingAdapter {
    next_file: Option<PathBuf>,
    next_folder: Option<PathBuf>,
    file_requests: Vec<FileDialogOptions>,
    folder_requests: Vec<String>,
    window_requests: Vec<WindowDescriptor>,
    menu_requests: Vec<MenuDescriptor>,
}

impl RecordingAdapter {
    fn new(next_file: Option<PathBuf>, next_folder: Option<PathBuf>) -> Self {
        Self {
            next_file,
            next_folder,
            ..Self::default()
        }
    }
}

impl PlatformAdapter for RecordingAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf> {
        self.file_requests.push(options.clone());
        self.next_file.clone()
    }

    fn open_folder(&mut self, title: &str) -> Option<PathBuf> {
        self.folder_requests.push(title.to_string());
        self.next_folder.clone()
    }

    fn present_window(&mut self, descriptor: &WindowDescriptor) {
        self.window_requests.push(descriptor.clone());
    }

    fn install_menu(&mut self, descriptor: &MenuDescriptor) {
        self.menu_requests.push(descriptor.clone());
    }
}
