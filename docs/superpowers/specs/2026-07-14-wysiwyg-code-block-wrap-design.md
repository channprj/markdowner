# WYSIWYG Code Block Wrap Design

## Goal

Let users independently choose whether code blocks wrap in WYSIWYG mode. Expose the preference in Settings and the command palette, persist it across launches, and preserve the current no-wrap behavior for existing and new installations until the user enables it.

## Product decisions

- Add a dedicated `wysiwygCodeBlockWrap` boolean preference with a default of `false`.
- The preference affects editable code blocks in WYSIWYG mode only. Source mode and Split View preview retain their existing behavior.
- The preference is independent of the general `editorLineWrap` setting. When code-block wrapping is enabled, WYSIWYG code blocks wrap even if prose wrapping is disabled.
- Wrapping applies to ordinary fenced code blocks and the editable Mermaid source. It does not alter the rendered Mermaid diagram.
- Wrapped code preserves explicit newlines and indentation. Long unbroken tokens may break at the pane boundary instead of forcing horizontal overflow.
- No keyboard shortcut is added. The command palette provides quick access without expanding the global keymap surface.

## Settings contract and persistence

The frontend `Settings` contract, `DEFAULT_SETTINGS`, and settings normalization gain:

```ts
wysiwygCodeBlockWrap: boolean;
```

Missing or malformed values normalize to `false`. The Rust settings model gains the corresponding `wysiwyg_code_block_wrap` field with the same default. Its existing `#[serde(default)]` behavior keeps legacy settings files compatible, while updating both models prevents the backend from dropping the new field during a save round trip.

Reset to Defaults restores the preference to `false`. All existing settings-change and diagnostics paths continue to operate through the shared `handleSettingsChange` flow.

## Settings UI

Add a switch in Editor Preferences near the existing Word Wrap controls:

- Label: `WYSIWYG Code Block Wrap`
- Help text: `Wrap long code lines instead of scrolling horizontally.`

The switch is controlled by `settings.wysiwygCodeBlockWrap` and emits a full updated `Settings` value through `onSettingsChange`, matching the existing settings-panel pattern.

## Command palette

Add an always-available Preferences command with the stable ID:

```text
preferences.toggleWysiwygCodeBlockWrap
```

The visible label describes the next action:

- Current value `false`: `Enable WYSIWYG Code Block Wrap`
- Current value `true`: `Disable WYSIWYG Code Block Wrap`

The command calls the existing `actions.updateSettings` function with the inverted preference. It has no submenu, disabled state, or shortcut. Keeping `WYSIWYG`, `Code Block`, and `Wrap` in the label makes the command discoverable through the palette's label-and-category search.

## Runtime rendering

`App` passes the preference to `EditorArea`. `EditorArea` renders `data-code-block-wrap="on"` or `data-code-block-wrap="off"` on the WYSIWYG pane only. The source and preview panes do not receive the attribute.

Pane-scoped CSS overrides the current no-wrap code-block rules only when the attribute is `on`:

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
```

Selectors cover both DOM shapes rendered by the code-block NodeView:

- ordinary `.code-block-view > pre` and its editable `code`
- Mermaid `.mermaid-source-pre` and its editable `code`

The rendered Mermaid canvas, language picker, copy button, syntax-highlighting spans, and Split View preview remain unchanged. When the preference is `off`, the existing `white-space: pre` and horizontal scrolling behavior remain authoritative.

## Keyboard behavior

The code-block ArrowDown handler currently identifies the last logical source line by checking for an explicit newline after the caret. A visually wrapped final source line can therefore appear to have more rows while still satisfying that logical-line check.

Before exiting a code block, the handler will also require `editor.view.endOfTextblock('down')`. ArrowDown stays inside the code block when another visual row exists and exits only at the actual visual bottom. Existing behavior for explicit newlines, paragraph creation below a terminal code block, the language picker, ArrowUp, and Mod-Enter remains unchanged.

## Failure and compatibility handling

- Legacy or corrupt settings without a boolean wrap value fall back to `false`.
- Saving failures retain the existing logged, non-crashing settings behavior.
- CSS is scoped to the WYSIWYG pane so shared preview code-block components cannot inherit the new behavior accidentally.
- The preference changes presentation only; it does not alter Markdown source or code-block serialization.
- The keyboard boundary check uses the editor view's layout-aware API and keeps the existing logical-newline guard, so headless or non-terminal positions continue to fall through safely.

## Testing and verification

- Frontend settings tests cover the default, malformed persisted values, changed-key detection, and save/load normalization.
- Rust settings tests cover the legacy default and an enabled-value JSON round trip.
- Settings panel tests prove the switch reflects its value and emits the inverted preference.
- Command-palette tests cover command order, both next-action labels, and the complete updated settings payload.
- EditorArea tests prove the attribute is present on the WYSIWYG pane only and reflects both states.
- Stylesheet tests prove wrap-on rules are WYSIWYG-scoped and cover ordinary and Mermaid source code.
- Code-block extension tests prove ArrowDown does not exit from a visually wrapped row and still exits from the visual bottom.
- App integration tests prove both Settings and command-palette changes persist through `save_settings` and update the mounted WYSIWYG surface immediately.
- Completion requires focused Vitest and Rust settings tests, the full serial frontend suite, TypeScript checking, a production build, `git diff --check`, and a final source-level requirement audit.

## Commit sequence

1. Commit and push this design document.
2. Implement and push the persisted setting, Settings UI, and command-palette command with their tests.
3. Implement and push WYSIWYG rendering, keyboard-boundary handling, and integration coverage.
