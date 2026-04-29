use std::{
    fs,
    path::{Path, PathBuf},
};

use markdowner_core::{
    EditorMode, EditorRuntime, ThemeKind, ThemeSelection, WysiwygBlockPresentation,
};
use serde::Deserialize;
use tempfile::tempdir;

#[derive(Debug, Deserialize)]
struct FixtureSpec {
    id: String,
    category: String,
    source: String,
    expected: String,
    policy: FixturePolicy,
    #[serde(default)]
    session: Option<SessionExpectations>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
enum FixturePolicy {
    #[serde(rename = "byte-for-byte")]
    ByteForByte,
    #[serde(rename = "raw-preserved")]
    RawPreserved,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct SessionExpectations {
    restore_recent_documents: bool,
    restored_mode: Option<EditorMode>,
    restored_theme_kind: Option<ThemeKind>,
}

impl Default for SessionExpectations {
    fn default() -> Self {
        Self {
            restore_recent_documents: false,
            restored_mode: None,
            restored_theme_kind: None,
        }
    }
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
    let heading_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "headings-and-paragraphs")
        .count();
    let inline_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "inline-formatting")
        .count();
    let code_fence_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "code-fences")
        .count();
    let image_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "images")
        .count();
    let list_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "lists-and-checklists")
        .count();
    let table_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "tables")
        .count();
    let unsupported_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "unsupported")
        .count();
    let workspace_session_fixtures = fixtures
        .iter()
        .filter(|fixture| fixture.category == "workspace-and-session")
        .count();

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

fn load_fixture_catalog() -> Vec<FixtureSpec> {
    let catalog_path = fixture_root().join("catalog.json");
    let catalog = fs::read_to_string(&catalog_path)
        .unwrap_or_else(|error| panic!("failed to read fixture catalog {catalog_path:?}: {error}"));

    serde_json::from_str::<Vec<FixtureSpec>>(&catalog)
        .unwrap_or_else(|error| panic!("failed to parse fixture catalog {catalog_path:?}: {error}"))
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

    let persisted = save_without_edits(&fixture.id, &source);
    assert_eq!(
        persisted, expected,
        "fixture {} was not preserved by open/save without edits",
        fixture.id
    );

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
