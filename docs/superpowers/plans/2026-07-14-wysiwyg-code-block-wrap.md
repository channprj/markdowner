# WYSIWYG Code Block Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, independently toggleable WYSIWYG code-block wrap preference to Settings and the command palette without changing source or Split View preview rendering.

**Architecture:** Extend the shared TypeScript and Rust settings contracts with a default-off boolean, then route all UI changes through the existing full-settings update path. Pass the value only to `EditorArea`, expose it as a WYSIWYG-pane data attribute, and use pane-scoped CSS for ordinary and Mermaid source blocks; retain the current Tiptap NodeView and add a layout-aware ArrowDown boundary check.

**Tech Stack:** React 19, TypeScript, Tiptap/ProseMirror, Tailwind-backed CSS, Vitest, Testing Library, Rust/Serde, Tauri settings commands, pnpm, Cargo.

---

## File map

- `src/lib/settings.ts`: frontend settings type, default, and malformed-value normalization.
- `src/lib/settings.test.ts`: frontend default, migration, and changed-key contract.
- `crates/markdowner-core/src/settings.rs`: persisted Rust/Serde settings schema and legacy compatibility.
- `src/shell/SettingsPanel.tsx`: controlled Settings switch and help text.
- `src/shell/SettingsPanel.test.tsx`: switch rendering and emitted value.
- `src/shell/commandPaletteCommands.ts`: stable toggle command, next-action label, and update action.
- `src/shell/commandPaletteCommands.test.ts`: command order, labels, and emitted settings.
- `src/shell/EditorArea.tsx`: WYSIWYG-only runtime data attribute.
- `src/shell/EditorArea.test.tsx`: attribute state and pane isolation.
- `src/styles.css`: scoped wrap-on declarations for ordinary and Mermaid source blocks.
- `src/styles.test.ts`: selector scope and wrap declaration regression coverage.
- `src/components/wysiwyg/codeBlockExtension.ts`: visual-bottom check before ArrowDown exits a code block.
- `src/components/wysiwyg/codeBlockExtension.test.ts`: explicit-line, wrapped-row, final-row, and terminal-block behavior.
- `src/App.tsx`: settings-to-EditorArea data flow.
- `src/App.test.tsx`: Settings and command-palette persistence plus immediate runtime updates.

### Task 1: Persist and expose the preference in Settings and the command palette

**Files:**
- Modify: `src/lib/settings.test.ts`
- Modify: `src/lib/settings.ts`
- Modify: `crates/markdowner-core/src/settings.rs`
- Modify: `src/shell/SettingsPanel.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write failing frontend settings tests**

Import `saveSettings` from `./settings`, then add a focused describe block to `src/lib/settings.test.ts`:

```ts
describe('WYSIWYG code block wrap setting', () => {
  it('defaults to off', () => {
    expect(DEFAULT_SETTINGS.wysiwygCodeBlockWrap).toBe(false);
  });

  it('normalizes malformed values before saving and preserves booleans', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({ wysiwygCodeBlockWrap: 'true' });

    const malformed = await loadSettings();
    expect(malformed.wysiwygCodeBlockWrap).toBe(false);

    invokeMock.mockResolvedValueOnce(undefined);
    await saveSettings(malformed);
    expect(invokeMock).toHaveBeenLastCalledWith('save_settings', {
      settings: expect.objectContaining({ wysiwygCodeBlockWrap: false }),
    });

    invokeMock.mockResolvedValueOnce({ wysiwygCodeBlockWrap: true });
    expect((await loadSettings()).wysiwygCodeBlockWrap).toBe(true);
  });

  it('tracks the preference as a changed setting', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        wysiwygCodeBlockWrap: true,
      }),
    ).toEqual(['wysiwygCodeBlockWrap']);
  });
});
```

- [ ] **Step 2: Write a failing Rust legacy/default round-trip test**

Add this test inside `crates/markdowner-core/src/settings.rs`'s existing test module:

```rust
#[test]
fn wysiwyg_code_block_wrap_defaults_off_and_round_trips() {
    let legacy = r#"{"autoSave":true,"editorLineWrap":true}"#;
    let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
    assert!(
        !parsed.wysiwyg_code_block_wrap,
        "missing wysiwygCodeBlockWrap should default to false"
    );

    let json = serde_json::json!({ "wysiwygCodeBlockWrap": true });
    let parsed: Settings = serde_json::from_value(json).expect("wrap setting parse");
    assert!(parsed.wysiwyg_code_block_wrap);
    let value = serde_json::to_value(parsed).expect("serialize settings");
    assert_eq!(value["wysiwygCodeBlockWrap"], true);
}
```

- [ ] **Step 3: Write failing Settings UI tests**

Add this case to `src/shell/SettingsPanel.test.tsx` using the existing `renderPanel` helper:

```tsx
it('renders and toggles WYSIWYG code block wrapping', () => {
  const onSettingsChange = vi.fn();
  renderPanel({ onSettingsChange });

  expect(
    screen.getByText('Wrap long code lines instead of scrolling horizontally.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/WYSIWYG Code Block Wrap/i));

  expect(onSettingsChange).toHaveBeenCalledWith({
    ...DEFAULT_SETTINGS,
    wysiwygCodeBlockWrap: true,
  });
});
```

Add an App-level persistence case beside the existing Word Wrap settings test in `src/App.test.tsx`:

```tsx
it('persists WYSIWYG Code Block Wrap changes from Settings', async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'load_settings') {
      return { wysiwygCodeBlockWrap: false };
    }
    return undefined;
  });
  bootstrapMock.mockResolvedValue(
    baseSnapshot({
      activeDocumentName: 'code.md',
      activeDocumentPath: '/tmp/project/code.md',
      activeDocumentSource: '```text\nlong-line\n```',
      mode: 'Wysiwyg',
    }),
  );

  const { default: App } = await import('./App');
  render(<App />);
  fireEvent.keyDown(window, { key: ',', metaKey: true });

  const panel = await screen.findByTestId('settings-panel');
  fireEvent.click(within(panel).getByLabelText(/WYSIWYG Code Block Wrap/i));

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('save_settings', {
      settings: expect.objectContaining({ wysiwygCodeBlockWrap: true }),
    });
  });
});
```

In both exact default payloads asserted by the Command Palette Reset test and the Settings Reset test in `src/App.test.tsx`, add:

```ts
wysiwygCodeBlockWrap: false,
```

Initialize each Reset test's loaded settings with `wysiwygCodeBlockWrap: true` so the assertions prove that Reset actively restores `false`, rather than only serializing an unchanged default.

- [ ] **Step 4: Write failing command-palette contract tests**

In the ordered command ID assertion in `src/shell/commandPaletteCommands.test.ts`, insert the new ID immediately after `preferences.toggleWordWrap`:

```ts
'preferences.toggleWordWrap',
'preferences.toggleWysiwygCodeBlockWrap',
'preferences.toggleWordBreakKeepAll',
```

Extend the existing preference-label test with the new current value, label assertion, and action assertion:

```ts
const current = settings({
  autoSave: true,
  editorLineWrap: false,
  wysiwygCodeBlockWrap: false,
  editorWordBreakKeepAll: true,
  focusModeEnabled: true,
  typewriterModeEnabled: false,
});

expect(
  commands.find(
    (command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap',
  )?.label,
).toBe('Enable WYSIWYG Code Block Wrap');

commands
  .find((command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap')
  ?.run?.();
expect(updateSettings).toHaveBeenCalledWith({
  ...current,
  wysiwygCodeBlockWrap: true,
});
```

Add the inverse-label case:

```ts
it('labels enabled WYSIWYG code block wrapping by the next action', () => {
  const commands = buildCommandPaletteCommands({
    activeDocumentOpen: true,
    canGoBack: true,
    canGoForward: true,
    settings: settings({ wysiwygCodeBlockWrap: true }),
    actions: actions(),
  });

  expect(
    commands.find(
      (command) => command.id === 'preferences.toggleWysiwygCodeBlockWrap',
    )?.label,
  ).toBe('Disable WYSIWYG Code Block Wrap');
});
```

- [ ] **Step 5: Run the new tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/settings.test.ts src/shell/SettingsPanel.test.tsx src/shell/commandPaletteCommands.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/App.test.tsx -t "WYSIWYG Code Block Wrap|resets settings to defaults" --maxWorkers=1 --no-file-parallelism
cargo test -p markdowner-core wysiwyg_code_block_wrap_defaults_off_and_round_trips -- --nocapture
```

Expected: the frontend tests fail because `wysiwygCodeBlockWrap`, its switch, and its command do not exist; the Rust test fails to compile because `Settings` has no `wysiwyg_code_block_wrap` field.

- [ ] **Step 6: Add the frontend settings contract and normalization**

Add the field beside the other wrapping preferences in `src/lib/settings.ts`:

```ts
export interface Settings {
  // existing fields
  editorWordBreakKeepAll: boolean;
  /** Wrap editable code blocks in WYSIWYG mode only. */
  wysiwygCodeBlockWrap: boolean;
  // remaining fields
}
```

Add its default beside `editorWordBreakKeepAll`:

```ts
editorWordBreakKeepAll: true,
wysiwygCodeBlockWrap: false,
```

Normalize malformed persisted values after the other wrap booleans:

```ts
if (typeof merged.wysiwygCodeBlockWrap !== 'boolean') {
  merged.wysiwygCodeBlockWrap = DEFAULT_SETTINGS.wysiwygCodeBlockWrap;
}
```

- [ ] **Step 7: Add the Rust settings field and default**

Add the field beside `editor_word_break_keep_all`:

```rust
pub editor_word_break_keep_all: bool,
pub wysiwyg_code_block_wrap: bool,
```

Add the matching default in `impl Default for Settings`:

```rust
editor_word_break_keep_all: true,
wysiwyg_code_block_wrap: false,
```

The existing `#[serde(rename_all = "camelCase", default)]` maps the field to `wysiwygCodeBlockWrap` and supplies the default for legacy JSON.

- [ ] **Step 8: Add the Settings switch and command-palette action**

Insert this controlled switch directly after the general Word Wrap switch in `src/shell/SettingsPanel.tsx`:

```tsx
<div className={switchFieldClass}>
  <Label
    htmlFor="wysiwyg-code-block-wrap"
    className="flex flex-col items-start gap-0.5 text-left text-sm"
  >
    <span>WYSIWYG Code Block Wrap</span>
    <span className="text-xs font-normal text-muted-foreground">
      Wrap long code lines instead of scrolling horizontally.
    </span>
  </Label>
  <Switch
    id="wysiwyg-code-block-wrap"
    checked={settings.wysiwygCodeBlockWrap}
    onCheckedChange={(checked) =>
      handleSettingChange('wysiwygCodeBlockWrap', checked)
    }
  />
</div>
```

Insert this command immediately after `preferences.toggleWordWrap` in `src/shell/commandPaletteCommands.ts`:

```ts
{
  id: 'preferences.toggleWysiwygCodeBlockWrap',
  category: 'Preferences',
  label: settings.wysiwygCodeBlockWrap
    ? 'Disable WYSIWYG Code Block Wrap'
    : 'Enable WYSIWYG Code Block Wrap',
  run: () =>
    actions.updateSettings({
      ...settings,
      wysiwygCodeBlockWrap: !settings.wysiwygCodeBlockWrap,
    }),
},
```

No `CommandPaletteActions` or App action changes are needed because the command uses the existing `updateSettings: handleSettingsChange` route.

- [ ] **Step 9: Run the focused tests and type-check to verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/settings.test.ts src/shell/SettingsPanel.test.tsx src/shell/commandPaletteCommands.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/App.test.tsx -t "WYSIWYG Code Block Wrap|resets settings to defaults" --maxWorkers=1 --no-file-parallelism
cargo test -p markdowner-core wysiwyg_code_block_wrap_defaults_off_and_round_trips -- --nocapture
pnpm exec tsc --noEmit --pretty false
```

Expected: every focused test passes, the Rust legacy/default round trip passes, and TypeScript exits with code 0.

- [ ] **Step 10: Commit and push the settings/UI/palette unit**

```bash
git add src/lib/settings.test.ts src/lib/settings.ts crates/markdowner-core/src/settings.rs src/shell/SettingsPanel.test.tsx src/shell/SettingsPanel.tsx src/shell/commandPaletteCommands.test.ts src/shell/commandPaletteCommands.ts src/App.test.tsx
git commit -m "feat(settings): add WYSIWYG code block wrap preference"
git push
```

Verify `git status --short --branch` reports `main...origin/main` with no unexpected paths before starting Task 2.

### Task 2: Apply wrapping in WYSIWYG and preserve visual-row navigation

**Files:**
- Modify: `src/shell/EditorArea.test.tsx`
- Modify: `src/shell/EditorArea.tsx`
- Modify: `src/styles.test.ts`
- Modify: `src/styles.css`
- Modify: `src/components/wysiwyg/codeBlockExtension.test.ts`
- Modify: `src/components/wysiwyg/codeBlockExtension.ts`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing EditorArea pane-isolation tests**

Add these cases to `src/shell/EditorArea.test.tsx`:

```tsx
it('keeps WYSIWYG code block wrapping off by default', () => {
  render(<EditorArea {...baseProps} currentMode="Wysiwyg" />);

  expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
    'data-code-block-wrap',
    'off',
  );
});

it('enables code block wrapping on the WYSIWYG pane only', () => {
  render(
    <EditorArea
      {...baseProps}
      currentMode="SplitView"
      wysiwygCodeBlockWrap
    />,
  );

  expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
    'data-code-block-wrap',
    'on',
  );
  expect(screen.getByTestId('editor-surface-source')).not.toHaveAttribute(
    'data-code-block-wrap',
  );
  expect(screen.getByTestId('editor-surface-preview')).not.toHaveAttribute(
    'data-code-block-wrap',
  );
});
```

- [ ] **Step 2: Write failing scoped stylesheet tests**

Add a helper to `src/styles.test.ts` that can read a grouped selector rule:

```ts
function ruleBodyContaining(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(
    new RegExp(`[^{}]*${escapedSelector}[^{}]*\\{([^}]*)\\}`),
  );
  return match?.[1] ?? '';
}
```

Then add the scope and declaration test:

```ts
describe('WYSIWYG code block wrapping stylesheet', () => {
  it('wraps ordinary and Mermaid source code only when the WYSIWYG toggle is on', () => {
    const selectors = [
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre > code",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre > code",
    ];

    for (const selector of selectors) {
      const rule = ruleBodyContaining(selector);
      expect(rule).toContain('white-space: pre-wrap;');
      expect(rule).toContain('overflow-wrap: anywhere;');
    }
    expect(stylesheet).not.toContain(
      ".editor-pane-preview[data-code-block-wrap='on']",
    );
  });
});
```

- [ ] **Step 3: Extend App integration tests for Settings and command-palette runtime updates**

In the Settings persistence test from Task 1, resolve the surface before opening Settings and add the initial/final assertions:

```tsx
const surface = await screen.findByTestId('editor-surface-wysiwyg');
expect(surface).toHaveAttribute('data-code-block-wrap', 'off');

// open Settings and click the switch as already specified

await waitFor(() => {
  expect(surface).toHaveAttribute('data-code-block-wrap', 'on');
});
```

Add a command-palette integration case beside the existing Word Wrap command test:

```tsx
it('toggles WYSIWYG Code Block Wrap from the Command Palette', async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'load_settings') {
      return { wysiwygCodeBlockWrap: false };
    }
    return undefined;
  });
  bootstrapMock.mockResolvedValue(
    baseSnapshot({
      activeDocumentName: 'code.md',
      activeDocumentPath: '/tmp/project/code.md',
      activeDocumentSource: '```text\nlong-line\n```',
      mode: 'Wysiwyg',
    }),
  );

  const { default: App } = await import('./App');
  render(<App />);
  const surface = await screen.findByTestId('editor-surface-wysiwyg');
  expect(surface).toHaveAttribute('data-code-block-wrap', 'off');

  fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });
  const dialog = await screen.findByRole('dialog', { name: /command palette/i });
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: /command palette search/i }),
    { target: { value: 'code block wrap' } },
  );
  fireEvent.click(
    await within(dialog).findByRole('option', {
      name: /enable WYSIWYG code block wrap/i,
    }),
  );

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('save_settings', {
      settings: expect.objectContaining({ wysiwygCodeBlockWrap: true }),
    });
    expect(surface).toHaveAttribute('data-code-block-wrap', 'on');
  });
});
```

- [ ] **Step 4: Write the failing visual-row ArrowDown regression**

Add this case inside the current `ArrowDown exit` describe block in `src/components/wysiwyg/codeBlockExtension.test.ts`; the existing `beforeEach` mock returning `false` represents another visual row below:

```ts
it('does not exit when the last logical line has another visual row below', () => {
  editor.chain().focus().setTextSelection(8).run();

  const handled = pressArrowDown(editor);

  expect(editor.view.endOfTextblock).toHaveBeenCalledWith('down');
  expect(handled).toBeFalsy();
  expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
});
```

Make the existing final-row exit test model the visual bottom explicitly:

```ts
vi.mocked(editor.view.endOfTextblock).mockReturnValue(true);
```

In the terminal-code-block paragraph-creation test, stub the separately created editor before pressing ArrowDown:

```ts
vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
```

- [ ] **Step 5: Run the rendering/navigation tests and verify RED**

Run:

```bash
pnpm exec vitest run src/shell/EditorArea.test.tsx src/styles.test.ts src/components/wysiwyg/codeBlockExtension.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/App.test.tsx -t "WYSIWYG Code Block Wrap" --maxWorkers=1 --no-file-parallelism
```

Expected: EditorArea lacks the data attribute, the stylesheet lacks the scoped wrap rule, App cannot update the mounted surface, and ArrowDown exits without consulting `endOfTextblock('down')`.

- [ ] **Step 6: Route the setting to the WYSIWYG pane**

Add the prop and default in `src/shell/EditorArea.tsx`:

```ts
export interface EditorAreaProps {
  // existing props
  wordBreakKeepAll?: boolean;
  /** Wrap editable code blocks in the WYSIWYG pane only. */
  wysiwygCodeBlockWrap?: boolean;
  // remaining props
}

export function EditorArea({
  // existing destructuring
  wordBreakKeepAll = true,
  wysiwygCodeBlockWrap = false,
  // remaining props
}: EditorAreaProps) {
  const codeBlockWrapAttribute = wysiwygCodeBlockWrap ? 'on' : 'off';
```

Apply the attribute only to `editor-surface-wysiwyg`:

```tsx
<div
  data-testid="editor-surface-wysiwyg"
  {...editorModeAttributes}
  data-line-wrap={lineWrapAttribute}
  data-wrap-column={wrapColumnAttribute}
  data-wrap-line={wrapLineAttribute}
  data-code-block-wrap={codeBlockWrapAttribute}
  // existing props
>
```

Pass the persisted value from `src/App.tsx` beside the other wrapping props:

```tsx
<EditorArea
  // existing props
  wordBreakKeepAll={settings.editorWordBreakKeepAll}
  wysiwygCodeBlockWrap={settings.wysiwygCodeBlockWrap}
  // remaining props
/>
```

- [ ] **Step 7: Add WYSIWYG-scoped wrap CSS for ordinary and Mermaid source blocks**

Add this rule after the base `.code-block-view` and Mermaid source declarations in `src/styles.css`. The added `.notion-editor-content .ProseMirror` specificity intentionally overrides the general `data-line-wrap='false'` pre rule, keeping the two preferences independent:

```css
.editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre,
.editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre > code,
.editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre,
.editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre > code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

Do not add an off rule: the existing `white-space: pre` base rules remain the default and preserve horizontal scrolling.

- [ ] **Step 8: Require the visual bottom before ArrowDown exits**

In `src/components/wysiwyg/codeBlockExtension.ts`, keep the explicit-newline check first and add the layout-aware guard immediately after it:

```ts
if (textAfterCaret.includes('\n')) return false;
if (!editor.view.endOfTextblock('down')) return false;
```

The rest of the existing paragraph lookup/creation and focus chain stays unchanged.

- [ ] **Step 9: Run the focused tests and type-check to verify GREEN**

Run:

```bash
pnpm exec vitest run src/shell/EditorArea.test.tsx src/styles.test.ts src/components/wysiwyg/codeBlockExtension.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/App.test.tsx -t "WYSIWYG Code Block Wrap" --maxWorkers=1 --no-file-parallelism
pnpm exec tsc --noEmit --pretty false
```

Expected: pane isolation, ordinary/Mermaid CSS, Settings and palette runtime updates, and all ArrowDown boundary cases pass; TypeScript exits with code 0.

- [ ] **Step 10: Commit and push the WYSIWYG runtime unit**

```bash
git add src/shell/EditorArea.test.tsx src/shell/EditorArea.tsx src/styles.test.ts src/styles.css src/components/wysiwyg/codeBlockExtension.test.ts src/components/wysiwyg/codeBlockExtension.ts src/App.test.tsx src/App.tsx
git commit -m "feat(wysiwyg): add code block wrap control"
git push
```

Verify `git status --short --branch` reports `main...origin/main` with no unexpected paths.

### Task 3: Run completion verification and audit every requirement

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run all feature-focused frontend and Rust tests**

```bash
pnpm exec vitest run src/lib/settings.test.ts src/shell/SettingsPanel.test.tsx src/shell/commandPaletteCommands.test.ts src/shell/EditorArea.test.tsx src/styles.test.ts src/components/wysiwyg/codeBlockExtension.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/App.test.tsx -t "WYSIWYG Code Block Wrap|resets settings to defaults" --maxWorkers=1 --no-file-parallelism
cargo test -p markdowner-core settings::tests -- --nocapture
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run the complete frontend suite serially**

```bash
pnpm exec vitest run --maxWorkers=1 --no-file-parallelism
```

Expected: every Vitest file passes with zero failed tests. If a failure appears, rerun that exact file serially and fix a demonstrated regression before continuing.

- [ ] **Step 3: Run shell/build-script and Rust regression suites**

```bash
bash scripts/build-and-install.test.sh
bash src-tauri/scripts/self-update.test.sh
cargo test -p markdowner-core
```

Expected: both shell suites exit 0 and every `markdowner-core` test passes.

- [ ] **Step 4: Run static checks and a production build**

```bash
pnpm exec tsc --noEmit --pretty false
git diff --check
pnpm build
```

Expected: TypeScript and whitespace checks exit 0, and the production Tauri build completes successfully.

- [ ] **Step 5: Verify the live behavior in the Tauri development app**

Run:

```bash
pnpm tauri dev
```

Open a Markdown document containing both an ordinary long code line and a Mermaid block with a long editable source line. Verify all of the following on the live WYSIWYG surface:

1. With the default/off preference, both source areas remain single-line and scroll horizontally.
2. The Settings switch enables wrapping immediately and survives an app restart.
3. The command palette finds `Enable/Disable WYSIWYG Code Block Wrap`, toggles the same preference, and updates its label after the state change.
4. Ordinary and Mermaid source lines wrap, while the rendered Mermaid diagram and Split View preview remain unchanged.
5. ArrowDown stays inside a visually wrapped final logical line until the last visual row, then exits to the following paragraph.
6. Turning the general Word Wrap preference off does not disable WYSIWYG code-block wrapping.

- [ ] **Step 6: Perform the final source and repository-state audit**

Run:

```bash
rg -n "wysiwygCodeBlockWrap|wysiwyg_code_block_wrap|toggleWysiwygCodeBlockWrap|data-code-block-wrap" src crates/markdowner-core/src
git status --short --branch
git log -4 --oneline --decorate
git ls-remote --heads origin main
```

Confirm each explicit requirement has direct evidence: persisted default-off setting, Settings control, command-palette control, WYSIWYG-only ordinary/Mermaid rendering, independent general wrapping, safe ArrowDown behavior, passing tests/build, clean worktree, and `origin/main` at the final local commit.
