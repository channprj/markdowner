# Export Theme Presets Design

## Goal

Make HTML and PDF exports use one coherent light or dark palette, defaulting to the current application theme while still allowing the user to choose a fixed palette or customize every exported color. Add a preset selector to the top of Export Preview configuration and simplify the configuration heading.

## Root cause

`buildExportHtml` copies the live document's `data-theme` attribute and all bundled CSS into the standalone export. Table borders and header backgrounds therefore resolve through the application's theme variables such as `--border` and `--muted`.

The later export override sets a separate persisted text color and page background, whose existing defaults are always light. With a dark application theme, the page becomes light while table borders, table headers, blockquotes, and other semantic surfaces continue to use dark variables. Export Preview also places the iframe inside a hard-coded white sheet. The result is a mixed palette in both preview and the final PDF rather than a PDF-renderer-specific defect.

## Product decisions

- A fresh or unchanged legacy export style starts with the `Match app theme` preset.
- `Match app theme` resolves to the current built-in Light or Dark application theme each time Export Preview opens. If the app theme changes while the preview is open, a draft that is still using this preset follows it.
- The Preset dropdown appears before every other control and contains `Match app theme`, `Light`, `Dark`, and `Custom`.
- `Light` and `Dark` are fixed full-style presets. They do not change when the application theme changes.
- Changing any typography, spacing, or color control changes the selected preset to `Custom`. Changing PDF paper size does not, because paper size is an output target rather than an appearance preset.
- Selecting a non-custom preset replaces all appearance fields while preserving the current PDF paper size. Selecting `Custom` keeps the current values.
- Reset returns all appearance values to `Match app theme` while preserving the request's initial paper size.
- The confirmed preset and resolved values are persisted. A confirmed `Match app theme` style can therefore resolve to the other palette on a later export after the app theme changes, while fixed and custom styles remain unchanged.
- Existing saved styles without a preset migrate to `Match app theme` only when every previously supported appearance field equals the old defaults. Any legacy customization migrates to `Custom` without losing its values.
- Custom CSS themes retain their embedded stylesheet and use the Light preset as the fallback export palette because their arbitrary CSS cannot be reduced reliably to the editable hex-color contract. The user can choose Dark or Custom explicitly.

## Export style contract

Add a persisted preset discriminator and three table-specific colors:

```ts
export type ExportStylePreset = 'app' | 'light' | 'dark' | 'custom';
export type ExportTheme = 'light' | 'dark';

export interface ExportStyle {
  preset: ExportStylePreset;
  // existing typography, page, inline-code, and keyboard-key fields
  tableBorderColor: string;
  tableHeaderTextColor: string;
  tableHeaderBackgroundColor: string;
}
```

All colors continue to be normalized as six-digit hex strings. The Light preset keeps the current readable light values and adds neutral table colors. The Dark preset uses a zinc-like dark page, light foreground, dark inline surfaces, visible neutral borders, and a distinct table header surface. Preset definitions live beside the export style model so preview controls and generated artifacts cannot drift.

The public helpers are:

```ts
export function applyExportStylePreset(
  style: ExportStyle,
  preset: ExportStylePreset,
  appTheme: ExportTheme,
): ExportStyle;

export function resolveExportStyleForTheme(
  style: ExportStyle,
  appTheme: ExportTheme,
): ExportStyle;
```

`applyExportStylePreset` preserves `paperSize`. `resolveExportStyleForTheme` materializes only the `app` preset and returns fixed/custom styles unchanged after normalization.

## Generated CSS

`buildExportHtml` derives the current built-in application theme from the document root, resolves the style preset, and appends export overrides after collected application and custom-theme CSS.

The export root sets a complete set of semantic values used by Markdown surfaces, not only page foreground and background:

```css
.markdowner-export {
  --foreground: <textColor>;
  --background: <backgroundColor>;
  --border: <tableBorderColor>;
  --muted: <tableHeaderBackgroundColor>;
}
.markdowner-export th,
.markdowner-export td {
  border-color: <tableBorderColor>;
}
.markdowner-export th {
  color: <tableHeaderTextColor>;
  background: <tableHeaderBackgroundColor>;
}
```

Explicit later-wins rules ensure table rendering is coherent even when the copied root still carries the opposite application theme for syntax highlighting. Blockquotes, horizontal rules, code-block surfaces, and other rules that consume `--border` or `--muted` also inherit the chosen export palette. HTML and PDF continue to use exactly the same generated document.

## Export Preview UI

`ExportPreviewTab` receives the current `appTheme` in addition to its existing request and initial style. The first control is a native select labelled `Preset`. Its change handler applies the selected preset immediately and rebuilds the iframe.

The left-rail heading changes from `Artifact controls` to `Config`. The sentence `Every value below is applied to both this preview and the exported file.` is removed without replacement.

Add a `Table` fieldset containing:

- Table border color
- Table header text color
- Table header background color

All non-paper control handlers mark the draft as `Custom`. The preview sheet and iframe background use `draftStyle.backgroundColor` instead of `bg-white`, preventing a white flash or white frame around dark output.

## Application integration

`App` maps `BuiltInDark` to the dark export theme and every other theme kind to the light fallback. It resolves the saved export style before passing `initialStyle` into Export Preview and passes `appTheme` separately so the dropdown can reapply `Match app theme`.

Confirming continues to normalize and persist the complete style before generating one or more artifacts. The final `buildExportHtml` call resolves the `app` preset again from the live document, so preview and artifact remain identical even if export orchestration is invoked outside the visible preview component.

## Failure and compatibility handling

- Invalid preset identifiers normalize to `Custom` when the input contains legacy custom values and otherwise to `Match app theme`.
- Missing or invalid new table colors fall back to the palette associated with a valid fixed preset; legacy custom styles fall back to the Light table colors, matching their historic page defaults.
- Local-storage parse and write failures retain the existing fail-safe behavior.
- PDF and HTML workspace exports share the same resolver as single-document exports.
- No native/Tauri PDF code changes are required because the defect exists in the generated HTML/CSS before pagination.

## Testing and verification

- Export model tests cover both palettes, preset application, paper-size preservation, legacy default/custom migration, invalid values, and storage round trips.
- Generated-HTML tests create table Markdown under a dark document theme and assert later export CSS includes coherent dark page, border, and header colors. A fixed Light style under the same dark root must remain light.
- Export Preview tests cover the first-position Preset control, preset switching, automatic Custom selection, table controls, Config wording, removal of the verbose sentence, Reset behavior, dark preview background, and busy-state disabling.
- App tests prove the active application theme reaches Export Preview and that a fixed/custom selection remains the style passed to confirmation.
- Completion requires focused tests, the full serial Vitest suite, TypeScript checking, production build, and a source-level requirement audit.
