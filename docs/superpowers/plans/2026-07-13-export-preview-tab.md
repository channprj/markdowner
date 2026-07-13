# Export Preview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the export modal with a full editor-area Export Preview tab, add inline-code and keyboard-key export colors, make every modal backdrop dim-only, and expose keyboard shortcuts consistently from the app menu and command palette.

**Architecture:** Extend the existing UI-tab model with a transient `export` kind while keeping the point-in-time export request and draft style in `App`. Refactor the modal body into a standalone full-surface component that continues to use `buildExportHtml`, and centralize dim-only behavior in the shared Dialog overlay plus Quick Open's custom overlay.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Radix Dialog, Vitest, Testing Library, Tauri desktop bridges.

---

### Task 1: Extend the export style contract

**Files:**
- Modify: `src/lib/exportDocument.ts`
- Test: `src/lib/exportDocument.test.ts`

- [ ] **Step 1: Write failing normalization and CSS tests**

Add assertions that defaults include four new color fields, legacy saved data receives those defaults, `lineHeight: 0.8` survives normalization, values below `0.8` clamp, and generated HTML contains separate selectors for inline code and keyboard keys.

```ts
expect(normalizeExportStyle({ ...DEFAULT_EXPORT_STYLE, lineHeight: 0.8 }).lineHeight).toBe(0.8);
expect(normalizeExportStyle({ ...DEFAULT_EXPORT_STYLE, lineHeight: 0.4 }).lineHeight).toBe(0.8);
expect(html).toContain('.markdowner-export code:not(pre code)');
expect(html).toContain('color: #314158');
expect(html).toContain('.markdowner-export kbd');
expect(html).toContain('background: #f1e6d2');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts
```

Expected: failures for missing color properties, `0.8` being clamped to `1.2`, and missing CSS selectors.

- [ ] **Step 3: Add normalized persisted color fields and CSS**

Extend `ExportStyle` and `DEFAULT_EXPORT_STYLE`:

```ts
inlineCodeTextColor: '#7c2d12',
inlineCodeBackgroundColor: '#ffedd5',
kbdTextColor: '#334155',
kbdBackgroundColor: '#e2e8f0',
```

Normalize every field through the existing six-digit hex rule, change the line-height lower bound to `0.8`, and append later-wins CSS:

```css
.markdowner-export code:not(pre code) {
  color: var(--export-inline-code-foreground);
  background: var(--export-inline-code-background);
}
.markdowner-export kbd {
  color: var(--export-kbd-foreground);
  background: var(--export-kbd-background);
  border: 1px solid color-mix(in srgb, var(--export-kbd-foreground) 35%, transparent);
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts
```

Expected: all export-document tests pass. Use `...DEFAULT_EXPORT_STYLE` in test fixtures so later added defaults do not require duplicated literals.

- [ ] **Step 5: Commit the style contract**

```bash
git add src/lib/exportDocument.ts src/lib/exportDocument.test.ts
git commit -m "feat(export): customize inline code colors"
```

### Task 2: Replace the export modal with a full-surface component

**Files:**
- Create: `src/shell/ExportPreviewTab.tsx`
- Create: `src/shell/ExportPreviewTab.test.tsx`
- Delete: `src/shell/ExportDialog.tsx`
- Delete: `src/shell/ExportDialog.test.tsx`

- [ ] **Step 1: Write failing full-surface component tests**

Port the behavioral tests from `ExportDialog.test.tsx` and change the component contract to:

```ts
interface ExportPreviewTabProps {
  request: ExportPreviewRequest;
  initialStyle: ExportStyle;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (style: ExportStyle) => void;
  buildPreview?: (options: ExportHtmlOptions) => Promise<string>;
}
```

Assert:

```ts
expect(screen.getByRole('heading', { name: 'Export Preview' })).toBeInTheDocument();
expect(screen.getByTestId('export-preview-surface')).toHaveClass('flex-1');
expect(screen.getByLabelText('Line height')).toHaveAttribute('min', '0.8');
expect(screen.getByLabelText('Inline code text color')).toHaveValue('#7c2d12');
expect(screen.getByLabelText('Keyboard key background color')).toHaveValue('#e2e8f0');
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
pnpm vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Extract the modal body into `ExportPreviewTab`**

Move preview generation, stale-request protection, range controls, reset, error handling, and busy state from `ExportDialog`. Remove all Dialog imports and render a full-height surface:

```tsx
<section data-testid="export-preview-surface" className="flex min-h-0 flex-1 flex-col bg-background">
  <header className="flex shrink-0 items-center border-b px-5 py-3">...</header>
  <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">...</div>
</section>
```

Add paired color inputs labelled exactly:

- `Inline code text color`
- `Inline code background color`
- `Keyboard key text color`
- `Keyboard key background color`

Use `min={0.8}`, `max={2.2}`, and `step={0.1}` for line height. Keep PDF paper ratio and HTML full-stage behavior.

- [ ] **Step 4: Delete the obsolete modal and run focused tests**

Run:

```bash
pnpm vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: all preview component tests pass.

- [ ] **Step 5: Commit the full-surface component**

```bash
git add src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx src/shell/ExportDialog.tsx src/shell/ExportDialog.test.tsx
git commit -m "refactor(export): create full-surface preview"
```

### Task 3: Add the transient Export Preview application tab

**Files:**
- Modify: `src/lib/documentTabs.ts`
- Modify: `src/lib/documentTabs.test.ts`
- Modify: `src/lib/shellModel.ts`
- Modify: `src/lib/shellModel.test.ts`
- Modify: `src/shell/Tabs.tsx`
- Modify: `src/shell/Tabs.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write failing tab-model tests**

Add an `export` UI tab with fixed identity:

```ts
export const EXPORT_PREVIEW_TAB_ID = '__markdowner_export_preview__';
export const EXPORT_PREVIEW_TAB_NAME = 'Export Preview';
```

Test `createExportPreviewTab`, `resolveDocumentTabViewState().isExportPreviewTabActive`, and `resolveSwitchTabTransition` returning `activateExportPreview`. Confirm dirty checks and session persistence continue to include documents only.

- [ ] **Step 2: Run model and tab-strip tests and confirm RED**

Run:

```bash
pnpm vitest run src/lib/documentTabs.test.ts src/lib/shellModel.test.ts src/shell/Tabs.test.tsx
```

Expected: missing export tab type/factory/transition and unsupported tab icon assertions.

- [ ] **Step 3: Implement the UI tab kind and presentation**

Extend the unions:

```ts
export type DocumentTabKind = 'document' | 'settings' | 'export';
export type TabsItemKind = 'document' | 'settings' | 'export';
```

Return `activateExportPreview` from tab switching without calling Rust. Render a `FileDown` icon for the export tab and keep non-document tabs excluded from dirty, backup, restore, and closed-document history paths.

- [ ] **Step 4: Write failing App integration tests**

Update export tests so menu and command-palette actions assert:

```ts
expect(await screen.findByRole('tab', { name: /Export Preview/ })).toHaveAttribute('aria-selected', 'true');
expect(screen.queryByRole('dialog', { name: /Export/ })).not.toBeInTheDocument();
expect(saveDialogMock).not.toHaveBeenCalled();
```

Add tests that switch from Export Preview to a document and back, close/cancel the export tab, keep it open after native save cancellation, and close it after a successful write.

- [ ] **Step 5: Wire App-owned transient request state into the tab strip**

Replace `ExportDialogRequest` with `ExportPreviewRequest`, add `preExportTabIdRef`, and create helpers that append/reuse the export tab while preserving the current document snapshot:

```ts
const activateExportPreview = (request: ExportPreviewRequest) => {
  stashActiveTabDraft();
  preExportTabIdRef.current = activeTabId;
  setExportRequest(request);
  setTabs((current) => current.some((tab) => tab.kind === 'export')
    ? current
    : [...current, createExportPreviewTab()]);
  setActiveTabId(EXPORT_PREVIEW_TAB_ID);
};
```

Intercept export-tab closing to clear the request and switch to `preExportTabIdRef.current` when present. Render `ExportPreviewTab` in the editor-area branch, hide `EditorArea` and terminal while the export tab is active, and remove the old root-level `ExportDialog`.

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
pnpm vitest run src/App.test.tsx src/lib/documentTabs.test.ts src/lib/shellModel.test.ts src/shell/Tabs.test.tsx src/shell/ExportPreviewTab.test.tsx
```

Expected: all tab, export, and App integration tests pass.

- [ ] **Step 7: Commit tab integration**

```bash
git add src/App.tsx src/App.test.tsx src/lib/documentTabs.ts src/lib/documentTabs.test.ts src/lib/shellModel.ts src/lib/shellModel.test.ts src/shell/Tabs.tsx src/shell/Tabs.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): open preview in an app tab"
```

### Task 4: Standardize all modal backdrops as dim-only

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/shell/QuickOpen.tsx`
- Modify: `src/shell/QuickOpen.test.tsx`
- Modify: `src/shell/CommandPalette.tsx`
- Modify: `src/shell/CommandPalette.test.tsx`
- Modify: dialog consumers returned by `rg -n "overlayClassName|backdrop-blur" src`
- Test: `src/styles.test.ts`

- [ ] **Step 1: Write failing dim-overlay tests**

Render the shared `DialogOverlay` and Quick Open, then assert:

```ts
expect(overlay.className).toMatch(/bg-black\/35/);
expect(overlay.className).not.toMatch(/backdrop-blur/);
```

Keep a Command Palette regression assertion proving Cmd+Shift+P uses dim without blur.

- [ ] **Step 2: Run overlay tests and confirm RED**

Run:

```bash
pnpm vitest run src/shell/QuickOpen.test.tsx src/shell/CommandPalette.test.tsx src/styles.test.ts
```

Expected: the shared or Quick Open overlay still contains `backdrop-blur` and/or the lighter old dim.

- [ ] **Step 3: Remove blur from shared and custom overlays**

Set the shared default to a dim-only class such as:

```tsx
"fixed inset-0 isolate z-50 bg-black/35 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
```

Give Quick Open the same `bg-black/35` backdrop and remove `supports-backdrop-filter:backdrop-blur-xs`. Remove every consumer override that contains any backdrop-blur utility; retain stronger opacity only where product semantics require it.

- [ ] **Step 4: Audit source and run focused tests**

Run:

```bash
rg -n "backdrop-blur" src
pnpm vitest run src/shell/QuickOpen.test.tsx src/shell/CommandPalette.test.tsx src/styles.test.ts
```

Expected: `rg` returns no modal-overlay blur utility and all focused tests pass.

- [ ] **Step 5: Commit the overlay normalization**

```bash
git add src/components/ui/dialog.tsx src/shell/QuickOpen.tsx src/shell/QuickOpen.test.tsx src/shell/CommandPalette.tsx src/shell/CommandPalette.test.tsx src/styles.test.ts
git commit -m "fix(ui): use dim-only modal backdrops"
```

### Task 5: Add keyboard-shortcuts discovery to the app menu

**Files:**
- Modify: `src/shell/AppMenu.tsx`
- Modify: `src/shell/AppMenu.test.tsx`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write failing menu and command-palette tests**

Add `onShowKeyboardShortcuts` to AppMenu fixtures. Assert the menu item appears immediately before Settings, displays `Cmd+/`, invokes the handler, and closes the menu. Assert command `app.openKeymap` has the exact label:

```ts
expect(keymapCommand?.label).toBe('Show Keyboard Shortcuts (keymap)');
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm vitest run src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx -t "keyboard shortcuts|keymap|app menu"
```

Expected: missing prop/menu item and old command label failures.

- [ ] **Step 3: Wire the existing shortcuts dialog action**

Add a `Keyboard` icon menu action directly above Settings:

```tsx
<MenuAction
  icon={<Keyboard className="size-4" />}
  shortcut="Cmd+/"
  ariaKeyshortcuts="Meta+/ Control+/"
  onSelect={() => run(onShowKeyboardShortcuts)}
>
  Show Keyboard Shortcuts
</MenuAction>
```

Pass `() => setIsShortcutsOpen(true)` from App. Rename only the command-palette label to `Show Keyboard Shortcuts (keymap)` and preserve `app.openKeymap`, `⌘/`, and `actions.openKeymap`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
pnpm vitest run src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx -t "keyboard shortcuts|keymap|app menu"
```

Expected: all focused tests pass.

Commit:

```bash
git add src/App.tsx src/App.test.tsx src/shell/AppMenu.tsx src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.ts src/shell/commandPaletteCommands.test.ts
git commit -m "feat(shortcuts): improve keymap discovery"
```

### Task 6: Verify, review, integrate, and release

**Files:**
- Verify all changed files
- Release metadata: `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`

- [ ] **Step 1: Run requirement-level source audits**

```bash
rg -n "Export Studio|backdrop-blur" src
rg -n "Export Preview|Inline code text color|Keyboard key background color|Show Keyboard Shortcuts \(keymap\)" src
git diff --check
```

Expected: the first command returns no obsolete title or blur utilities; the second proves all requested labels are present; diff check exits 0.

- [ ] **Step 2: Run the complete verification suite**

```bash
pnpm vitest run --maxWorkers=1 --no-file-parallelism
pnpm exec tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Expected: all Vitest files/tests pass, TypeScript and Rust exit 0, and the production bundle builds successfully.

- [ ] **Step 3: Review the final diff and create any remaining scoped commit**

```bash
git status --short
git diff --stat main...HEAD
git diff --check main...HEAD
git log --oneline main..HEAD
```

Expected: only planned files and Conventional Commit subjects.

- [ ] **Step 4: Integrate the feature branch into `main` and re-run verification**

Use the finishing-a-development-branch workflow, fast-forward or merge into current `main`, and rerun the serial Vitest suite plus production build on the integrated result.

- [ ] **Step 5: Dry-run and push the Headatever patch release**

Run the installed Headatever script from the repository root:

```bash
/Users/heechanpark/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
/Users/heechanpark/.agents/skills/headatever/scripts/headatever.sh patch --push
```

Expected: Headatever prints the exact new version, creates the matching `chore(release)` commit and annotated tag, and pushes both.

- [ ] **Step 6: Synchronize version metadata and push the final commit**

```bash
pnpm sync-version
version=$(tr -d '\n' < VERSION)
git add Cargo.lock package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore(release): sync version metadata for $version"
git push
```

The shell variable reads the exact version created by Headatever before constructing the commit subject.

- [ ] **Step 7: Verify remote completion**

```bash
git fetch origin main --tags
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git ls-remote --tags origin "refs/tags/v$(cat VERSION)" "refs/tags/v$(cat VERSION)^{}"
```

Expected: clean `main`, identical local and remote SHAs, and both annotated-tag refs present.
