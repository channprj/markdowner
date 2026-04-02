# Markdowner

[한국어 README](README.ko.md)

Markdowner is a Rust-based Markdown editor workspace that keeps editing behavior in a portable core crate and platform-specific integration in shell crates. The current repository contains the editor core plus a macOS shell layer, with the app behavior exercised through Rust tests and smoke tests.

## Feature Summary

- WYSIWYG-oriented editing for basic Markdown content
- WYSIWYG, Source, and Preview mode switching
- Typora-style inline reveal editing
- Workspace folder opening and file tree navigation
- Support for images, tables, and checklists
- Syntax highlighting for fenced code blocks
- Built-in light and dark themes
- Custom CSS theme import with restored session state

## Workspace Layout

- `crates/markdowner-core`: portable document model, Markdown parsing and serialization, theme handling, workspace state, and runtime contracts
- `crates/markdowner-macos`: macOS shell integration for file dialogs, windows, and menus
- `docs/architecture/core-platform-boundary.md`: architecture note describing the core/platform split

## Build

Markdowner is a Cargo workspace. Use a recent Rust toolchain with Cargo support for edition 2024.

```bash
cargo build
```

## Run and Verify

The repository does not currently define a packaged desktop app bundle or a `cargo run` target. The best way to exercise the current behavior is to run the verified test paths below.

Run the full workspace test suite:

```bash
cargo test
```

Run the focused checks most useful during editor development:

```bash
cargo test -p markdowner-core
cargo test -p markdowner-macos automated_ui_smoke -- --nocapture
```

The macOS smoke tests cover app launch behavior, document opening, folder navigation, mode switching, theme changes, and editing flows through the shell/runtime boundary.

## Development Notes

- The core/platform boundary is intentionally shaped so future shell crates can be added without moving editor logic out of `markdowner-core`.
- The current repository is best understood as an actively developing editor foundation rather than a packaged end-user app.

## License

MIT. See `LICENSE` for details.
