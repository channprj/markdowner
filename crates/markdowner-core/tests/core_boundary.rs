use std::{fs, path::PathBuf};

use markdowner_core::{
    Block, Document, EditorMode, EditorRuntime, FileDialogOptions, Inline, InlineRevealRange,
    InlineRevealSelection, MenuDescriptor, MenuItem, PlatformAdapter, TableAlignment, TableRow,
    ThemeKind, ThemeSelection, WindowDescriptor, WorkspaceState, WysiwygBlockPresentation,
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
fn markdown_round_trip_covers_images_tables_and_checklists() {
    let source = "![Architecture](assets/diagram.png \"System Diagram\")\n\n| Task | Owner |\n| :--- | ---: |\n| Parser | Core |\n| Smoke | Shell |\n\n- [ ] Ship";

    let document = parse_markdown(source);

    assert_eq!(
        document.blocks(),
        &[
            Block::Image {
                alt: "Architecture".to_string(),
                source: "assets/diagram.png".to_string(),
                title: Some("System Diagram".to_string()),
            },
            Block::Table {
                headers: TableRow::new(vec![
                    vec![Inline::Text("Task".to_string())],
                    vec![Inline::Text("Owner".to_string())],
                ]),
                alignments: vec![TableAlignment::Left, TableAlignment::Right],
                rows: vec![
                    TableRow::new(vec![
                        vec![Inline::Text("Parser".to_string())],
                        vec![Inline::Text("Core".to_string())],
                    ]),
                    TableRow::new(vec![
                        vec![Inline::Text("Smoke".to_string())],
                        vec![Inline::Text("Shell".to_string())],
                    ]),
                ],
            },
            Block::ChecklistItem {
                checked: false,
                text: vec![Inline::Text("Ship".to_string())],
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
fn workspace_projects_preview_mode_as_a_styled_read_only_view() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/preview.md");
    let source = "# Preview\n\nStyled document";
    workspace.open_document_from_source(path, source);
    workspace.set_theme(ThemeSelection::new(
        ThemeKind::CustomCss,
        Some("body { color: tomato; }".to_string()),
    ));

    assert!(workspace.active_preview_document().is_none());

    workspace.set_mode(EditorMode::Preview);
    let preview = workspace.active_preview_document().unwrap();

    assert_eq!(preview.document(), &parse_markdown(source));
    assert_eq!(
        preview.theme().stylesheet(),
        Some("body { color: tomato; }")
    );
    assert_eq!(workspace.active_document().unwrap().source(), source);
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
            MenuItem::new("mode-wysiwyg", "WYSIWYG"),
            MenuItem::new("mode-source", "Source"),
            MenuItem::new("mode-preview", "Preview"),
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
fn runtime_edits_tables_and_toggles_checklists_through_wysiwyg_state() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("rich-structures.md");
    fs::write(
        &document_path,
        "| Task | Status |\n| --- | --- |\n| Docs | Draft |\n\n- [ ] Ship",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();

    runtime
        .replace_table_cell(0, 0, 1, vec![Inline::Text("Ready".to_string())])
        .unwrap();
    runtime.toggle_checklist_item(1).unwrap();
    runtime.save_active_document().unwrap();

    assert_eq!(
        fs::read_to_string(&document_path).unwrap(),
        "| Task | Status |\n| --- | --- |\n| Docs | Ready |\n\n- [x] Ship"
    );

    let mut reopened = EditorRuntime::default();
    reopened.open_document(&document_path).unwrap();

    assert_eq!(
        reopened.workspace().active_document().unwrap().document(),
        &Document::new(vec![
            Block::Table {
                headers: TableRow::new(vec![
                    vec![Inline::Text("Task".to_string())],
                    vec![Inline::Text("Status".to_string())],
                ]),
                alignments: vec![TableAlignment::None, TableAlignment::None],
                rows: vec![TableRow::new(vec![
                    vec![Inline::Text("Docs".to_string())],
                    vec![Inline::Text("Ready".to_string())],
                ])],
            },
            Block::ChecklistItem {
                checked: true,
                text: vec![Inline::Text("Ship".to_string())],
            },
        ])
    );
}

#[test]
fn workspace_projects_simple_images_and_tables_but_falls_back_for_complex_tables() {
    let mut workspace = WorkspaceState::default();
    let rendered_path = PathBuf::from("/tmp/rendered.md");
    let rendered_source =
        "![Diagram](assets/diagram.png)\n\n| Name | Value |\n| --- | --- |\n| Docs | Ready |";
    workspace.open_document_from_source(rendered_path, rendered_source);

    let rendered = workspace.active_wysiwyg_view().unwrap();
    assert!(matches!(
        rendered[0].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Image { .. })
    ));
    assert!(matches!(
        rendered[1].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Table { .. })
    ));

    let fallback_path = PathBuf::from("/tmp/fallback.md");
    let fallback_source = "| Name | Value |\n| --- |\n| Docs | Ready |";
    workspace.open_document_from_source(fallback_path, fallback_source);

    let fallback = workspace.active_wysiwyg_view().unwrap();
    assert!(matches!(
        fallback[0].presentation(),
        WysiwygBlockPresentation::RawFallback(source) if source == fallback_source
    ));
}

#[test]
fn runtime_projects_inline_reveal_only_around_the_active_edit_area() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("inline-reveal.md");
    fs::write(
        &document_path,
        "# Title\n\nParagraph with **bold** and `code`",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();

    let rendered = runtime.workspace().active_wysiwyg_view().unwrap();
    assert!(matches!(
        rendered[0].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Heading { .. })
    ));
    assert!(matches!(
        rendered[1].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Paragraph(_))
    ));

    let selection = InlineRevealSelection::new(1, Some(InlineRevealRange::new(15, 23)), 19);
    runtime.activate_inline_reveal(selection.clone()).unwrap();

    let revealed = runtime.workspace().active_wysiwyg_view().unwrap();
    assert!(matches!(
        revealed[0].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Heading { .. })
    ));
    assert!(matches!(
        revealed[1].presentation(),
        WysiwygBlockPresentation::Editing {
            source,
            selection: active_selection,
        } if source == "Paragraph with **bold** and `code`" && active_selection == &selection
    ));

    runtime.deactivate_inline_reveal().unwrap();

    let hidden = runtime.workspace().active_wysiwyg_view().unwrap();
    assert!(matches!(
        hidden[1].presentation(),
        WysiwygBlockPresentation::Rendered(Block::Paragraph(_))
    ));
    assert_eq!(
        runtime.workspace().last_inline_reveal_selection(),
        Some(&selection)
    );
}

#[test]
fn runtime_preserves_cursor_and_raw_fallback_during_inline_reveal_edits() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("inline-fallback.md");
    fs::write(&document_path, "Paragraph with **bold** and ~~strike~~").unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();

    runtime
        .activate_inline_reveal(InlineRevealSelection::new(
            0,
            Some(InlineRevealRange::new(15, 23)),
            19,
        ))
        .unwrap();
    runtime
        .edit_active_inline_reveal_source("Paragraph with **bolder** and ~~strike~~", 21)
        .unwrap();

    let editing = runtime.workspace().active_wysiwyg_view().unwrap();
    assert!(matches!(
        editing[0].presentation(),
        WysiwygBlockPresentation::Editing { source, selection }
            if source == "Paragraph with **bolder** and ~~strike~~"
                && selection.cursor_offset() == 21
    ));
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "Paragraph with **bolder** and ~~strike~~"
    );

    runtime.deactivate_inline_reveal().unwrap();

    let fallback = runtime.workspace().active_wysiwyg_view().unwrap();
    assert!(matches!(
        fallback[0].presentation(),
        WysiwygBlockPresentation::RawFallback(source)
            if source == "Paragraph with **bolder** and ~~strike~~"
    ));
    assert_eq!(
        runtime
            .workspace()
            .last_inline_reveal_selection()
            .unwrap()
            .cursor_offset(),
        21
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
fn runtime_restores_last_editor_mode_across_relaunches() {
    let temp = tempdir().unwrap();
    let session_path = temp.path().join("session.json");

    let mut first_runtime = EditorRuntime::default().with_session_store(session_path.clone());
    first_runtime.set_mode(EditorMode::Preview);

    let mut second_runtime = EditorRuntime::default().with_session_store(session_path);
    second_runtime.restore_session().unwrap();

    assert_eq!(second_runtime.workspace().mode(), EditorMode::Preview);
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
