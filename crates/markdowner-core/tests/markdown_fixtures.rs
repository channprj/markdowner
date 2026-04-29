use std::{
    fs,
    path::{Path, PathBuf},
};

use markdowner_core::{EditorRuntime, WysiwygBlockPresentation};
use serde::Deserialize;
use tempfile::tempdir;

#[derive(Debug, Deserialize)]
struct FixtureSpec {
    id: String,
    category: String,
    source: String,
    expected: String,
    policy: FixturePolicy,
}

#[derive(Debug, Clone, Copy, Deserialize)]
enum FixturePolicy {
    #[serde(rename = "byte-for-byte")]
    ByteForByte,
    #[serde(rename = "raw-preserved")]
    RawPreserved,
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
