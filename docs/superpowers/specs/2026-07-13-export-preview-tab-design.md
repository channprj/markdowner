# Export Preview Tab Design

## Goal

Replace the export-options modal with a full editor-area `Export Preview` tab, extend export styling for inline code and keyboard-key elements, remove blur from every modal backdrop, and make keyboard-shortcut discovery consistent in the app menu and command palette.

## Product Decisions

- `Export Preview` is an application tab, like Settings, rather than a modal or an internal tab inside a dialog.
- Opening any document or workspace HTML/PDF export creates or reuses one transient Export Preview tab and activates it.
- The tab uses the complete editor surface below the normal tab strip. A compact settings rail and a large live preview remain visible together on wide screens; narrow screens stack them without introducing another modal.
- Closing the tab cancels the preview and returns to the previously active document or Settings tab. A successful export also closes the tab and returns to the previous tab.
- The export request remains transient and is never restored on application launch.

## Tab Model and Navigation

Extend the UI tab kind with `export`. The export tab has a fixed ID and display name, while the actual `ExportPreviewRequest` and draft style remain App-owned transient state because they contain a point-in-time document snapshot and export-specific data.

Opening an export:

1. Flush the active WYSIWYG draft when applicable.
2. Build the single-document or workspace preview request using the existing target selection rules.
3. Remember the currently active tab as the return target.
4. Append the export tab if it does not exist, or reuse it if it does.
5. Activate the export tab.

Switching away preserves the preview request and draft style. Switching back immediately restores the live preview. Closing the tab clears the request and selects the remembered return target when it still exists, otherwise the nearest remaining tab.

The export tab is excluded from persisted open-tab sessions, dirty-document checks, draft backup logic, and reopen-closed-document history, just like other transient UI tabs.

## Export Preview Surface

Refactor the existing `ExportDialog` into an `ExportPreviewTabContent` surface with no Radix Dialog dependency. It contains:

- A compact header labelled `Export Preview`, with format, document/workspace summary, Reset, Cancel, and Export actions.
- A scrollable appearance rail containing body size, font family, text and background colors, line height, paragraph spacing, content padding, inline-code colors, keyboard-key colors, and PDF paper size.
- A preview stage that consumes all remaining width and height and renders the same self-contained HTML passed to the final exporter.
- Existing loading, stale-request protection, error state, and busy locking behavior.

The preview iframe remains sandboxed. PDF previews retain the selected paper ratio; HTML previews expand to the available stage.

## Export Style Contract

Add four persisted `ExportStyle` fields:

- `inlineCodeTextColor`
- `inlineCodeBackgroundColor`
- `kbdTextColor`
- `kbdBackgroundColor`

Each value is normalized as a six-digit hex color and receives a readable default. Generated export CSS applies inline-code colors to `code:not(pre code)` and keyboard-key colors to `kbd`, including a border derived from the selected key text color. Code inside fenced/preformatted blocks remains controlled by the existing code-block theme.

Expand line-height normalization and the UI range from `1.2–2.2` to `0.8–2.2`. Persisted legacy styles remain valid and missing new fields fall back to defaults.

## Dimmed Modal Backdrops

The shared `DialogOverlay` becomes a blur-free dimmed backdrop. Remove `backdrop-blur` utilities from its default class and use a single opaque black tint with existing fade animation.

Audit every `DialogContent` override so none reintroduces blur. Quick Open is not built on Radix Dialog, so its custom backdrop must use the same dim-only treatment. Command Palette already uses dim without blur and remains the reference behavior.

Tests must verify both the shared overlay and Quick Open backdrop do not contain any backdrop-blur class while retaining a black opacity class.

## Keyboard Shortcuts Discovery

Add `Show Keyboard Shortcuts` immediately above Settings in the top-right hamburger menu. It invokes the existing shortcuts dialog and displays the current shortcut (`Cmd+/`) with the appropriate accessibility key metadata.

Rename the command-palette item to exactly `Show Keyboard Shortcuts (keymap)` while retaining its existing command ID, shortcut, and action. The keymap row label may remain human-readable as `Show keyboard shortcuts`; the requested rename applies to command-palette discovery.

## Error Handling

- Preview generation errors stay inside the Export Preview surface and disable the Export action.
- Native save-dialog cancellation keeps the preview tab open so the user can adjust or retry.
- Successful single or batch export closes the transient tab only after the write completes.
- Export failures use the existing operation-error path and preserve the preview tab and draft settings.
- If the source workspace closes while the preview is open, confirmation reports the existing workspace-no-longer-open error.

## Testing

- Export style unit tests cover new defaults, legacy normalization, invalid color fallback, line height `0.8`, and generated CSS selectors.
- Export Preview component tests cover full-surface rendering, title, all new color controls, line-height bounds, live preview updates, reset, cancel, error, and busy states.
- Document-tab tests cover export tab creation/reuse, switch, close, transient status, and exclusion from dirty/restore behavior.
- App integration tests prove save dialogs are deferred until confirmation, export tabs replace the modal, switching away/back works, successful export closes the tab, and cancellation keeps it open.
- Dialog, Quick Open, app-menu, and command-palette tests prove dim-only backdrops and shortcut discovery wording/wiring.
- Completion requires the full serial Vitest suite, TypeScript type checking, Rust tests, production build, and diff validation.

## Release

After all verification passes, create scoped Conventional Commits, integrate to `main`, run the Headatever patch dry-run and push flow, run `pnpm sync-version`, commit the synchronized metadata, and verify local `main`, `origin/main`, and the new version tag.
