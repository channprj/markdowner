# Markdowner

[한국어 README](README.ko.md)

Markdowner is a Rust-first Markdown editor desktop app built with `Tauri v2`, `React`, `Vite`, and `Tiptap`. The current repository now includes a runnable macOS desktop shell, a shared Rust document core, and the first cross-platform foundation for a future Windows build.

## Current Status

- macOS local development run works through `pnpm tauri dev`
- macOS local debug build works through `pnpm tauri build --debug`
- the app shell includes file open, folder open, save, command palette, quick open, mode switching, theme switching, drag-and-drop open, and a Rust command bridge to `markdowner-core`
- document outlines are shown in the side panel with jump-to-line support
- shell reliability includes atomic writes, external-change detection, and ErrorBoundary fallback
- Windows is still a follow-up target, but the app architecture is now aligned for the same Tauri app shell

## Development Progress Snapshot

As of 2026-05-05, Markdowner is best described as a macOS developer-preview app with a strong local-first foundation. The core desktop loop is usable: open a Markdown file or workspace, edit in WYSIWYG/Source/Split View, save safely, reopen recent files, switch themes, and recover from common external-change conflicts. Against the current v1 product ambition, the repository is roughly 60-65% complete: the shell, core file model, settings persistence, and common Markdown round-trip path are in place, while authoring power features, export, search, packaging polish, and Windows validation remain open.

Completed or solid:

- Tauri v2 desktop shell with React 19, Vite 7, TypeScript, Tiptap, CodeMirror, React Markdown, and shadcn-style UI components
- Rust workspace with `markdowner-core`, the Tauri bridge in `src-tauri`, and the older `markdowner-macos` reference crate
- File lifecycle: new document, open file, open workspace, Save, Save As, recent documents, CLI path opening, single-instance routing, drag-and-drop file/folder opening, native menu command events
- Safety model: atomic writes, read-only file protection, external disk-change detection, compare/reload/keep-local flow, dirty close confirmation, session restore
- Navigation and shell UX: Activity Bar, resizable/collapsible sidebar, workspace tree, file-name filtering, Quick Open, Command Palette, Outline panel, document stats, status bar metadata
- Markdown coverage for headings, paragraphs, quotes, bullets, checklists, images, tables, fenced code blocks, links, emphasis, inline code, and raw-preserved unsupported blocks
- Settings persistence for autosave, editor font, word wrap, startup mode, focus/typewriter toggles, asset folder, system theme following, PDF paper size, and diagnostics flag
- Custom CSS theme import with validation plus frontend scoping to Markdown content surfaces

Partially complete:

- Focus mode, Typewriter mode, diagnostics logging, asset folder, and PDF paper size are persisted in settings, but their full runtime behaviors are not implemented yet
- Code highlighting exists in the Rust core model for known code fences, but frontend preview/WYSIWYG highlighting policy still needs product-level polish
- macOS bundle generation is enabled, but production signing, notarization, release metadata, and distribution workflow are not complete
- Test coverage is meaningful at the Rust core and React shell levels, but there is no full desktop E2E, screenshot regression, or automated accessibility gate yet

Not implemented yet:

- In-document Find & Replace
- Slash command menu
- KaTeX math and Mermaid diagram rendering
- HTML/PDF/Print export
- Workspace full-text search
- Image paste/drop asset copying and relative-path insertion
- Automatic backups before overwrite
- Window size/position restore
- Windows build/test/release validation

## Feature Summary

- WYSIWYG editing surface powered by Tiptap
- Source mode powered by CodeMirror 6
- Preview mode powered by React Markdown + GFM rendering
- File open and save through the desktop shell
- Command palette (`⌘⇧P`) and quick open (`⌘P`) for rapid navigation
- Workspace folder opening and file tree navigation
- Document stats dialog and outline panel
- Support for images, tables, checklists, and fenced code blocks
- Built-in light and dark themes plus user CSS theme import
- Settings panel with font, wrapping, autosave, startup mode, theme-following, asset, PDF, and diagnostics preferences
- Rust `markdowner-core` remains the canonical Markdown/document layer

## Repository Layout

- `crates/markdowner-core`: Markdown parsing and serialization, document model, themes, workspace state, and runtime logic
- `crates/markdowner-macos`: earlier macOS shell/reference crate kept for boundary and regression coverage
- `src`: React/Vite frontend shell
- `src-tauri`: Tauri desktop shell, Rust command bridge, and app configuration
- `docs/architecture/core-platform-boundary.md`: notes on the core/platform split

## macOS Development Environment

Markdowner has been verified locally on macOS with the following toolchain available:

- `Node.js v22.20.0`
- `pnpm v10.33.0`
- `cargo 1.94.0`
- `rustc 1.94.0`
- Xcode Command Line Tools available through `xcode-select`

Minimum setup checklist:

1. Install a recent Rust toolchain
2. Install Node.js and pnpm
3. Install Xcode Command Line Tools

Example check commands:

```bash
node -v
pnpm -v
cargo -V
rustc -V
xcode-select -p
xcrun --version
```

## Install Dependencies

```bash
pnpm install
```

If `pnpm install` warns about ignored build scripts in your environment, approve the required builds and rerun install:

```bash
pnpm approve-builds
pnpm install
```

## Local Development Run on macOS

Start the desktop app in development mode:

```bash
pnpm tauri dev
```

What this does:

- starts the Vite dev server on `http://localhost:1420`
- compiles the Tauri Rust shell
- launches the local debug desktop executable

This command was verified locally in this repository. During startup, Tauri runs `pnpm dev` first, then runs the Rust desktop app from `target/debug/markdowner-desktop`.

If `pnpm tauri dev` fails immediately, first check whether port `1420` is already in use because the Vite dev server binds to that port by default.

## Local Build on macOS

### Build the Rust workspace

```bash
cargo build
```

On a fresh machine, the first Rust build downloads crate dependencies from crates.io and can take noticeably longer than subsequent builds.

### Build the frontend bundle

```bash
pnpm build
```

### Build the local Tauri debug app

```bash
pnpm tauri build --debug
```

Verified output path:

```bash
target/debug/markdowner-desktop
```

## Verify the Current App

Run the frontend and Rust test suites:

```bash
pnpm test
cargo test
```

Useful focused checks:

```bash
cargo test -p markdowner-core
pnpm build
pnpm tauri build --debug
```

## Notes and Current Limitations

- The Tauri desktop shell is working locally on macOS and bundle generation is enabled (`"bundle.active": true` in `src-tauri/tauri.conf.json`); production-signing/notarization flow is still follow-up.
- The frontend production bundle is currently large enough to trigger Vite's chunk size warning.
- Windows support is a planned next step rather than a completed local workflow.
- `crates/markdowner-macos` still exists as a reference implementation and regression target while the Tauri shell becomes the main app entrypoint.

## License

MIT. See `LICENSE` for details.
