use std::{fs, path::PathBuf};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use markdowner_core::{
    Block, CodeBlockStyleKind, CodeTokenKind, Document, EditorMode, EditorRuntime,
    FileDialogOptions, Inline, InlineRevealRange, InlineRevealSelection, MenuDescriptor, MenuItem,
    PlatformAdapter, TableAlignment, TableRow, ThemeKind, ThemeSelection, WindowDescriptor,
    WorkspaceState, WysiwygBlockPresentation, apply_theme, parse_markdown, serialize_markdown,
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
fn theme_selection_can_track_imported_css_source_path() {
    let selection = ThemeSelection::imported(
        "/tmp/theme.css",
        "body { font-family: 'IBM Plex Sans'; color: #2a2a2a; }",
    );

    assert_eq!(selection.kind(), ThemeKind::CustomCss);
    assert_eq!(selection.stylesheet_path(), Some("/tmp/theme.css"));
    assert_eq!(
        selection.stylesheet(),
        Some("body { font-family: 'IBM Plex Sans'; color: #2a2a2a; }")
    );
}

#[test]
fn workspace_state_tracks_documents_without_ui_runtime() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/note.md");
    let document = Document::new(vec![Block::Paragraph(vec![Inline::Text(
        "Workspace".to_string(),
    )])]);

    workspace.open_document(path.clone(), document.clone());
    workspace.set_mode(EditorMode::SplitView);

    assert_eq!(workspace.active_document_path(), Some(path.as_path()));
    assert_eq!(workspace.open_documents()[0].document(), &document);
    assert_eq!(workspace.recent_documents(), &[path]);
    assert_eq!(workspace.mode(), EditorMode::SplitView);
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

    workspace.set_mode(EditorMode::SplitView);
    let preview = workspace.active_preview_document().unwrap();

    assert_eq!(preview.document(), &parse_markdown(source));
    assert_eq!(
        preview.theme().stylesheet(),
        Some("body { color: tomato; }")
    );
    assert_eq!(workspace.active_document().unwrap().source(), source);
}

#[test]
fn workspace_theme_changes_immediately_update_document_views_without_mutating_source() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/theme.md");
    let source = "```rust\nfn main() {}\n```";
    workspace.open_document_from_source(path, source);

    let light_wysiwyg = workspace.active_wysiwyg_view().unwrap();
    let light_code_background = light_wysiwyg[0]
        .code_block_style()
        .unwrap()
        .background()
        .to_string();

    workspace.set_theme(ThemeSelection::new(ThemeKind::BuiltInDark, None));
    let dark_wysiwyg = workspace.active_wysiwyg_view().unwrap();

    assert_eq!(workspace.active_document().unwrap().source(), source);
    assert_eq!(
        dark_wysiwyg[0].code_block_style().unwrap().background(),
        "#21252b"
    );
    assert_ne!(
        dark_wysiwyg[0].code_block_style().unwrap().background(),
        light_code_background
    );

    workspace.set_mode(EditorMode::SplitView);
    let dark_preview = workspace.active_preview_document().unwrap();
    assert_eq!(dark_preview.theme().palette().background(), "#14161a");
    assert_eq!(workspace.active_document().unwrap().source(), source);
}

#[test]
fn workspace_preview_uses_imported_css_typography_spacing_and_color_styles() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/custom-preview.md");
    workspace.open_document_from_source(path, "# Custom\n\nStyled");
    workspace.set_theme(ThemeSelection::imported(
        "/tmp/custom.css",
        "body { font-family: 'IBM Plex Sans'; line-height: 1.8; color: #223344; }",
    ));
    workspace.set_mode(EditorMode::SplitView);

    let preview = workspace.active_preview_document().unwrap();

    assert_eq!(
        preview.theme().stylesheet(),
        Some("body { font-family: 'IBM Plex Sans'; line-height: 1.8; color: #223344; }")
    );
}

#[test]
fn theme_application_highlights_known_code_fences_and_falls_back_to_plain_style() {
    let document = Document::new(vec![
        Block::CodeFence {
            language: Some("rust".to_string()),
            code: "fn main() {\n    println!(\"hi\");\n}".to_string(),
        },
        Block::CodeFence {
            language: None,
            code: "plain text".to_string(),
        },
        Block::CodeFence {
            language: Some("unknownlang".to_string()),
            code: "mystery()".to_string(),
        },
    ]);

    let styled = apply_theme(&document, &ThemeSelection::default());
    let rust = styled.code_block_style(0).unwrap();
    let plain = styled.code_block_style(1).unwrap();
    let unknown = styled.code_block_style(2).unwrap();

    assert_eq!(rust.style_kind(), CodeBlockStyleKind::SyntaxHighlighted);
    assert!(
        rust.lines()[0]
            .iter()
            .any(|token| token.kind() == CodeTokenKind::Keyword && token.text() == "fn")
    );
    assert_eq!(plain.style_kind(), CodeBlockStyleKind::Plain);
    assert!(
        plain.lines()[0]
            .iter()
            .all(|token| token.kind() == CodeTokenKind::Plain)
    );
    assert_eq!(unknown.style_kind(), CodeBlockStyleKind::Plain);
    assert!(
        unknown.lines()[0]
            .iter()
            .all(|token| token.kind() == CodeTokenKind::Plain)
    );
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
            MenuItem::new("mode-editor", "Editor"),
            MenuItem::new("mode-splitview", "Split-view"),
            MenuItem::new("theme-light", "Light Theme"),
            MenuItem::new("theme-dark", "Dark Theme"),
            MenuItem::new("theme-import-css", "Import CSS Theme…"),
        ])]
    );
    assert_eq!(
        adapter.file_requests,
        vec![FileDialogOptions::new(
            "Open Markdown",
            vec![
                "md".to_string(),
                "markdown".to_string(),
                "mdown".to_string(),
                "mkd".to_string(),
            ]
        )]
    );
}

#[test]
fn runtime_loads_markdown_contents_and_saves_active_document() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("daily.md");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "# Daily\n\nLoaded from disk").unwrap();
    #[cfg(unix)]
    let original_inode = fs::metadata(&document_path).unwrap().ino();

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
    #[cfg(unix)]
    assert_ne!(fs::metadata(&document_path).unwrap().ino(), original_inode);
}

#[cfg(unix)]
#[test]
fn runtime_save_preserves_read_only_file_failures_without_clobbering_existing_bytes() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("locked.md");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "# Locked\n\nOriginal").unwrap();
    let mut permissions = fs::metadata(&document_path).unwrap().permissions();
    permissions.set_mode(0o444);
    fs::set_permissions(&document_path, permissions).unwrap();

    let mut runtime = EditorRuntime::default().with_session_store(session_path);
    runtime.open_document(&document_path).unwrap();
    runtime
        .replace_active_document_source("# Locked\n\nEdited")
        .unwrap();

    let error = runtime.save_active_document().unwrap_err();

    assert!(error.to_string().contains("Could not write markdown file"));
    assert_eq!(
        fs::read_to_string(&document_path).unwrap(),
        "# Locked\n\nOriginal"
    );
    assert!(runtime.workspace().active_document().unwrap().is_dirty());
}

#[test]
fn runtime_detects_external_modifications_before_save() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("shared.md");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "# Original").unwrap();

    let mut runtime = EditorRuntime::default().with_session_store(session_path);
    runtime.open_document(&document_path).unwrap();
    fs::write(&document_path, "# Updated externally").unwrap();

    assert!(
        runtime
            .active_document_has_external_modifications()
            .unwrap()
    );
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Original"
    );
    assert_eq!(
        runtime
            .workspace()
            .active_document()
            .unwrap()
            .display_name(),
        "shared.md"
    );

    let error = runtime.save_active_document().unwrap_err();
    assert!(error.to_string().contains("because it has changed on disk"));
    assert!(!runtime.workspace().active_document().unwrap().is_dirty());
}

#[test]
fn runtime_save_as_writes_to_a_new_path_and_retargets_the_active_document() {
    let temp = tempdir().unwrap();
    let original_path = temp.path().join("draft.md");
    let copied_path = temp.path().join("copies").join("draft-copy.md");
    let session_path = temp.path().join("session.json");
    fs::write(&original_path, "# Draft\n\nOriginal").unwrap();

    let mut runtime = EditorRuntime::default().with_session_store(session_path);
    runtime.open_document(&original_path).unwrap();
    runtime
        .replace_active_document_source("# Draft\n\nCopied")
        .unwrap();

    runtime.save_active_document_as(&copied_path).unwrap();

    assert_eq!(
        fs::read_to_string(&original_path).unwrap(),
        "# Draft\n\nOriginal"
    );
    assert_eq!(
        fs::read_to_string(&copied_path).unwrap(),
        "# Draft\n\nCopied"
    );
    assert_eq!(
        runtime.workspace().active_document_path(),
        Some(copied_path.as_path())
    );
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Draft\n\nCopied"
    );
    assert!(!runtime.workspace().active_document().unwrap().is_dirty());
    assert_eq!(
        runtime.workspace().recent_documents(),
        &[copied_path, original_path]
    );
}

#[test]
fn runtime_new_document_stays_in_memory_until_saved_as() {
    let temp = tempdir().unwrap();
    let saved_path = temp.path().join("drafts").join("untitled.md");

    let mut runtime = EditorRuntime::default();
    runtime.new_document().unwrap();

    let active_document = runtime.workspace().active_document().unwrap();

    assert_eq!(runtime.workspace().active_document_path(), None);
    assert_eq!(active_document.display_name(), "Untitled.md");
    assert_eq!(active_document.source(), "");
    assert!(active_document.is_dirty());
    assert!(runtime.workspace().recent_documents().is_empty());

    runtime
        .replace_active_document_source("# Fresh draft\n\nStarted here")
        .unwrap();
    runtime.save_active_document_as(&saved_path).unwrap();

    assert_eq!(
        fs::read_to_string(&saved_path).unwrap(),
        "# Fresh draft\n\nStarted here"
    );
    assert_eq!(
        runtime.workspace().active_document_path(),
        Some(saved_path.as_path())
    );
}

#[test]
fn runtime_opens_workspace_from_explicit_path_without_platform_adapter() {
    let temp = tempdir().unwrap();
    let workspace_path = temp.path().join("workspace");
    let nested_path = workspace_path.join("nested");
    fs::create_dir_all(&nested_path).unwrap();
    let root_document = workspace_path.join("notes.md");
    let nested_document = nested_path.join("draft.md");
    fs::write(&root_document, "# Root").unwrap();
    fs::write(&nested_document, "# Nested").unwrap();

    let mut runtime = EditorRuntime::default();

    let opened = runtime.open_workspace(&workspace_path).unwrap();

    assert_eq!(opened, workspace_path);
    assert_eq!(
        runtime.workspace().root_dir(),
        Some(workspace_path.as_path())
    );
    assert_eq!(
        runtime.workspace().workspace_documents(),
        &[nested_document, root_document]
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
    runtime.set_mode(EditorMode::Editor);

    let source = "# Source **mode**\n\n- Item with [link](https://example.com)\n\n> `quoted`";
    runtime.replace_active_document_source(source).unwrap();

    runtime.set_mode(EditorMode::SplitView);
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
fn workspace_uses_the_same_code_block_styling_in_preview_and_wysiwyg() {
    let mut workspace = WorkspaceState::default();
    let path = PathBuf::from("/tmp/code-block.md");
    let source = "```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\n```unknownlang\nmystery()\n```\n\n```\nplain text\n```";
    workspace.open_document_from_source(path, source);

    let wysiwyg = workspace.active_wysiwyg_view().unwrap();

    workspace.set_mode(EditorMode::SplitView);
    let preview = workspace.active_preview_document().unwrap();
    let rust_wysiwyg = wysiwyg[0].code_block_style().unwrap().clone();
    let unknown_wysiwyg = wysiwyg[1].code_block_style().unwrap().clone();
    let plain_wysiwyg = wysiwyg[2].code_block_style().unwrap().clone();
    let rust_preview = preview.code_block_style(0).unwrap().clone();
    let unknown_preview = preview.code_block_style(1).unwrap().clone();
    let plain_preview = preview.code_block_style(2).unwrap().clone();

    assert_eq!(rust_wysiwyg, rust_preview);
    assert_eq!(unknown_wysiwyg, unknown_preview);
    assert_eq!(plain_wysiwyg, plain_preview);
    assert_eq!(
        rust_preview.style_kind(),
        CodeBlockStyleKind::SyntaxHighlighted
    );
    assert_eq!(unknown_preview.style_kind(), CodeBlockStyleKind::Plain);
    assert_eq!(plain_preview.style_kind(), CodeBlockStyleKind::Plain);
}

#[test]
fn runtime_preserves_code_fence_language_tags_across_save_and_reload() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("code-fence.md");
    fs::write(&document_path, "start").unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    runtime
        .replace_active_document(Document::new(vec![
            Block::CodeFence {
                language: Some("rust".to_string()),
                code: "fn main() {}".to_string(),
            },
            Block::CodeFence {
                language: Some("unknownlang".to_string()),
                code: "mystery()".to_string(),
            },
            Block::CodeFence {
                language: None,
                code: "plain text".to_string(),
            },
        ]))
        .unwrap();
    runtime.save_active_document().unwrap();

    let persisted = fs::read_to_string(&document_path).unwrap();
    assert_eq!(
        persisted,
        "```rust\nfn main() {}\n```\n\n```unknownlang\nmystery()\n```\n\n```\nplain text\n```"
    );

    let mut reopened = EditorRuntime::default();
    reopened.open_document(&document_path).unwrap();
    assert_eq!(
        reopened.workspace().active_document().unwrap().document(),
        &Document::new(vec![
            Block::CodeFence {
                language: Some("rust".to_string()),
                code: "fn main() {}".to_string(),
            },
            Block::CodeFence {
                language: Some("unknownlang".to_string()),
                code: "mystery()".to_string(),
            },
            Block::CodeFence {
                language: None,
                code: "plain text".to_string(),
            },
        ])
    );
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
    first_runtime.set_mode(EditorMode::SplitView);

    let mut second_runtime = EditorRuntime::default().with_session_store(session_path);
    second_runtime.restore_session().unwrap();

    assert_eq!(second_runtime.workspace().mode(), EditorMode::SplitView);
}

#[test]
fn runtime_restores_last_theme_across_relaunches() {
    let temp = tempdir().unwrap();
    let session_path = temp.path().join("session.json");

    let mut first_runtime = EditorRuntime::default().with_session_store(session_path.clone());
    first_runtime.set_theme(ThemeSelection::new(ThemeKind::BuiltInDark, None));

    let mut second_runtime = EditorRuntime::default().with_session_store(session_path);
    second_runtime.restore_session().unwrap();

    assert_eq!(
        second_runtime.workspace().theme(),
        &ThemeSelection::new(ThemeKind::BuiltInDark, None)
    );
}

#[test]
fn runtime_imports_custom_css_theme_from_disk_and_restores_it_after_relaunch() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("writer.css");
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        "body { font-family: 'IBM Plex Sans'; line-height: 1.7; color: #223344; }",
    )
    .unwrap();

    let mut first_runtime = EditorRuntime::default().with_session_store(session_path.clone());
    first_runtime.open_document(&document_path).unwrap();
    let imported_path = first_runtime.import_theme_from_path(&css_path).unwrap();

    assert_eq!(imported_path, css_path);
    assert_eq!(
        first_runtime.workspace().theme(),
        &ThemeSelection::imported(
            css_path.to_string_lossy(),
            "body { font-family: 'IBM Plex Sans'; line-height: 1.7; color: #223344; }",
        )
    );
    first_runtime.workspace_mut().set_mode(EditorMode::SplitView);
    let preview = first_runtime.workspace().active_preview_document().unwrap();
    assert_eq!(
        preview.theme().stylesheet(),
        Some("body { font-family: 'IBM Plex Sans'; line-height: 1.7; color: #223344; }")
    );

    let mut second_runtime = EditorRuntime::default().with_session_store(session_path);
    second_runtime.restore_session().unwrap();

    assert_eq!(
        second_runtime.workspace().theme(),
        &ThemeSelection::imported(
            css_path.to_string_lossy(),
            "body { font-family: 'IBM Plex Sans'; line-height: 1.7; color: #223344; }",
        )
    );
    assert_eq!(
        second_runtime.workspace().theme().stylesheet_path(),
        Some(css_path.to_string_lossy().as_ref())
    );
}

#[test]
fn runtime_preserves_existing_theme_when_imported_css_is_invalid() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("broken.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(&css_path, "body { color: tomato;").unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("broken.css"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
    assert!(
        runtime
            .workspace()
            .last_error()
            .unwrap()
            .contains("broken.css")
    );
}

#[test]
fn runtime_preserves_existing_custom_theme_when_imported_css_is_invalid() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let imported_path = temp.path().join("current.css");
    let invalid_path = temp.path().join("broken.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &imported_path,
        ".markdowner-content { color: rebeccapurple; }",
    )
    .unwrap();
    fs::write(&invalid_path, "body { color: tomato;").unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    runtime.import_theme_from_path(&imported_path).unwrap();
    let previous_theme = runtime.workspace().theme().clone();

    let error = runtime.import_theme_from_path(&invalid_path).unwrap_err();

    assert!(error.to_string().contains("broken.css"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_oversized_custom_css_theme_imports() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("oversized.css");
    fs::write(&document_path, "# Theme").unwrap();

    let oversized_css = format!(
        "body {{ color: #223344; }}\n/*{}*/",
        "a".repeat((256 * 1024) + 1)
    );
    fs::write(&css_path, oversized_css).unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("oversized.css"));
    assert!(error.to_string().contains("256 KB limit"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_import_rules() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("imported.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        "@import url(\"https://example.com/theme.css\");\nbody { color: tomato; }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("imported.css"));
    assert!(error.to_string().contains("@import"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_remote_urls() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("remote-url.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        "body { background-image: url(\"HTTPS://example.com/background.png\"); }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("remote-url.css"));
    assert!(error.to_string().contains("remote url()"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_fixed_positioning() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("fixed-position.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        ".markdowner-content .overlay { position: fixed; inset: 0; }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("fixed-position.css"));
    assert!(error.to_string().contains("position: fixed"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_sticky_positioning() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("sticky-position.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        ".markdowner-content .toolbar { position: sticky; top: 0; }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("sticky-position.css"));
    assert!(error.to_string().contains("position: sticky"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_high_z_index() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("high-z-index.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(&css_path, ".markdowner-content .overlay { z-index: 1001; }").unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("high-z-index.css"));
    assert!(error.to_string().contains("z-index: 1001"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_behavior_property() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("behavior.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        ".markdowner-content img { behavior: url(#default#download); }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("behavior.css"));
    assert!(error.to_string().contains("behavior"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
    );
}

#[test]
fn runtime_rejects_custom_css_theme_imports_with_expression_functions() {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join("theme.md");
    let css_path = temp.path().join("expression.css");
    fs::write(&document_path, "# Theme").unwrap();
    fs::write(
        &css_path,
        ".markdowner-content .panel { width: expression(alert('x')); }",
    )
    .unwrap();

    let mut runtime = EditorRuntime::default();
    let previous_theme = ThemeSelection::new(ThemeKind::BuiltInDark, None);
    runtime.workspace_mut().set_theme(previous_theme.clone());
    runtime.open_document(&document_path).unwrap();

    let error = runtime.import_theme_from_path(&css_path).unwrap_err();

    assert!(error.to_string().contains("expression.css"));
    assert!(error.to_string().contains("expression()"));
    assert_eq!(runtime.workspace().theme(), &previous_theme);
    assert_eq!(
        runtime.workspace().active_document().unwrap().source(),
        "# Theme"
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

#[test]
fn session_round_trips_open_tabs_and_active_tab_path() {
    let temp = tempdir().unwrap();
    let session_path = temp.path().join("session.json");

    // v4.0-style session: no open_tabs / active_tab_path. The loader must
    // tolerate the missing fields and report empty defaults.
    fs::write(
        &session_path,
        r#"{"recent_documents":["/tmp/a.md"],"mode":"Editor","theme":{"kind":"BuiltInDark","custom_css":null}}"#,
    )
    .unwrap();
    let loaded = markdowner_core::storage_test_helpers::load_workspace_session(&session_path)
        .expect("load v4.0 session");
    assert_eq!(loaded.open_tabs, Vec::<PathBuf>::new());
    assert_eq!(loaded.active_tab_path, None);
    assert_eq!(loaded.recent_documents, vec![PathBuf::from("/tmp/a.md")]);

    markdowner_core::storage_test_helpers::persist_workspace_session_full(
        &session_path,
        &[PathBuf::from("/tmp/a.md")],
        EditorMode::Editor,
        &ThemeSelection::default(),
        &[PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")],
        Some(PathBuf::from("/tmp/b.md")),
    )
    .expect("persist with tabs");
    let reloaded = markdowner_core::storage_test_helpers::load_workspace_session(&session_path)
        .expect("reload");
    assert_eq!(
        reloaded.open_tabs,
        vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")],
    );
    assert_eq!(
        reloaded.active_tab_path,
        Some(PathBuf::from("/tmp/b.md")),
    );
}

#[derive(Debug, Default)]
struct RecordingAdapter {
    next_files: std::collections::VecDeque<PathBuf>,
    next_folder: Option<PathBuf>,
    file_requests: Vec<FileDialogOptions>,
    folder_requests: Vec<String>,
    window_requests: Vec<WindowDescriptor>,
    menu_requests: Vec<MenuDescriptor>,
}

impl RecordingAdapter {
    fn new(next_file: Option<PathBuf>, next_folder: Option<PathBuf>) -> Self {
        let mut next_files = std::collections::VecDeque::new();
        if let Some(next_file) = next_file {
            next_files.push_back(next_file);
        }
        Self {
            next_files,
            next_folder,
            ..Self::default()
        }
    }
}

impl PlatformAdapter for RecordingAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf> {
        self.file_requests.push(options.clone());
        self.next_files.pop_front()
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
