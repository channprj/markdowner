use std::path::Path;

use serde::Serialize;

/// Markdown link click resolution.
///
/// Markdown links arrive as raw href strings: `[text](href)`. The frontend uses
/// this classification to open markdown files in Markdowner, other local files
/// through the OS handler, and external URLs in the system browser.
#[derive(Debug, Serialize)]
// `rename_all` only renames the variant names (the `kind` tag). The fields of
// struct variants (`absolute_path`) need `rename_all_fields` too, otherwise
// they serialize snake_case and the frontend's `resolved.absolutePath` is
// undefined — which fed `undefined` into `open_document` ("missing required
// key path") and silently broke every markdown link click.
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ResolvedLink {
    Markdown { absolute_path: String },
    File { absolute_path: String },
    External { href: String },
    Anchor { fragment: String },
    Unresolved { reason: String },
}

fn is_markdown_path(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => matches!(
            ext.to_ascii_lowercase().as_str(),
            "md" | "markdown" | "mdown" | "mkd"
        ),
        None => false,
    }
}

fn classify_external_scheme(href: &str) -> bool {
    let lowered = href.trim_start().to_ascii_lowercase();
    [
        "http://", "https://", "mailto:", "tel:", "ftp://", "ftps://", "ssh://", "file://",
    ]
    .iter()
    .any(|prefix| lowered.starts_with(prefix))
}

#[tauri::command]
pub fn resolve_markdown_link(
    href: String,
    base_path: Option<String>,
) -> Result<ResolvedLink, String> {
    let trimmed = href.trim();
    if trimmed.is_empty() {
        return Ok(ResolvedLink::Unresolved {
            reason: "Link target is empty".to_string(),
        });
    }

    if let Some(fragment) = trimmed.strip_prefix('#') {
        return Ok(ResolvedLink::Anchor {
            fragment: fragment.to_string(),
        });
    }

    if classify_external_scheme(trimmed) {
        return Ok(ResolvedLink::External {
            href: trimmed.to_string(),
        });
    }

    let without_fragment = trimmed
        .split_once('#')
        .map(|(path, _)| path)
        .unwrap_or(trimmed);
    let path_only = without_fragment
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(without_fragment);

    let candidate = Path::new(path_only);
    let absolute = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else if let Some(base) = base_path.as_deref() {
        match Path::new(base).parent() {
            Some(dir) => dir.join(candidate),
            None => {
                return Ok(ResolvedLink::Unresolved {
                    reason: "Base path has no parent directory".to_string(),
                });
            }
        }
    } else {
        return Ok(ResolvedLink::Unresolved {
            reason: "Cannot resolve relative link without an active document".to_string(),
        });
    };

    let canonical = absolute.canonicalize().unwrap_or(absolute);
    let absolute_path = canonical.to_string_lossy().to_string();

    if is_markdown_path(&canonical) {
        Ok(ResolvedLink::Markdown { absolute_path })
    } else {
        Ok(ResolvedLink::File { absolute_path })
    }
}

#[tauri::command]
pub fn open_external_url(href: String) -> Result<(), String> {
    let trimmed = href.trim();
    if trimmed.is_empty() {
        return Err("Cannot open an empty URL".to_string());
    }
    open_with_os_default(trimmed)
}

#[tauri::command]
pub fn open_path_in_default_app(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Cannot open an empty path".to_string());
    }
    open_with_os_default(trimmed)
}

fn open_with_os_default(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to launch `open`: {err}"))
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to launch `start`: {err}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to launch `xdg-open`: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::{ResolvedLink, classify_external_scheme, is_markdown_path, resolve_markdown_link};

    #[test]
    fn markdown_variant_serializes_camel_case_absolute_path() {
        // The frontend (desktop.ts ResolvedLink) reads `resolved.absolutePath`
        // and feeds it to `open_document`. The JSON field MUST be camelCase.
        let json = serde_json::to_string(&ResolvedLink::Markdown {
            absolute_path: "/tmp/next.md".to_string(),
        })
        .unwrap();
        assert!(
            json.contains("\"absolutePath\":\"/tmp/next.md\""),
            "expected camelCase absolutePath, got: {json}"
        );
        assert!(!json.contains("absolute_path"), "snake_case leaked: {json}");
    }

    #[test]
    fn is_markdown_path_matches_common_extensions() {
        assert!(is_markdown_path(Path::new("notes.md")));
        assert!(is_markdown_path(Path::new("notes.markdown")));
        assert!(is_markdown_path(Path::new("notes.MDOWN")));
        assert!(is_markdown_path(Path::new("notes.MKD")));
        assert!(!is_markdown_path(Path::new("notes.txt")));
        assert!(!is_markdown_path(Path::new("script.sh")));
        assert!(!is_markdown_path(Path::new("noext")));
    }

    #[test]
    fn classify_external_scheme_recognises_supported_schemes() {
        assert!(classify_external_scheme("https://example.com"));
        assert!(classify_external_scheme("http://example.com"));
        assert!(classify_external_scheme("  https://example.com"));
        assert!(classify_external_scheme("mailto:alice@example.com"));
        assert!(classify_external_scheme("tel:+1-555-0100"));
        assert!(classify_external_scheme("ssh://git@github.com"));
        assert!(!classify_external_scheme("foo.md"));
        assert!(!classify_external_scheme("./relative/path.md"));
        assert!(!classify_external_scheme("/absolute/path.md"));
        assert!(!classify_external_scheme(""));
    }

    #[test]
    fn resolve_markdown_link_handles_external_urls() {
        let resolved = resolve_markdown_link("https://example.com".to_string(), None).unwrap();
        match resolved {
            ResolvedLink::External { href } => assert_eq!(href, "https://example.com"),
            other => panic!("expected External, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_handles_anchor_only_links() {
        let resolved = resolve_markdown_link("#section-1".to_string(), None).unwrap();
        match resolved {
            ResolvedLink::Anchor { fragment } => assert_eq!(fragment, "section-1"),
            other => panic!("expected Anchor, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_resolves_relative_markdown_against_active_doc() {
        let temp = tempdir().unwrap();
        let active = temp.path().join("index.md");
        fs::write(&active, "# Index").unwrap();
        let sibling = temp.path().join("other.md");
        fs::write(&sibling, "# Other").unwrap();

        let resolved = resolve_markdown_link(
            "./other.md".to_string(),
            Some(active.to_string_lossy().to_string()),
        )
        .unwrap();

        match resolved {
            ResolvedLink::Markdown { absolute_path } => {
                let canonical = sibling.canonicalize().unwrap();
                assert_eq!(Path::new(&absolute_path), canonical);
            }
            other => panic!("expected Markdown, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_uses_active_doc_parent_without_requiring_disk_file() {
        let temp = tempdir().unwrap();
        let deleted_or_unsaved_path = temp.path().join("missing.md");

        let resolved = resolve_markdown_link(
            "drafts/next.md".to_string(),
            Some(deleted_or_unsaved_path.to_string_lossy().to_string()),
        )
        .unwrap();

        match resolved {
            ResolvedLink::Markdown { absolute_path } => {
                assert_eq!(
                    Path::new(&absolute_path),
                    temp.path().join("drafts/next.md")
                );
            }
            other => panic!("expected Markdown, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_strips_fragment_and_query() {
        let temp = tempdir().unwrap();
        let active = temp.path().join("index.md");
        fs::write(&active, "# Index").unwrap();
        let sibling = temp.path().join("notes.md");
        fs::write(&sibling, "# Notes").unwrap();

        let resolved = resolve_markdown_link(
            "notes.md#heading-2".to_string(),
            Some(active.to_string_lossy().to_string()),
        )
        .unwrap();

        match resolved {
            ResolvedLink::Markdown { absolute_path } => {
                let canonical = sibling.canonicalize().unwrap();
                assert_eq!(Path::new(&absolute_path), canonical);
            }
            other => panic!("expected Markdown, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_classifies_non_markdown_local_files() {
        let temp = tempdir().unwrap();
        let active = temp.path().join("index.md");
        fs::write(&active, "# Index").unwrap();
        let image = temp.path().join("avatar.png");
        fs::write(&image, [137, 80, 78, 71]).unwrap();

        let resolved = resolve_markdown_link(
            "./avatar.png".to_string(),
            Some(active.to_string_lossy().to_string()),
        )
        .unwrap();

        match resolved {
            ResolvedLink::File { absolute_path } => {
                let canonical = image.canonicalize().unwrap();
                assert_eq!(Path::new(&absolute_path), canonical);
            }
            other => panic!("expected File, got {:?}", other),
        }
    }

    #[test]
    fn resolve_markdown_link_returns_unresolved_for_empty_and_unrooted_links() {
        let empty = resolve_markdown_link(String::new(), None).unwrap();
        assert!(matches!(empty, ResolvedLink::Unresolved { .. }));

        let no_base = resolve_markdown_link("./other.md".to_string(), None).unwrap();
        assert!(matches!(no_base, ResolvedLink::Unresolved { .. }));
    }
}
