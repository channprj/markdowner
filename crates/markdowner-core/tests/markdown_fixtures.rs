use std::{
    fs,
    path::{Path, PathBuf},
};

use markdowner_core::{
    EditorMode, EditorRuntime, ThemeKind, ThemeSelection, WysiwygBlockPresentation,
    ai_document::{
        AiDocumentEnvelope, ByteRange, MarkdownBlockKind, OperationKind, ProtectedKind,
        ProtectionPolicy, SelectionResponse, ValidationIssueCode, markdown_block_ranges,
        validate_full_replacement, validate_markdown_fragment, validate_markdown_insertion,
        validate_selection_response,
    },
    parse_markdown, serialize_markdown,
};
use serde::Deserialize;
use tempfile::tempdir;

fn assert_fully_protected_selection(
    document_id: impl Into<String>,
    source: &str,
    selection: ByteRange,
    expected_kind: ProtectedKind,
) {
    let envelope = AiDocumentEnvelope::new(document_id, source, Some(selection))
        .expect("protected intersections must preserve the exact selection");
    assert_eq!(envelope.scope(), selection);
    assert!(!envelope.selection_has_editable_bytes());
    assert_eq!(envelope.reconstruct_original().unwrap(), source);
    assert!(envelope.protected.iter().any(|token| {
        token.kind == expected_kind
            && token.range == selection
            && token.original == source[selection.start..selection.end]
    }));
}

#[derive(Debug, Deserialize)]
struct FixtureSpec {
    id: String,
    category: String,
    source: String,
    expected: String,
    policy: FixturePolicy,
    #[serde(default)]
    release_gate: Vec<ReleaseGate>,
    #[serde(default)]
    session: Option<SessionExpectations>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
enum FixturePolicy {
    #[serde(rename = "byte-for-byte")]
    ByteForByte,
    #[serde(rename = "canonical-equivalent")]
    CanonicalEquivalent,
    #[serde(rename = "raw-preserved")]
    RawPreserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum ReleaseGate {
    #[serde(rename = "v0.2")]
    V0_2,
    #[serde(rename = "v1.0")]
    V1_0,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct SessionExpectations {
    restore_recent_documents: bool,
    restored_mode: Option<EditorMode>,
    restored_theme_kind: Option<ThemeKind>,
}

#[test]
fn markdown_fixtures_cover_seed_v0_policies() {
    let fixtures = load_fixture_catalog();
    assert!(
        fixtures.len() >= 6,
        "expected at least six seed fixtures, found {}",
        fixtures.len()
    );

    for fixture in fixtures {
        run_fixture(&fixture);
    }
}

#[test]
fn markdown_fixtures_include_v0_code_fence_image_and_unsupported_seed_coverage() {
    let fixtures = load_fixture_catalog();
    let heading_fixtures = count_category_fixtures_for_release(
        &fixtures,
        "headings-and-paragraphs",
        ReleaseGate::V0_2,
    );
    let inline_fixtures =
        count_category_fixtures_for_release(&fixtures, "inline-formatting", ReleaseGate::V0_2);
    let quote_fixtures =
        count_category_fixtures_for_release(&fixtures, "quotes", ReleaseGate::V0_2);
    let code_fence_fixtures =
        count_category_fixtures_for_release(&fixtures, "code-fences", ReleaseGate::V0_2);
    let image_fixtures =
        count_category_fixtures_for_release(&fixtures, "images", ReleaseGate::V0_2);
    let list_fixtures =
        count_category_fixtures_for_release(&fixtures, "lists-and-checklists", ReleaseGate::V0_2);
    let table_fixtures =
        count_category_fixtures_for_release(&fixtures, "tables", ReleaseGate::V0_2);
    let unsupported_fixtures =
        count_category_fixtures_for_release(&fixtures, "unsupported", ReleaseGate::V0_2);
    let workspace_session_fixtures =
        count_category_fixtures_for_release(&fixtures, "workspace-and-session", ReleaseGate::V0_2);

    assert!(
        heading_fixtures >= 4,
        "expected at least four v0.2 headings-and-paragraphs fixtures, found {}",
        heading_fixtures
    );
    assert!(
        inline_fixtures >= 5,
        "expected at least five v0.2 inline-formatting fixtures, found {}",
        inline_fixtures
    );
    assert!(
        quote_fixtures >= 2,
        "expected at least two v0.2 quote fixtures, found {}",
        quote_fixtures
    );
    assert!(
        code_fence_fixtures >= 4,
        "expected at least four v0.2 code-fence fixtures, found {}",
        code_fence_fixtures
    );
    assert!(
        image_fixtures >= 3,
        "expected at least three v0.2 image fixtures, found {}",
        image_fixtures
    );
    assert!(
        list_fixtures >= 4,
        "expected at least four v0.2 list/checklist fixtures, found {}",
        list_fixtures
    );
    assert!(
        table_fixtures >= 4,
        "expected at least four v0.2 table fixtures, found {}",
        table_fixtures
    );
    assert!(
        unsupported_fixtures >= 4,
        "expected at least four v0.2 unsupported/raw-preserved fixtures, found {}",
        unsupported_fixtures
    );
    assert!(
        workspace_session_fixtures >= 2,
        "expected at least two v0.2 workspace/session fixtures, found {}",
        workspace_session_fixtures
    );
}

#[test]
fn fixture_category_counts_ignore_other_release_gates() {
    let fixtures = vec![
        fixture_spec(
            "MD-FIX-INL-V02-001",
            "inline-formatting",
            FixturePolicy::ByteForByte,
            vec![ReleaseGate::V0_2],
        ),
        fixture_spec(
            "MD-FIX-INL-V02-002",
            "inline-formatting",
            FixturePolicy::ByteForByte,
            vec![ReleaseGate::V0_2],
        ),
        fixture_spec(
            "MD-FIX-INL-V10-001",
            "inline-formatting",
            FixturePolicy::CanonicalEquivalent,
            vec![ReleaseGate::V1_0],
        ),
    ];

    assert_eq!(
        count_category_fixtures_for_release(&fixtures, "inline-formatting", ReleaseGate::V0_2),
        2
    );
    assert_eq!(
        count_category_fixtures_for_release(&fixtures, "inline-formatting", ReleaseGate::V1_0),
        1
    );
}

#[test]
fn full_replacement_restores_every_fixture_and_builds_one_full_range_operation() {
    for fixture in load_fixture_catalog() {
        let source = read_fixture_file(&fixture.source);
        let envelope = AiDocumentEnvelope::new(&fixture.id, &source, None).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();

        let validated = validate_full_replacement(
            &envelope,
            &masked,
            "Fixture rewrite".to_string(),
            vec!["Review the result.".to_string()],
        )
        .unwrap_or_else(|error| panic!("fixture {}: {error:?}", fixture.id));

        assert_eq!(
            validated.proposed_markdown, source,
            "fixture {}",
            fixture.id
        );
        assert_eq!(validated.summary.as_deref(), Some("Fixture rewrite"));
        assert_eq!(validated.warnings, vec!["Review the result."]);
        assert_eq!(validated.operations.len(), 1);
        assert_eq!(validated.hunks.len(), 1);
        let operation = &validated.operations[0];
        assert_eq!(operation.id, "document:replace");
        assert_eq!(operation.kind, OperationKind::Replace);
        assert_eq!(operation.target_segment_id, "document");
        assert_eq!(
            operation.source_range,
            ByteRange {
                start: 0,
                end: source.len()
            }
        );
        assert_eq!(operation.original_markdown, source);
        assert_eq!(operation.proposed_markdown, source);
    }
}

#[test]
fn full_replacement_can_render_the_validated_document_operation() {
    let source = "# Plan\n\nOriginal prose with [docs](/docs?q=1) and $git-commit.\n";
    let envelope = AiDocumentEnvelope::new("doc-render", source, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>()
        .replace("Original prose", "Rewritten prose");

    let validated = validate_full_replacement(
        &envelope,
        &masked,
        "Rewrote the document".to_string(),
        Vec::new(),
    )
    .unwrap();

    let proposed = source.replace("Original prose", "Rewritten prose");
    assert_eq!(validated.proposed_markdown, proposed);
    assert_eq!(
        validated
            .render_selected(&["document:replace".to_string()])
            .unwrap(),
        proposed
    );
    assert_eq!(validated.render_selected(&[]).unwrap(), source);

    let empty_envelope = AiDocumentEnvelope::new("empty-document", "", None).unwrap();
    let empty = validate_full_replacement(
        &empty_envelope,
        "",
        "Kept the empty document".to_string(),
        Vec::new(),
    )
    .unwrap();
    assert_eq!(
        empty
            .render_selected(&["document:replace".to_string()])
            .unwrap(),
        ""
    );
    assert_eq!(empty.render_selected(&[]).unwrap(), "");
}

#[test]
fn full_replacement_preserves_exact_link_destinations_and_skill_tokens() {
    let source = "Read [old label](/docs?q=1) with $git-commit.\n";
    let envelope = AiDocumentEnvelope::new("doc-protected", source, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let rewritten = masked
        .replace("old label", "new label")
        .replace("Read", "Review");

    let validated = validate_full_replacement(
        &envelope,
        &rewritten,
        "Updated prose".to_string(),
        Vec::new(),
    )
    .unwrap();

    assert_eq!(
        validated.proposed_markdown,
        "Review [new label](/docs?q=1) with $git-commit.\n"
    );

    let link = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::LinkDestination)
        .unwrap();
    let changed_link = masked.replace(&link.placeholder, &format!("evil{}", link.placeholder));
    let error = validate_full_replacement(
        &envelope,
        &changed_link,
        "Unsafe link".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );

    let skill = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::SkillToken)
        .unwrap();
    let changed_skill = masked.replace(&skill.placeholder, &format!("{}-evil", skill.placeholder));
    let error = validate_full_replacement(
        &envelope,
        &changed_skill,
        "Unsafe skill".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn full_replacement_rejects_missing_unknown_and_dangling_placeholders() {
    let source = "Use `cargo test` and [docs](/docs).\n";
    let envelope = AiDocumentEnvelope::new("doc-placeholders", source, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let first = envelope.protected.first().unwrap();

    let missing = masked.replacen(&first.placeholder, "", 1);
    let error =
        validate_full_replacement(&envelope, &missing, "Missing token".to_string(), Vec::new())
            .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::ProtectedTokenMissing)
    );

    for unknown in ["⟪MDNER_unknown_P99999⟫", "⟪MDNER_dangling"] {
        let error = validate_full_replacement(
            &envelope,
            &format!("{masked}{unknown}"),
            "Unknown token".to_string(),
            Vec::new(),
        )
        .unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::UnknownProtectedToken),
            "unknown placeholder {unknown:?} must fail closed"
        );
    }
}

#[test]
fn full_replacement_rejects_broken_fence_and_table_structure() {
    let fenced = "Before\n\n```rust\nfn main() {}\n```\n";
    let envelope = AiDocumentEnvelope::new("doc-fence", fenced, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let error = validate_full_replacement(
        &envelope,
        &format!("{masked}```\n"),
        "Broken fence".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );

    let table = "| Name | Value |\n| --- | --- |\n| one | two |\n";
    let envelope = AiDocumentEnvelope::new("doc-table", table, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let broken = masked.replace("two", "two | extra");
    let error =
        validate_full_replacement(&envelope, &broken, "Broken table".to_string(), Vec::new())
            .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn selection_envelopes_clip_protection_at_exact_user_boundaries() {
    let fenced = "Before\n\n```rust\nprivate_code();\n```\nAfter\n";
    let code_start = fenced.find("private_code").unwrap();
    let selection = ByteRange {
        start: code_start,
        end: code_start + "private_code".len(),
    };
    let envelope = AiDocumentEnvelope::new(
        "selection-fence",
        fenced,
        Some(selection),
    )
    .unwrap();
    assert_eq!(envelope.scope(), selection);
    assert_eq!(envelope.protected.len(), 1);
    assert_eq!(envelope.protected[0].range, selection);
    assert_eq!(envelope.protected[0].original, "private_code");

    let linked = "Read [docs](/private/destination) safely.\n";
    let destination_start = linked.find("private").unwrap();
    let selection = ByteRange {
        start: destination_start,
        end: destination_start + "private".len(),
    };
    let envelope = AiDocumentEnvelope::new(
        "selection-link",
        linked,
        Some(selection),
    )
    .unwrap();
    assert_eq!(envelope.scope(), selection);
    assert_eq!(envelope.protected.len(), 1);
    assert_eq!(envelope.protected[0].range, selection);
    assert_eq!(envelope.protected[0].original, "private");
}

#[test]
fn exact_protected_marker_selection_stays_masked_and_cannot_be_replaced() {
    let source = "Read [docs](/docs).\n";
    let marker_start = source.find(").").unwrap();
    let selection = ByteRange {
        start: marker_start,
        end: marker_start + 1,
    };
    let envelope = AiDocumentEnvelope::new("selection-marker", source, Some(selection)).unwrap();

    let marker = envelope
        .protected
        .iter()
        .find(|token| token.range == selection)
        .expect("the exact closing marker must remain protected");
    assert_eq!(marker.kind, ProtectedKind::MarkdownMarker);
    assert_eq!(marker.original, ")");
    assert_eq!(envelope.segments.len(), 1);
    assert_eq!(envelope.segments[0].text, marker.placeholder);

    let error = validate_selection_response(
        &envelope,
        SelectionResponse {
            schema_version: 1,
            replacement_text: ")".to_string(),
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::ProtectedTokenMissing)
    );

    let validated = validate_selection_response(
        &envelope,
        SelectionResponse {
            schema_version: 1,
            replacement_text: marker.placeholder.clone(),
            warnings: Vec::new(),
        },
    )
    .unwrap();
    assert_eq!(validated.proposed_markdown, source);
}

#[test]
fn selection_render_uses_the_selection_operation_segment() {
    let source = "Before old text after.\n";
    let start = source.find("old text").unwrap();
    let envelope = AiDocumentEnvelope::new(
        "selection-render",
        source,
        Some(ByteRange {
            start,
            end: start + "old text".len(),
        }),
    )
    .unwrap();
    let validated = validate_selection_response(
        &envelope,
        SelectionResponse {
            schema_version: 1,
            replacement_text: "new text".to_string(),
            warnings: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(
        validated
            .render_selected(&["selection:replace".to_string()])
            .unwrap(),
        "Before new text after.\n"
    );
    assert_eq!(validated.render_selected(&[]).unwrap(), source);
}

#[test]
fn full_replacement_protects_balanced_and_escaped_parentheses_in_link_destinations() {
    let source = concat!(
        "See [nested](https://example.test/a_(b(c\\)d))) ",
        "and [escaped](https://example.test/\\(literal\\)).\n",
    );
    let envelope = AiDocumentEnvelope::new("nested-links", source, None).unwrap();
    let destinations = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::LinkDestination)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        destinations,
        vec![
            "https://example.test/a_(b(c\\)d))",
            "https://example.test/\\(literal\\)",
        ]
    );

    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>()
        .replace("nested", "balanced")
        .replace("escaped", "literal");
    let validated = validate_full_replacement(
        &envelope,
        &masked,
        "Updated link labels".to_string(),
        Vec::new(),
    )
    .unwrap();
    assert_eq!(
        validated.proposed_markdown,
        source
            .replace("nested", "balanced")
            .replace("escaped", "literal")
    );
}

#[test]
fn angle_bracket_link_destination_uses_the_outer_closing_parenthesis() {
    let source = "See [docs](<https://example.test/a)b>) safely.\n";
    let envelope = AiDocumentEnvelope::new("angle-link", source, None).unwrap();
    let destination = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::LinkDestination)
        .unwrap();
    assert_eq!(destination.original, "<https://example.test/a)b>");
    let close = envelope
        .protected
        .iter()
        .find(|token| {
            token.kind == ProtectedKind::MarkdownMarker
                && token.original == ")"
                && token.range.start == destination.range.end
        })
        .unwrap();
    assert_eq!(&source[close.range.start..close.range.end], ")");
}

#[test]
fn link_titles_do_not_become_part_of_destinations_or_close_at_title_parentheses() {
    let source = concat!(
        "[plain](/safe \"Read docs\") and ",
        "[angle](<https://example.test/a> \"why) now\")\n",
    );
    let envelope = AiDocumentEnvelope::new("link-titles", source, None).unwrap();
    let destinations = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::LinkDestination)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert_eq!(destinations, vec!["/safe", "<https://example.test/a>"]);
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    assert!(masked.contains("Read docs"));
    assert!(masked.contains("why) now"));
}

#[test]
fn multiline_inline_link_title_layouts_keep_destinations_protected() {
    for (index, source) in [
        "[docs](https://safe.test \"why\nnow\")\n",
        "[docs](https://safe.test\n \"title\")\n",
        "[docs](https://safe.test \"why\nnow\nagain\")\n",
    ]
    .into_iter()
    .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("multiline-link-title-{index}"), source, None).unwrap();
        let destination = envelope
            .protected
            .iter()
            .find(|token| {
                token.kind == ProtectedKind::LinkDestination
                    && token.original.contains("https://safe.test")
            })
            .unwrap_or_else(|| {
                panic!(
                    "multiline title layout {index} must not expose the link destination: {:?}",
                    envelope.protected
                )
            });
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let redirected = masked.replace(
            &destination.placeholder,
            &destination.original.replace("safe", "evil"),
        );
        validate_full_replacement(
            &envelope,
            &redirected,
            "Redirect inline destination".to_string(),
            Vec::new(),
        )
        .unwrap_err();

        let start = source.find("https://safe.test").unwrap();
        assert_fully_protected_selection(
            format!("multiline-link-title-selection-{index}"),
            source,
            ByteRange {
                start,
                end: start + "https://safe.test".len(),
            },
            ProtectedKind::LinkDestination,
        );
    }
}

#[test]
fn valid_inner_links_remain_protected_after_failed_outer_candidates() {
    for (index, source) in [
        "[[docs](https://safe.test)",
        "[bad](missing close and [good](https://safe.test)",
    ]
    .into_iter()
    .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("inner-link-{index}"), source, None).unwrap();
        assert!(envelope.protected.iter().any(|token| {
            token.kind == ProtectedKind::LinkDestination && token.original == "https://safe.test"
        }));
    }
}

#[test]
fn multiline_inline_code_is_one_protected_span_for_document_and_selection() {
    let source = "Before `private\ncode` after.\n";
    let envelope = AiDocumentEnvelope::new("multiline-code", source, None).unwrap();
    let inline_code = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::InlineCode)
        .expect("multiline code span must be protected");
    assert_eq!(inline_code.original, "`private\ncode`");

    let private_start = source.find("private").unwrap();
    assert_fully_protected_selection(
        "multiline-code-interior",
        source,
        ByteRange {
            start: private_start,
            end: private_start + "private".len(),
        },
        ProtectedKind::InlineCode,
    );

    let selection =
        AiDocumentEnvelope::new("multiline-code-exact", source, Some(inline_code.range)).unwrap();
    assert_eq!(selection.protected.len(), 1);
    assert_eq!(selection.protected[0].original, "`private\ncode`");
}

#[test]
fn multiline_code_scanning_stays_inside_paragraphs_and_handles_chained_spans() {
    let fenced = concat!(
        "Before `literal\n",
        "\n",
        "```rust\n",
        "private();\n",
        "```\n",
        "After\n",
    );
    let envelope = AiDocumentEnvelope::new("unmatched-before-fence", fenced, None).unwrap();
    let block = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::BlockCode)
        .unwrap();
    assert_eq!(block.original, "```rust\nprivate();\n```\n");

    let chained = "a `one\nb` and `two\nc` after\n";
    let envelope = AiDocumentEnvelope::new("chained-code", chained, None).unwrap();
    let spans = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::InlineCode)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert_eq!(spans, vec!["`one\nb`", "`two\nc`"]);
}

#[test]
fn protected_context_reparse_uses_the_original_envelope_policy() {
    let source = "---\ntitle: \"Hello\"\n---\n";
    let policy = ProtectionPolicy {
        translate_frontmatter_values: true,
        ..ProtectionPolicy::default()
    };
    let full = AiDocumentEnvelope::with_policy("policy-full", source, None, policy).unwrap();
    let masked = full
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let validated =
        validate_full_replacement(&full, &masked, "Identity".to_string(), Vec::new()).unwrap();
    assert_eq!(validated.proposed_markdown, source);

    let selected = AiDocumentEnvelope::with_policy(
        "policy-selection",
        source,
        Some(ByteRange {
            start: 0,
            end: source.len(),
        }),
        policy,
    )
    .unwrap();
    let masked = selected
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let validated = validate_selection_response(
        &selected,
        SelectionResponse {
            schema_version: 1,
            replacement_text: masked,
            warnings: Vec::new(),
        },
    )
    .unwrap();
    assert_eq!(validated.proposed_markdown, source);
}

#[test]
fn full_and_selection_replacements_reject_shadowed_protected_context() {
    let source = "[x](https://safe.test)";
    let full = AiDocumentEnvelope::new("shadow-full", source, None).unwrap();
    let masked = full
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let shadowed = masked.replace("x", "z](https://safe.test)x");
    let error =
        validate_full_replacement(&full, &shadowed, "Shadowed link".to_string(), Vec::new())
            .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );

    let selection = AiDocumentEnvelope::new(
        "shadow-selection",
        source,
        Some(ByteRange {
            start: 0,
            end: source.len(),
        }),
    )
    .unwrap();
    let selected_masked = selection
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>()
        .replace("x", "z](https://safe.test)x");
    let error = validate_selection_response(
        &selection,
        SelectionResponse {
            schema_version: 1,
            replacement_text: selected_masked,
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn full_replacement_rejects_neutralized_heading_and_table_markers() {
    let heading = "# Heading\n";
    let envelope = AiDocumentEnvelope::new("neutral-heading", heading, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let error = validate_full_replacement(
        &envelope,
        &format!("x{masked}"),
        "Neutralized heading".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );

    let table = "| A | B |\n| --- | --- |\n| one | two |\n";
    let envelope = AiDocumentEnvelope::new("neutral-table", table, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let delimiter = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::TableDelimiter && token.original.contains("---"))
        .unwrap();
    let error = validate_full_replacement(
        &envelope,
        &masked.replace(
            &delimiter.placeholder,
            &format!("prose\n{}", delimiter.placeholder),
        ),
        "Neutralized table".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );

    let error = validate_full_replacement(
        &envelope,
        &masked.replace(
            &delimiter.placeholder,
            &format!("| C | D |\n{}", delimiter.placeholder),
        ),
        "Reassociated table".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn skill_tokens_follow_the_frontend_single_namespace_contract() {
    let source = concat!(
        "Use $git-commit, /compound-engineering:ce-work, and $alpha:beta:gamma.\n",
        "Also [$bracket-skill] and “/quoted:skill”, but not /goal/sub or $token#anchor.\n",
    );
    let envelope = AiDocumentEnvelope::new("skill-namespaces", source, None).unwrap();
    let skills = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::SkillToken)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        skills,
        vec![
            "$git-commit",
            "/compound-engineering:ce-work",
            "$alpha:beta",
            "$bracket-skill",
            "/quoted:skill",
        ]
    );
}

#[test]
fn quoted_skill_token_selection_remains_protected() {
    let source = "Use “/compound-engineering:ce-work” safely.\n";
    let start = source.find("/compound-engineering:ce-work").unwrap();
    let selection = ByteRange {
        start,
        end: start + "/compound-engineering:ce-work".len(),
    };
    let envelope = AiDocumentEnvelope::new("quoted-skill", source, Some(selection)).unwrap();
    let token = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::SkillToken)
        .expect("quoted skill token must stay protected in an exact selection");
    assert_eq!(token.range, selection);
    assert_eq!(token.original, "/compound-engineering:ce-work");

    let error = validate_selection_response(
        &envelope,
        SelectionResponse {
            schema_version: 1,
            replacement_text: "/evil".to_string(),
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::ProtectedTokenMissing)
    );
}

#[test]
fn blockquote_fences_are_validated_inside_their_container() {
    let valid = "> ````rust\n> let value = 1;\n> `````   \n";
    validate_markdown_fragment(valid).unwrap();
    let envelope = AiDocumentEnvelope::new("quoted-fence", valid, None).unwrap();
    let block_code = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::BlockCode)
        .collect::<Vec<_>>();
    assert_eq!(block_code.len(), 1);
    assert_eq!(block_code[0].original, valid);
    let blocks = markdown_block_ranges(valid);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].kind, MarkdownBlockKind::FencedCode);
    assert_eq!(
        blocks[0].range,
        ByteRange {
            start: 0,
            end: valid.len()
        }
    );

    for invalid in [
        "> ````rust\n> let value = 1;\n> ```\n",
        "> ````rust\n> let value = 1;\n> ```` rust\n",
        "> ````rust\nlet value = 1;\n````\n",
    ] {
        let error = validate_markdown_fragment(invalid).unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged),
            "invalid quoted fence {invalid:?} must fail closed"
        );
    }
}

#[test]
fn fenced_envelope_closes_only_on_a_long_enough_whitespace_only_marker_run() {
    let source = concat!(
        "````rust\n",
        "before();\n",
        "```\n",
        "after_short_run();\n",
        "```` rust\n",
        "after_info_suffix();\n",
        "`````  \n",
    );
    validate_markdown_fragment(source).unwrap();

    let envelope = AiDocumentEnvelope::new("fence-closer", source, None).unwrap();
    let blocks = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::BlockCode)
        .collect::<Vec<_>>();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].original, source);
    assert_eq!(envelope.segments.len(), 1);
    assert_eq!(envelope.segments[0].text, blocks[0].placeholder);
}

#[test]
fn non_ascii_whitespace_after_a_marker_run_does_not_close_a_fence() {
    let source = "```rust\n```\u{00a0}\nprivate();\n```\n";
    validate_markdown_fragment(source).unwrap();

    let envelope = AiDocumentEnvelope::new("fence-nbsp", source, None).unwrap();
    let blocks = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::BlockCode)
        .collect::<Vec<_>>();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].original, source);
}

#[test]
fn backtick_fence_info_strings_cannot_contain_backticks() {
    let source = "``` foo`bar\n```\n```\n";
    validate_markdown_fragment(source).unwrap();
    let blocks = markdown_block_ranges(source);
    assert_eq!(blocks[0].kind, MarkdownBlockKind::Paragraph);
    assert_eq!(blocks[1].kind, MarkdownBlockKind::FencedCode);
    assert_eq!(
        &source[blocks[1].range.start..blocks[1].range.end],
        "```\n```\n"
    );
}

#[test]
fn quoted_tables_validate_with_their_container_prefix_removed() {
    let valid = "> | Name | Value |\n> | --- | --- |\n> | one | two |\n";
    validate_markdown_fragment(valid).unwrap();
    let envelope = AiDocumentEnvelope::new("quoted-table", valid, None).unwrap();
    let delimiter = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::TableDelimiter && token.original.contains("---"))
        .unwrap();
    assert_eq!(delimiter.original, "> | --- | --- |\n");
    let blocks = markdown_block_ranges(valid);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].kind, MarkdownBlockKind::Table);
    assert_eq!(
        blocks[0].range,
        ByteRange {
            start: 0,
            end: valid.len()
        }
    );

    let invalid = "> | Name | Value |\n> | --- | --- |\n> | one | two | extra |\n";
    let error = validate_markdown_fragment(invalid).unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn one_and_two_dash_would_be_table_delimiters_are_rejected() {
    let invalid = "| Name | Value |\n| - | -- |\n| one | two |\n";
    let error = validate_markdown_fragment(invalid).unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn table_like_text_inside_fenced_and_indented_code_is_ignored() {
    let source = concat!(
        "```markdown\n",
        "| Name | Value |\n",
        "| - | -- |\n",
        "```\n",
        "\n",
        "    | Other | Values |\n",
        "    | -- | - |\n",
        "\n",
        "~~~markdown\n",
        "| Tilde | Fence |\n",
        "| -- | - |\n",
        "~~~\n",
        "\n",
        "\t| Tab | Code |\n",
        "\t| - | -- |\n",
        "\n",
        "> ```markdown\n",
        "> | Quoted | Fence |\n",
        "> | -- | - |\n",
        "> ```\n",
        "\n",
        ">     | Quoted | Code |\n",
        ">     | - | -- |\n",
    );

    validate_markdown_fragment(source).unwrap();
}

#[test]
fn list_continuation_indent_does_not_hide_nested_fences_or_tables() {
    for source in [
        "-   item\n\n    ```rust\n    code\n",
        "-   item\n\n    | A | B |\n    | - | -- |\n",
    ] {
        let error = validate_markdown_fragment(source).unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
        );
    }
}

#[test]
fn nested_container_fences_and_markers_are_protected_for_full_and_selection_edits() {
    let fenced = "-   item\n\n    ~~~rust\n    private();\n    ~~~\n";
    let envelope = AiDocumentEnvelope::new("nested-list-fence", fenced, None).unwrap();
    let block = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::BlockCode)
        .expect("nested list fence must be one protected block");
    assert_eq!(block.original, "    ~~~rust\n    private();\n    ~~~\n");
    let private_start = fenced.find("private").unwrap();
    assert_fully_protected_selection(
        "nested-list-fence-selection",
        fenced,
        ByteRange {
            start: private_start,
            end: private_start + "private".len(),
        },
        ProtectedKind::BlockCode,
    );

    let markers = concat!(
        "-   parent\n",
        "    - [ ] child\n",
        "\n",
        "    # Nested heading\n",
        "> # Quoted heading\n",
        "> - [ ] quoted task\n",
    );
    let envelope = AiDocumentEnvelope::new("nested-markers", markers, None).unwrap();
    let originals = envelope
        .protected
        .iter()
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert!(originals.contains(&"# "));
    assert!(originals.contains(&"[ ] "));
    assert!(
        originals
            .iter()
            .filter(|original| **original == "# ")
            .count()
            >= 2,
        "{originals:?}"
    );
    assert!(
        originals
            .iter()
            .filter(|original| **original == "[ ] ")
            .count()
            >= 2
    );
}

#[test]
fn same_line_list_fences_and_recursive_markers_remain_structural() {
    let fenced = "- ```rust\n  private();\n  ```\nAfter\n";
    validate_markdown_fragment(fenced).unwrap();
    let envelope = AiDocumentEnvelope::new("same-line-list-fence", fenced, None).unwrap();
    let block = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::BlockCode)
        .expect("same-line list fence must be one protected block");
    assert_eq!(block.original, "- ```rust\n  private();\n  ```\n");
    let private_start = fenced.find("private").unwrap();
    assert_fully_protected_selection(
        "same-line-list-fence-selection",
        fenced,
        ByteRange {
            start: private_start,
            end: private_start + "private".len(),
        },
        ProtectedKind::BlockCode,
    );

    for (index, (source, marker_start, marker)) in [
        ("- - item\n", 2, "- "),
        ("- > quote\n", 2, "> "),
        ("- # heading\n", 2, "# "),
        ("- - [ ] task\n", 4, "[ ] "),
    ]
    .into_iter()
    .enumerate()
    {
        let selected = AiDocumentEnvelope::new(
            format!("recursive-marker-{index}"),
            source,
            Some(ByteRange {
                start: marker_start,
                end: marker_start + marker.len(),
            }),
        )
        .unwrap();
        assert!(
            selected.protected.iter().any(
                |token| token.kind == ProtectedKind::MarkdownMarker && token.original == marker
            ),
            "inner marker {marker:?} must remain protected"
        );
    }
}

#[test]
fn recursive_block_marker_chains_cannot_be_relocated_across_lines() {
    for (index, source) in ["- - item\n", "- > quote\n", "- # heading\n"]
        .into_iter()
        .enumerate()
    {
        let full =
            AiDocumentEnvelope::new(format!("marker-chain-full-{index}"), source, None).unwrap();
        let markers = full
            .protected
            .iter()
            .filter(|token| {
                token.kind == ProtectedKind::MarkdownMarker
                    && token.range.start < 4
                    && token.original != "\n"
            })
            .collect::<Vec<_>>();
        assert_eq!(markers.len(), 2);
        let masked = full
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let adjacent = format!("{}{}", markers[0].placeholder, markers[1].placeholder);
        let relocated = masked.replacen(
            &adjacent,
            &format!("{}flat\n{}", markers[0].placeholder, markers[1].placeholder),
            1,
        );
        validate_full_replacement(
            &full,
            &relocated,
            "Relocate nested marker".to_string(),
            Vec::new(),
        )
        .unwrap_err();

        let selection = AiDocumentEnvelope::new(
            format!("marker-chain-selection-{index}"),
            source,
            Some(ByteRange {
                start: 2,
                end: source.len() - 1,
            }),
        )
        .unwrap();
        let selected_masked = selection
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        validate_selection_response(
            &selection,
            SelectionResponse {
                schema_version: 1,
                replacement_text: format!("flat\n{selected_masked}"),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();

        let body = &source[4..source.len() - 1];
        validate_full_replacement(
            &full,
            &masked.replace(body, "changed"),
            "Edit nested body".to_string(),
            Vec::new(),
        )
        .unwrap();
    }
}

#[test]
fn quoted_html_tags_and_multiline_comments_are_fully_protected() {
    let source = "<a title=\"x > y\">text</a>\n<!-- a >\nb -->\n";
    let envelope = AiDocumentEnvelope::new("raw-html", source, None).unwrap();
    let html = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::HtmlTag)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert_eq!(html, vec!["<a title=\"x > y\">", "</a>", "<!-- a >\nb -->"]);

    let attribute_start = source.find("y\"").unwrap();
    assert_fully_protected_selection(
        "raw-html-selection",
        source,
        ByteRange {
            start: attribute_start,
            end: attribute_start + 1,
        },
        ProtectedKind::HtmlTag,
    );
}

#[test]
fn commonmark_processing_declaration_and_cdata_html_are_fully_protected() {
    for (index, source) in [
        "<?processing\n test?>\n",
        "<!DOCTYPE\n html>\n",
        "<![CDATA[data\nmore]]>\n",
    ]
    .into_iter()
    .enumerate()
    {
        let syntax = source.trim_end_matches('\n');
        let envelope =
            AiDocumentEnvelope::new(format!("raw-html-form-{index}"), source, None).unwrap();
        let token = envelope
            .protected
            .iter()
            .find(|token| token.kind == ProtectedKind::HtmlTag && token.original == syntax)
            .expect("the complete raw HTML form must be protected");
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let changed = masked.replace(&token.placeholder, "plain text");
        validate_full_replacement(
            &envelope,
            &changed,
            "Neutralize raw HTML".to_string(),
            Vec::new(),
        )
        .unwrap_err();

        let interior = token.range.start + 2;
        assert_fully_protected_selection(
            format!("raw-html-form-selection-{index}"),
            source,
            ByteRange {
                start: interior,
                end: interior + 1,
            },
            ProtectedKind::HtmlTag,
        );
    }
}

#[test]
fn full_and_selection_replacements_cannot_escape_protected_html() {
    let source = "<b>word</b>\n";
    let full = AiDocumentEnvelope::new("html-escape-full", source, None).unwrap();
    let masked = full
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    validate_full_replacement(
        &full,
        &format!("\\{masked}"),
        "Escaped HTML".to_string(),
        Vec::new(),
    )
    .unwrap_err();

    let selection = AiDocumentEnvelope::new(
        "html-escape-selection",
        source,
        Some(ByteRange {
            start: 0,
            end: source.len(),
        }),
    )
    .unwrap();
    let masked = selection
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    validate_selection_response(
        &selection,
        SelectionResponse {
            schema_version: 1,
            replacement_text: format!("\\{masked}"),
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
}

#[test]
fn reference_destinations_and_title_syntax_are_parsed_separately() {
    let source = "[id]: <my uri> \"Read docs\"\nUse [docs][id].\n";
    let envelope = AiDocumentEnvelope::new("reference-title", source, None).unwrap();
    let identifiers = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::LinkDestination)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert!(
        identifiers
            .iter()
            .any(|identifier| identifier.ends_with("<my uri>"))
    );
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    assert!(masked.contains("Read docs"));
}

#[test]
fn next_line_reference_destinations_are_protected() {
    let source = concat!(
        "[docs][safe]\n\n",
        "[safe]:\n  https://safe.test/path\n",
        "[evil]: https://evil.test/path\n",
    );
    let envelope =
        AiDocumentEnvelope::new("multiline-reference-destination", source, None).unwrap();
    let destination = envelope
        .protected
        .iter()
        .find(|token| {
            token.kind == ProtectedKind::LinkDestination
                && token.original.contains("https://safe.test/path")
        })
        .expect("next-line reference destination must be protected");
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let redirected = masked.replace(
        &destination.placeholder,
        &destination.original.replace("safe", "evil"),
    );
    validate_full_replacement(
        &envelope,
        &redirected,
        "Redirect reference destination".to_string(),
        Vec::new(),
    )
    .unwrap_err();

    let destination_start = source.find("https://safe.test/path").unwrap();
    assert_fully_protected_selection(
        "multiline-reference-destination-selection",
        source,
        ByteRange {
            start: destination_start,
            end: destination_start + "https://safe.test/path".len(),
        },
        ProtectedKind::LinkDestination,
    );
}

#[test]
fn next_line_reference_title_delimiters_are_protected_and_paired() {
    for (index, (open, close, wrong_close)) in
        [('"', '"', '\''), ('\'', '\'', '"'), ('(', ')', ']')]
            .into_iter()
            .enumerate()
    {
        let source =
            format!("[safe]:\n  https://safe.test/path {open}title{close}\n[docs][safe]\n");
        let envelope =
            AiDocumentEnvelope::new(format!("reference-title-{index}"), &source, None).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        assert!(
            masked.contains("title"),
            "reference title text stays editable"
        );
        validate_full_replacement(
            &envelope,
            &masked.replace("title", "updated"),
            "Edit reference title".to_string(),
            Vec::new(),
        )
        .unwrap();

        let open_start = source.find(&format!(" {open}title")).unwrap() + 1;
        assert!(envelope.protected.iter().any(|token| {
            token.kind == ProtectedKind::MarkdownMarker
                && token.range.start <= open_start
                && token.range.end == open_start + open.len_utf8()
        }));
        let close_start = source.rfind(close).unwrap();
        let close_token = envelope
            .protected
            .iter()
            .find(|token| {
                token.kind == ProtectedKind::MarkdownMarker
                    && token.range
                        == ByteRange {
                            start: close_start,
                            end: close_start + close.len_utf8(),
                        }
            })
            .expect("reference title closer must be protected");
        let broken = masked.replace(&close_token.placeholder, &wrong_close.to_string());
        validate_full_replacement(
            &envelope,
            &broken,
            "Break reference title".to_string(),
            Vec::new(),
        )
        .unwrap_err();

        let selected = AiDocumentEnvelope::new(
            format!("reference-title-selection-{index}"),
            &source,
            Some(ByteRange {
                start: close_start,
                end: close_start + close.len_utf8(),
            }),
        )
        .unwrap();
        validate_selection_response(
            &selected,
            SelectionResponse {
                schema_version: 1,
                replacement_text: wrong_close.to_string(),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();
    }
}

#[test]
fn multiline_and_container_reference_definitions_protect_destinations() {
    for (index, source) in [
        "[safe\nid]: https://safe.test/path\n\n[docs][safe id]\n",
        "> [safe]:\n>   https://safe.test/path\n> [docs][safe]\n",
        "- [safe]:\n    https://safe.test/path\n  [docs][safe]\n",
        "- [safe]: https://safe.test/path\n  [docs][safe]\n",
        "[safe]: https://safe.test/path \"why\nnow\"\n[docs][safe]\n",
        "[safe]:\n  https://safe.test/path \"why\nnow\"\n[docs][safe]\n",
    ]
    .into_iter()
    .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("reference-definition-{index}"), source, None).unwrap();
        let destination = envelope
            .protected
            .iter()
            .find(|token| {
                token.kind == ProtectedKind::LinkDestination
                    && token.original.contains("https://safe.test/path")
            })
            .expect("reference destination must be protected across its container");
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let redirected = masked.replace(
            &destination.placeholder,
            &destination.original.replace("safe", "evil"),
        );
        validate_full_replacement(
            &envelope,
            &redirected,
            "Redirect reference destination".to_string(),
            Vec::new(),
        )
        .unwrap_err();

        let destination_start = source.find("https://safe.test/path").unwrap();
        assert_fully_protected_selection(
            format!("reference-definition-selection-{index}"),
            source,
            ByteRange {
                start: destination_start,
                end: destination_start + "https://safe.test/path".len(),
            },
            ProtectedKind::LinkDestination,
        );
    }
}

#[test]
fn reference_and_footnote_usage_identifiers_are_protected() {
    let source = concat!(
        "[Docs][safe] and [^1].\n\n",
        "[safe]: https://safe.test\n",
        "[evil]: https://evil.test\n",
        "[^1]: Footnote text.\n",
    );
    let envelope = AiDocumentEnvelope::new("reference-identifiers", source, None).unwrap();
    let identifiers = envelope
        .protected
        .iter()
        .filter(|token| token.kind == ProtectedKind::Identifier)
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();
    assert!(identifiers.contains(&"[safe]"));
    assert!(
        identifiers
            .iter()
            .filter(|identifier| **identifier == "[^1]")
            .count()
            >= 1
    );

    let usage_start = source.find("[safe]").unwrap();
    let selection = AiDocumentEnvelope::new(
        "reference-identifier-selection",
        source,
        Some(ByteRange {
            start: usage_start,
            end: usage_start + "[safe]".len(),
        }),
    )
    .unwrap();
    validate_selection_response(
        &selection,
        SelectionResponse {
            schema_version: 1,
            replacement_text: "[evil]".to_string(),
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
}

#[test]
fn ordinary_bracketed_prose_is_not_treated_as_a_reference_identifier() {
    for (index, source) in [
        "Use [draft] wording.\n",
        "Choose [red or blue] today.\n",
        "An array [one, two].\n",
    ]
    .into_iter()
    .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("bracket-prose-{index}"), source, None).unwrap();
        assert!(
            envelope
                .protected
                .iter()
                .all(|token| token.kind != ProtectedKind::Identifier),
            "ordinary bracketed prose must remain editable"
        );
        let start = source.find('[').unwrap() + 1;
        AiDocumentEnvelope::new(
            format!("bracket-prose-selection-{index}"),
            source,
            Some(ByteRange {
                start,
                end: start + 1,
            }),
        )
        .unwrap();
    }
}

#[test]
fn multiline_inline_link_labels_keep_destinations_protected() {
    let source = "[safe\nlabel](https://safe.test/path)\n";
    let envelope = AiDocumentEnvelope::new("multiline-link-label", source, None).unwrap();
    assert!(envelope.protected.iter().any(|token| {
        token.kind == ProtectedKind::LinkDestination && token.original.contains("https://safe.test")
    }));
    let destination_start = source.find("https://").unwrap();
    assert_fully_protected_selection(
        "multiline-link-selection",
        source,
        ByteRange {
            start: destination_start,
            end: destination_start + "https://safe.test/path".len(),
        },
        ProtectedKind::LinkDestination,
    );
}

#[test]
fn multiline_reference_usage_identifiers_are_protected() {
    let source = concat!(
        "[docs][safe\nid]\n\n",
        "[safe id]: https://safe.test\n",
        "[evil id]: https://evil.test\n",
    );
    let envelope = AiDocumentEnvelope::new("multiline-reference-id", source, None).unwrap();
    let identifier = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::Identifier && token.original == "[safe\nid]")
        .expect("multiline reference identifier must be one protected token");
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let redirected = masked.replace(&identifier.placeholder, "[evil\nid]");
    validate_full_replacement(
        &envelope,
        &redirected,
        "Redirect reference".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    let safe_start = source.find("safe\nid").unwrap();
    assert_fully_protected_selection(
        "multiline-reference-id-selection",
        source,
        ByteRange {
            start: safe_start,
            end: safe_start + "safe".len(),
        },
        ProtectedKind::Identifier,
    );
    assert_eq!(identifier.original, "[safe\nid]");
}

#[test]
fn thematic_and_setext_marker_lines_are_protected() {
    let source = "Intro\n\n---\nAfter\n\nHeading\n===\nShort one\n-\n\nShort two\n--\n";
    let envelope = AiDocumentEnvelope::new("block-markers", source, None).unwrap();
    for marker in ["---\n", "===\n", "-\n", "--\n"] {
        assert!(envelope.protected.iter().any(|token| {
            token.kind == ProtectedKind::MarkdownMarker && token.original == marker
        }));
        let start = source
            .match_indices(marker)
            .find_map(|(start, _)| {
                (start == 0 || source.as_bytes().get(start - 1) == Some(&b'\n')).then_some(start)
            })
            .unwrap();
        let selected = AiDocumentEnvelope::new(
            format!("block-marker-{marker:?}"),
            source,
            Some(ByteRange {
                start,
                end: start + marker.len(),
            }),
        )
        .unwrap();
        validate_selection_response(
            &selected,
            SelectionResponse {
                schema_version: 1,
                replacement_text: "prose\n".to_string(),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();
    }
}

#[test]
fn markdown_insertion_rejects_text_absorbed_at_protected_identifier_boundaries() {
    let source = "Read [docs](/private/docs) with $git-commit.\n";
    let destination_start = source.find("/private/docs").unwrap();
    let destination_end = destination_start + "/private/docs".len();
    let skill_start = source.find("$git-commit").unwrap();
    let skill_end = skill_start + "$git-commit".len();

    for (cursor, fragment) in [
        (destination_start, "evil"),
        (destination_end, "-evil"),
        (skill_start, "x"),
        (skill_end, "-evil"),
    ] {
        let error = validate_markdown_insertion(source, cursor, fragment).unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged),
            "insertion {fragment:?} at {cursor} must not alter an existing identifier"
        );
    }

    let error = validate_markdown_insertion("[x](/safe)", 0, "!").unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
    let error = validate_markdown_insertion("[x](/safe)", 1, "z](/safe)").unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn markdown_insertion_allows_new_self_contained_valid_markup() {
    let source = "Read [docs](/private/docs) with $git-commit.\n";
    let fragment = concat!(
        "\n[new](https://example.test/a_(b))\n",
        "\n",
        "> | Name | Value |\n",
        "> | --- | --- |\n",
        "> | one | two |\n",
        "\n",
        "```markdown\n",
        "| Code | Sample |\n",
        "| - | -- |\n",
        "```\n",
    );

    validate_markdown_insertion(source, source.len(), fragment).unwrap();
    validate_markdown_insertion("[old](/safe)", 0, "![new](/new)\n\n").unwrap();
}

#[test]
fn markdown_insertion_rejects_excessive_line_complexity_before_segmentation() {
    let fragment = "a\n".repeat(32 * 1024 + 1);
    let error = validate_markdown_insertion("", 0, &fragment).unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::DocumentTooComplex)
    );
}

#[test]
fn escaped_backticks_do_not_steal_real_code_span_openers() {
    let source = "\\` literal `code`\n";
    let envelope = AiDocumentEnvelope::new("escaped-code-opener", source, None).unwrap();
    let inline_code = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::InlineCode)
        .expect("the real code span after escaped prose must stay protected");
    assert_eq!(inline_code.original, "`code`");
    let code_start = source.find("code").unwrap();
    assert_fully_protected_selection(
        "escaped-code-opener-selection",
        source,
        ByteRange {
            start: code_start,
            end: code_start + "code".len(),
        },
        ProtectedKind::InlineCode,
    );

    let escaped_only = "\\`editable\\`\n";
    let envelope = AiDocumentEnvelope::new("escaped-code-prose", escaped_only, None).unwrap();
    assert!(
        envelope
            .protected
            .iter()
            .all(|token| token.kind != ProtectedKind::InlineCode)
    );
    let editable_start = escaped_only.find("editable").unwrap();
    AiDocumentEnvelope::new(
        "escaped-code-prose-selection",
        escaped_only,
        Some(ByteRange {
            start: editable_start,
            end: editable_start + "editable".len(),
        }),
    )
    .unwrap();
}

#[test]
fn unmatched_inline_link_openers_are_scanned_in_linear_time() {
    let source = "[".repeat(256 * 1024);
    let envelope = AiDocumentEnvelope::new("unmatched-link-openers", &source, None).unwrap();
    assert_eq!(envelope.reconstruct_original().unwrap(), source);
}

#[test]
fn unmatched_html_tag_openers_are_scanned_in_linear_time() {
    let source = "<a".repeat(128 * 1024);
    let envelope = AiDocumentEnvelope::new("unmatched-html-openers", &source, None).unwrap();
    assert_eq!(envelope.reconstruct_original().unwrap(), source);
}

#[test]
fn an_unclosed_html_candidate_fail_closes_over_later_tag_like_content() {
    let source = "<a title=\"oops <b>safe</b>";
    let safe_start = source.find("safe").unwrap();
    assert_fully_protected_selection(
        "unclosed-html-selection",
        source,
        ByteRange {
            start: safe_start,
            end: safe_start + "safe".len(),
        },
        ProtectedKind::HtmlTag,
    );
}

#[test]
fn unique_unmatched_backtick_runs_are_scanned_in_linear_time() {
    let source = (1..=1_024)
        .map(|run_length| format!("x{}", "`".repeat(run_length)))
        .collect::<String>();
    let envelope = AiDocumentEnvelope::new("unmatched-backtick-runs", &source, None).unwrap();
    assert_eq!(envelope.reconstruct_original().unwrap(), source);
}

#[test]
fn markdown_insertion_grandfathers_unchanged_legacy_table_invalidity() {
    let source = "| A | B |\n| --- | --- |\n| only |\n\nAfter\n";
    validate_markdown_insertion(source, source.len(), "More prose.\n").unwrap();
}

#[test]
fn full_and_selection_replacements_preserve_inline_delimiter_flanking() {
    for (index, source) in ["**word**\n", "_word_\n", "~~word~~\n"]
        .into_iter()
        .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("delimiter-full-{index}"), source, None).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let error = validate_full_replacement(
            &envelope,
            &masked.replace("word", " word"),
            "Neutralized delimiter".to_string(),
            Vec::new(),
        )
        .unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
        );

        let selection = AiDocumentEnvelope::new(
            format!("delimiter-selection-{index}"),
            source,
            Some(ByteRange {
                start: 0,
                end: source.len(),
            }),
        )
        .unwrap();
        let masked = selection
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let error = validate_selection_response(
            &selection,
            SelectionResponse {
                schema_version: 1,
                replacement_text: masked.replace("word", "word "),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();
        assert!(
            error
                .issues
                .iter()
                .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
        );
    }

    let source = "a**word**\n";
    let envelope = AiDocumentEnvelope::new("delimiter-punctuation", source, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let error = validate_full_replacement(
        &envelope,
        &masked.replace("word", "!word"),
        "Neutralized delimiter".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MarkdownStructureChanged)
    );
}

#[test]
fn replacement_and_insertion_preserve_block_marker_roles() {
    for (index, source) in ["# Heading\n", "- item\n", "1. item\n", "> quote\n"]
        .into_iter()
        .enumerate()
    {
        let envelope =
            AiDocumentEnvelope::new(format!("block-role-{index}"), source, None).unwrap();
        let masked = envelope
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>();
        let body = source
            .split_once([' ', '\t'])
            .map(|(_, body)| body.trim_end())
            .unwrap();
        validate_full_replacement(
            &envelope,
            &masked.replace(body, &format!("\n{body}")),
            "Neutralized block marker".to_string(),
            Vec::new(),
        )
        .unwrap_err();
        let prefix_end = envelope
            .protected
            .iter()
            .find(|token| {
                token.kind == ProtectedKind::MarkdownMarker
                    && token.range.start == 0
                    && token.original != "\n"
            })
            .unwrap()
            .range
            .end;
        validate_markdown_insertion(source, prefix_end, "\n").unwrap_err();
    }

    validate_markdown_insertion("**word**", 2, " ").unwrap_err();
}

#[test]
fn table_delimiters_stay_attached_to_existing_body_rows() {
    let source = "| A | B |\n| --- | --- |\n| x | y |\n";
    let envelope = AiDocumentEnvelope::new("table-body-context", source, None).unwrap();
    let masked = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    let delimiter = envelope
        .protected
        .iter()
        .find(|token| token.kind == ProtectedKind::TableDelimiter && token.original.contains("---"))
        .unwrap();
    validate_full_replacement(
        &envelope,
        &masked.replace(
            &delimiter.placeholder,
            &format!("{}\n", delimiter.placeholder),
        ),
        "Detached table body".to_string(),
        Vec::new(),
    )
    .unwrap_err();
    validate_markdown_insertion(source, delimiter.range.start, "prose\n").unwrap_err();

    let row_start = source.find("| x | y |").unwrap();
    let selected = AiDocumentEnvelope::new(
        "table-body-selection",
        source,
        Some(ByteRange {
            start: row_start,
            end: source.len(),
        }),
    )
    .unwrap();
    let masked = selected
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    validate_selection_response(
        &selected,
        SelectionResponse {
            schema_version: 1,
            replacement_text: format!("\n{masked}"),
            warnings: Vec::new(),
        },
    )
    .unwrap_err();
}

#[test]
fn escaped_trailing_literal_pipes_do_not_reduce_table_column_counts() {
    let source = "A | B \\|\n--- | ---\nx | y \\|\n";
    validate_markdown_fragment(source).unwrap();
    validate_markdown_insertion("", 0, source).unwrap();
    let envelope = AiDocumentEnvelope::new("escaped-trailing-pipe", source, None).unwrap();
    assert_eq!(envelope.reconstruct_original().unwrap(), source);
}

#[test]
fn partial_selections_preserve_surrounding_heading_and_emphasis_context() {
    for (index, (source, selected_text, replacement)) in [
        ("# Heading\n", "Heading", "\nHeading"),
        ("**word**\n", "word", " word"),
    ]
    .into_iter()
    .enumerate()
    {
        let start = source.find(selected_text).unwrap();
        let envelope = AiDocumentEnvelope::new(
            format!("partial-context-{index}"),
            source,
            Some(ByteRange {
                start,
                end: start + selected_text.len(),
            }),
        )
        .unwrap();
        validate_selection_response(
            &envelope,
            SelectionResponse {
                schema_version: 1,
                replacement_text: replacement.to_string(),
                warnings: Vec::new(),
            },
        )
        .unwrap_err();
    }
}

fn load_fixture_catalog() -> Vec<FixtureSpec> {
    let catalog_path = fixture_root().join("catalog.json");
    let catalog = fs::read_to_string(&catalog_path)
        .unwrap_or_else(|error| panic!("failed to read fixture catalog {catalog_path:?}: {error}"));

    serde_json::from_str::<Vec<FixtureSpec>>(&catalog)
        .unwrap_or_else(|error| panic!("failed to parse fixture catalog {catalog_path:?}: {error}"))
}

fn count_category_fixtures_for_release(
    fixtures: &[FixtureSpec],
    category: &str,
    release_gate: ReleaseGate,
) -> usize {
    fixtures
        .iter()
        .filter(|fixture| {
            fixture.category == category
                && (fixture.release_gate.is_empty() || fixture.release_gate.contains(&release_gate))
        })
        .count()
}

fn run_fixture(fixture: &FixtureSpec) {
    let source = read_fixture_file(&fixture.source);
    let expected = read_fixture_file(&fixture.expected);
    let view = open_wysiwyg_view(&fixture.id, &source);

    match fixture.policy {
        FixturePolicy::ByteForByte => {
            assert!(
                view.iter().all(|block| !matches!(
                    block.presentation(),
                    WysiwygBlockPresentation::RawFallback(_)
                )),
                "fixture {} unexpectedly required a raw fallback block",
                fixture.id
            );
        }
        FixturePolicy::CanonicalEquivalent => {}
        FixturePolicy::RawPreserved => {
            assert!(
                view.iter().any(|block| matches!(
                    block.presentation(),
                    WysiwygBlockPresentation::RawFallback(_)
                )),
                "fixture {} should surface a raw fallback block in WYSIWYG mode",
                fixture.id
            );
        }
    }

    match fixture.policy {
        FixturePolicy::ByteForByte | FixturePolicy::RawPreserved => {
            let persisted = save_without_edits(&fixture.id, &source);
            assert_eq!(
                persisted, expected,
                "fixture {} was not preserved by open/save without edits",
                fixture.id
            );
        }
        FixturePolicy::CanonicalEquivalent => {
            let normalized = serialize_markdown(&parse_markdown(&source));
            let expected_normalized = normalize_canonical_expected(&expected);
            assert_eq!(
                normalized, expected_normalized,
                "fixture {} did not normalize to its expected canonical markdown output",
                fixture.id
            );
            assert_eq!(
                parse_markdown(&source),
                parse_markdown(&expected),
                "fixture {} source and expected markdown should remain semantically equivalent",
                fixture.id
            );

            let persisted = save_without_edits(&fixture.id, &source);
            assert_eq!(
                persisted, source,
                "fixture {} unexpectedly rewrote untouched source during a no-op save",
                fixture.id
            );
        }
    }

    if let Some(session) = fixture.session.as_ref() {
        verify_session_expectations(&fixture.id, &source, session);
    }
}

fn save_without_edits(fixture_id: &str, source: &str) -> String {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join(format!("{}.md", fixture_id));
    fs::write(&document_path, source).unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    runtime.save_active_document().unwrap();

    fs::read_to_string(&document_path).unwrap()
}

fn read_fixture_file(relative_path: &str) -> String {
    let path = fixture_root().join(relative_path);
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read fixture file {path:?}: {error}"))
}

fn normalize_canonical_expected(expected: &str) -> String {
    expected
        .replace("\r\n", "\n")
        .trim_end_matches('\n')
        .to_string()
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

fn open_wysiwyg_view(fixture_id: &str, source: &str) -> Vec<markdowner_core::WysiwygBlockView> {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join(format!("{}.md", fixture_id));
    fs::write(&document_path, source).unwrap();

    let mut runtime = EditorRuntime::default();
    runtime.open_document(&document_path).unwrap();
    runtime.workspace().active_wysiwyg_view().unwrap()
}

fn verify_session_expectations(fixture_id: &str, source: &str, session: &SessionExpectations) {
    let temp = tempdir().unwrap();
    let document_path = temp.path().join(format!("{fixture_id}.md"));
    let session_path = temp.path().join("session.json");
    fs::write(&document_path, source).unwrap();

    let mut first_runtime = EditorRuntime::default().with_session_store(session_path.clone());
    first_runtime.open_document(&document_path).unwrap();

    if let Some(mode) = session.restored_mode {
        first_runtime.set_mode(mode);
    }

    if let Some(theme_kind) = session.restored_theme_kind {
        first_runtime.set_theme(ThemeSelection::new(theme_kind, None));
    }

    let mut restored_runtime = EditorRuntime::default().with_session_store(session_path);
    restored_runtime.restore_session().unwrap();

    if session.restore_recent_documents {
        assert_eq!(
            restored_runtime.workspace().recent_documents(),
            std::slice::from_ref(&document_path),
            "fixture {fixture_id} did not restore its recent document entry"
        );
    }

    if let Some(mode) = session.restored_mode {
        assert_eq!(
            restored_runtime.workspace().mode(),
            mode,
            "fixture {fixture_id} did not restore its editor mode"
        );
    }

    if let Some(theme_kind) = session.restored_theme_kind {
        assert_eq!(
            restored_runtime.workspace().theme(),
            &ThemeSelection::new(theme_kind, None),
            "fixture {fixture_id} did not restore its theme selection"
        );
    }
}

fn fixture_spec(
    id: &str,
    category: &str,
    policy: FixturePolicy,
    release_gate: Vec<ReleaseGate>,
) -> FixtureSpec {
    FixtureSpec {
        id: id.to_string(),
        category: category.to_string(),
        source: format!("{id}.md"),
        expected: format!("{id}.expected.md"),
        policy,
        release_gate,
        session: None,
    }
}
