//! Finder Quick Look HTML for a Markdown file.
//!
//! shortcut: Quick Look renders this HTML without JavaScript, so Mermaid stays
//! a fenced code block. Upgrade when the preview has to draw diagrams.

use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::c_char;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, html};

const MAX_MARKDOWN_BYTES: u64 = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Render `markdown` to a full HTML document. `asset_dir` is the directory
/// relative image paths are resolved against.
pub fn render_quicklook_html(markdown: &str, asset_dir: Option<&Path>) -> String {
    let (front_matter, body) = split_front_matter(markdown);
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_GFM;
    let mut embedded_bytes = 0usize;
    let parser = Parser::new_ext(body, options).map(|event| match event {
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let (dest_url, spent) = embed_image(&dest_url, asset_dir, embedded_bytes);
            embedded_bytes += spent;
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            })
        }
        other => other,
    });
    let mut article = String::new();
    html::push_html(&mut article, parser);
    wrap_document(front_matter, &article)
}

fn render_quicklook_file(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if meta.len() > MAX_MARKDOWN_BYTES {
        return Ok(wrap_document(
            None,
            "<p>This Markdown file is too large to preview.</p>",
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let markdown = String::from_utf8_lossy(&bytes);
    Ok(render_quicklook_html(&markdown, path.parent()))
}

fn split_front_matter(source: &str) -> (Option<&str>, &str) {
    let mut lines = source.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (None, source);
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return (None, source);
    }
    let mut index = first.len();
    for line in lines {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let front = source[first.len()..index].trim_end_matches(['\r', '\n']);
            let body = &source[index + line.len()..];
            return (Some(front), body);
        }
        index += line.len();
    }
    (None, source)
}

fn embed_image(
    url: &str,
    asset_dir: Option<&Path>,
    embedded_so_far: usize,
) -> (CowStr<'static>, usize) {
    if url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("data:")
        || url.is_empty()
    {
        return (CowStr::from(url.to_string()), 0);
    }
    let Some(asset_dir) = asset_dir else {
        return (CowStr::from(url.to_string()), 0);
    };
    if embedded_so_far >= MAX_EMBEDDED_IMAGE_BYTES {
        return (CowStr::from(url.to_string()), 0);
    }
    let decoded = percent_decode(url);
    let path = image_path(asset_dir, &decoded);
    let Some(mime) = image_mime(&path) else {
        return (CowStr::from(url.to_string()), 0);
    };
    let Ok(meta) = fs::metadata(&path) else {
        return (CowStr::from(url.to_string()), 0);
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_IMAGE_BYTES {
        return (CowStr::from(url.to_string()), 0);
    }
    let len = usize::try_from(meta.len()).unwrap_or(usize::MAX);
    if embedded_so_far.saturating_add(len) > MAX_EMBEDDED_IMAGE_BYTES {
        return (CowStr::from(url.to_string()), 0);
    }
    let Ok(bytes) = fs::read(&path) else {
        return (CowStr::from(url.to_string()), 0);
    };
    let encoded = STANDARD.encode(bytes);
    (CowStr::from(format!("data:{mime};base64,{encoded}")), len)
}

fn image_path(asset_dir: &Path, url: &str) -> PathBuf {
    let path = Path::new(url);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        asset_dir.join(path)
    }
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("svg") => Some("image/svg+xml"),
        Some("bmp") => Some("image/bmp"),
        Some("avif") => Some("image/avif"),
        _ => None,
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) =
                (hex_nibble(bytes[index + 1]), hex_nibble(bytes[index + 2]))
            {
                out.push((hi << 4) | lo);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn wrap_document(front_matter: Option<&str>, article: &str) -> String {
    let properties = front_matter
        .filter(|value| !value.is_empty())
        .map(|value| {
            format!(
                "<section class=\"properties\"><h2>Properties</h2><pre>{}</pre></section>",
                escape_html(value)
            )
        })
        .unwrap_or_default();
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {{ color-scheme: light dark; }}
body {{
  margin: 0 auto;
  max-width: 760px;
  padding: 36px 28px 64px;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  color: CanvasText;
  background: Canvas;
}}
h1, h2, h3, h4, h5, h6 {{ line-height: 1.25; margin: 1.4em 0 0.5em; }}
h1 {{ font-size: 2em; margin-top: 0; }}
p, ul, ol, blockquote, pre, table {{ margin: 0.8em 0; }}
a {{ color: LinkText; }}
img {{ max-width: 100%; height: auto; }}
blockquote {{
  margin-left: 0;
  padding-left: 14px;
  border-left: 3px solid color-mix(in srgb, CanvasText 28%, Canvas);
  color: color-mix(in srgb, CanvasText 82%, Canvas);
}}
code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }}
:not(pre) > code {{
  background: color-mix(in srgb, CanvasText 8%, Canvas);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}}
pre {{
  background: color-mix(in srgb, CanvasText 6%, Canvas);
  padding: 12px 14px;
  overflow: auto;
  border-radius: 8px;
}}
pre code {{ background: none; padding: 0; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{
  border: 1px solid color-mix(in srgb, CanvasText 22%, Canvas);
  padding: 6px 8px;
  text-align: left;
}}
li > input[type="checkbox"] {{ margin-right: 0.4em; }}
.properties {{
  border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 28px;
  font-size: 12px;
}}
.properties h2 {{
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: color-mix(in srgb, CanvasText 62%, Canvas);
}}
.properties pre {{
  margin: 0;
  padding: 0;
  background: none;
  white-space: pre-wrap;
}}
</style>
</head>
<body>
{properties}
<article>{article}</article>
</body>
</html>
"#
    )
}

fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(character),
        }
    }
    out
}

/// Render the Markdown file at `path` to a newly allocated UTF-8 HTML string.
/// The caller frees it with `markdowner_quicklook_free`. Returns null on error.
///
/// # Safety
/// `path` must be null or a valid C string for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn markdowner_quicklook_render(path: *const c_char) -> *mut c_char {
    if path.is_null() {
        return std::ptr::null_mut();
    }
    let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
        return std::ptr::null_mut();
    };
    let Ok(html) = std::panic::catch_unwind(|| render_quicklook_file(Path::new(path))) else {
        return std::ptr::null_mut();
    };
    let Ok(html) = html else {
        return std::ptr::null_mut();
    };
    let html = html.replace('\0', "\u{FFFD}");
    CString::new(html)
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `ptr` must be null or a pointer returned by `markdowner_quicklook_render`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn markdowner_quicklook_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PIXEL_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8,
        0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x8E, 0x21, 0x37, 0x0A, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn renders_gfm_as_a_document() {
        let html = render_quicklook_html(
            "# Title\n\n**bold** and ~~gone~~\n\n- [x] done\n- [ ] later\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```rust\nlet x = 1;\n```\n\nA < B\n",
            None,
        );
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<del>gone</del>"));
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("checked"));
        assert!(html.contains("<table>"));
        assert!(html.contains("<pre><code class=\"language-rust\">"));
        assert!(html.contains("A &lt; B"));
        assert!(html.contains("color-scheme: light dark"));
    }

    #[test]
    fn shows_front_matter_separately_from_the_body() {
        let html = render_quicklook_html("---\ntitle: Hello & Co\n---\n# Body\n", None);
        assert!(html.contains("<h2>Properties</h2>"));
        assert!(html.contains("title: Hello &amp; Co"));
        assert!(html.contains("<h1>Body</h1>"));
        assert!(!html.contains("<hr"));
    }

    #[test]
    fn leaves_an_unclosed_fence_in_the_body() {
        let html = render_quicklook_html("---\nnot closed\n\n# Hi\n", None);
        assert!(html.contains("<h1>Hi</h1>"));
        assert!(!html.contains("Properties"));
    }

    #[test]
    fn embeds_a_local_image_and_leaves_other_sources() {
        let dir = std::env::temp_dir().join(format!("markdowner-ql-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("pixel.png"), PIXEL_PNG).unwrap();
        fs::write(dir.join("notes.txt"), b"secret").unwrap();
        let html = render_quicklook_html(
            "![dot](pixel.png)\n\n![web](https://example.com/a.png)\n\n![text](notes.txt)\n\n![space](my%20pic.png)\n",
            Some(&dir),
        );
        assert!(html.contains("data:image/png;base64,"));
        assert!(html.contains("https://example.com/a.png"));
        assert!(html.contains("notes.txt"));
        assert!(!html.contains("secret"));
        fs::write(dir.join("my pic.png"), PIXEL_PNG).unwrap();
        let spaced = render_quicklook_html("![space](my%20pic.png)\n", Some(&dir));
        assert!(spaced.contains("data:image/png;base64,"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_file_gets_a_short_document() {
        let dir = std::env::temp_dir().join(format!("markdowner-ql-big-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big.md");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_MARKDOWN_BYTES + 1).unwrap();
        let html = render_quicklook_file(&path).unwrap();
        assert!(html.contains("too large to preview"));
        assert!(!html.contains("<h1>"));
        let _ = fs::remove_dir_all(&dir);
    }
}
