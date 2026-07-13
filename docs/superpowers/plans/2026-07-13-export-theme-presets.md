# Export Theme Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Export Preview and final HTML/PDF artifacts use a coherent app-synced or user-selected light/dark palette, including editable table colors and a top-level preset selector.

**Architecture:** Extend the persisted export style with a preset discriminator and table palette fields, then centralize preset resolution and generated CSS in `exportDocument.ts`. `ExportPreviewTab` owns only draft editing and automatic Custom transitions, while `App` supplies the current built-in theme and persists the confirmed resolved style.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library, existing browser-local storage and HTML/PDF export pipeline.

---

### Task 1: Add theme presets and a coherent export palette

**Files:**
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/lib/exportDocument.ts`

- [ ] **Step 1: Write failing preset, migration, and table CSS tests**

Import the new public types and helpers, then add tests with these assertions:

```ts
import {
  DARK_EXPORT_STYLE,
  DEFAULT_EXPORT_STYLE,
  applyExportStylePreset,
  resolveExportStyleForTheme,
} from './exportDocument';

it('resolves the app preset to a complete dark export palette', () => {
  const style = resolveExportStyleForTheme(DEFAULT_EXPORT_STYLE, 'dark');
  expect(style).toMatchObject({
    preset: 'app',
    textColor: '#f4f4f5',
    backgroundColor: '#18181b',
    tableBorderColor: '#3f3f46',
    tableHeaderTextColor: '#fafafa',
    tableHeaderBackgroundColor: '#27272a',
  });
});

it('applies fixed presets without changing paper size', () => {
  const style = applyExportStylePreset(
    { ...DEFAULT_EXPORT_STYLE, paperSize: 'Letter' },
    'dark',
    'light',
  );
  expect(style).toEqual({ ...DARK_EXPORT_STYLE, preset: 'dark', paperSize: 'Letter' });
});

it('migrates untouched legacy styles to app and customized legacy styles to custom', () => {
  const { preset: _preset, tableBorderColor: _border, tableHeaderTextColor: _headerText,
    tableHeaderBackgroundColor: _headerBackground, ...legacyDefault } = DEFAULT_EXPORT_STYLE;
  expect(normalizeExportStyle(legacyDefault).preset).toBe('app');
  expect(normalizeExportStyle({ ...legacyDefault, fontSize: 13 }).preset).toBe('custom');
  expect(normalizeExportStyle({ ...legacyDefault, textColor: '#123456' })).toMatchObject({
    preset: 'custom',
    textColor: '#123456',
  });
});
```

Extend the storage round-trip test to include `preset` and the three table colors. Add a generated-HTML regression test using table Markdown and a test document whose root has `data-theme="BuiltInDark"`:

```ts
it('uses one dark palette for the page and table when the app preset follows dark', async () => {
  const html = await buildExportHtml({
    title: 'Dark table',
    source: '| Name | Value |\n| --- | --- |\n| A | 1 |',
    activeDocumentPath: null,
    style: DEFAULT_EXPORT_STYLE,
    doc: document,
  });
  expect(html).toContain('background: #18181b');
  expect(html).toContain('--border: #3f3f46');
  expect(html).toContain('border-color: #3f3f46');
  expect(html).toContain('background: #27272a');
  expect(html).toContain('color: #fafafa');
});

it('keeps a fixed light preset light under a dark app root', async () => {
  const html = await buildExportHtml({
    title: 'Light table',
    source: '| A |\n| --- |\n| B |',
    activeDocumentPath: null,
    style: applyExportStylePreset(DEFAULT_EXPORT_STYLE, 'light', 'dark'),
    doc: document,
  });
  expect(html).toContain('background: #ffffff');
  expect(html).toContain('border-color: #d4d4d8');
  expect(html).not.toContain('border-color: #3f3f46');
});
```

- [ ] **Step 2: Run the focused library test and verify RED**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because preset types, dark defaults, table fields, preset helpers, and table override CSS do not exist.

- [ ] **Step 3: Define preset-aware export styles and legacy migration**

Add the public contract near the current export style types:

```ts
export type ExportStylePreset = 'app' | 'light' | 'dark' | 'custom';
export type ExportTheme = 'light' | 'dark';

export interface ExportStyle {
  preset: ExportStylePreset;
  fontSize: number;
  fontFamily: ExportFontFamily;
  textColor: string;
  backgroundColor: string;
  inlineCodeTextColor: string;
  inlineCodeBackgroundColor: string;
  kbdTextColor: string;
  kbdBackgroundColor: string;
  tableBorderColor: string;
  tableHeaderTextColor: string;
  tableHeaderBackgroundColor: string;
  lineHeight: number;
  paragraphSpacing: number;
  contentPadding: number;
  paperSize: 'A4' | 'Letter';
}
```

Use complete, named preset constants:

```ts
export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  preset: 'app',
  fontSize: 14,
  fontFamily: 'sans',
  textColor: '#202124',
  backgroundColor: '#ffffff',
  inlineCodeTextColor: '#7c2d12',
  inlineCodeBackgroundColor: '#ffedd5',
  kbdTextColor: '#334155',
  kbdBackgroundColor: '#e2e8f0',
  tableBorderColor: '#d4d4d8',
  tableHeaderTextColor: '#18181b',
  tableHeaderBackgroundColor: '#f4f4f5',
  lineHeight: 1.6,
  paragraphSpacing: 8,
  contentPadding: 32,
  paperSize: 'A4',
};

export const DARK_EXPORT_STYLE: ExportStyle = {
  ...DEFAULT_EXPORT_STYLE,
  preset: 'dark',
  textColor: '#f4f4f5',
  backgroundColor: '#18181b',
  inlineCodeTextColor: '#fed7aa',
  inlineCodeBackgroundColor: '#431407',
  kbdTextColor: '#e2e8f0',
  kbdBackgroundColor: '#334155',
  tableBorderColor: '#3f3f46',
  tableHeaderTextColor: '#fafafa',
  tableHeaderBackgroundColor: '#27272a',
};
```

Normalize the preset before color fields so dark fields fall back to dark values. Detect a legacy customization only from old fields actually present in the candidate; missing new table fields must not make every legacy record Custom. Implement:

```ts
export function applyExportStylePreset(
  style: ExportStyle,
  preset: ExportStylePreset,
  appTheme: ExportTheme,
): ExportStyle {
  const current = normalizeExportStyle(style);
  if (preset === 'custom') return { ...current, preset };
  const useDark = preset === 'dark' || (preset === 'app' && appTheme === 'dark');
  const template = useDark ? DARK_EXPORT_STYLE : DEFAULT_EXPORT_STYLE;
  return { ...template, preset, paperSize: current.paperSize };
}

export function resolveExportStyleForTheme(
  style: ExportStyle,
  appTheme: ExportTheme,
): ExportStyle {
  const normalized = normalizeExportStyle(style);
  return normalized.preset === 'app'
    ? applyExportStylePreset(normalized, 'app', appTheme)
    : normalized;
}
```

- [ ] **Step 4: Resolve presets and override every table-related semantic color in generated HTML**

At the start of `buildExportHtml`, derive the theme from the provided document and resolve the style:

```ts
const normalizedStyle = normalizeExportStyle(rawStyle);
const appTheme: ExportTheme =
  doc.documentElement.dataset.theme === 'BuiltInDark' ? 'dark' : 'light';
const style = resolveExportStyleForTheme(normalizedStyle, appTheme);
```

Extend the later-wins CSS with semantic tokens and explicit table selectors:

```css
.markdowner-export {
  --foreground: ${style.textColor};
  --background: ${style.backgroundColor};
  --primary: ${style.textColor};
  --muted-foreground: color-mix(in srgb, ${style.textColor} 68%, ${style.backgroundColor});
  --border: ${style.tableBorderColor};
  --muted: ${style.tableHeaderBackgroundColor};
}
.markdowner-export th,
.markdowner-export td {
  border-color: ${style.tableBorderColor};
}
.markdowner-export th {
  color: ${style.tableHeaderTextColor};
  background: ${style.tableHeaderBackgroundColor};
}
```

- [ ] **Step 5: Run the focused library test and verify GREEN**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: all export-document tests pass, including the dark-table regression and fixed-Light override.

### Task 2: Add Preset and table controls to Export Preview

**Files:**
- Modify: `src/shell/ExportPreviewTab.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`

- [ ] **Step 1: Write failing UI contract tests**

Pass `appTheme="light"` from the shared render helper. Add one structural test proving wording and order:

```tsx
it('puts Preset first under Config and removes the verbose description', () => {
  renderPreview();
  expect(screen.getByText('Config')).toBeInTheDocument();
  expect(screen.queryByText(
    'Every value below is applied to both this preview and the exported file.',
  )).not.toBeInTheDocument();
  const preset = screen.getByLabelText('Preset');
  const bodySize = screen.getByLabelText('Body size');
  expect(
    preset.compareDocumentPosition(bodySize) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
```

Add behavior tests:

```tsx
it('switches presets, marks manual edits Custom, and preserves paper size', () => {
  renderPreview({
    request: { ...HTML_REQUEST, format: 'pdf' },
    initialStyle: { ...DEFAULT_EXPORT_STYLE, paperSize: 'Letter' },
    appTheme: 'dark',
  });
  expect(screen.getByLabelText('Preset')).toHaveValue('app');
  expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
  fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'light' } });
  expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
  expect(screen.getByLabelText('Paper size')).toHaveValue('Letter');
  fireEvent.change(screen.getByLabelText('Table border color'), {
    target: { value: '#123456' },
  });
  expect(screen.getByLabelText('Preset')).toHaveValue('custom');
});
```

Assert all three table color labels exist, all controls are disabled while busy, Reset returns Preset to `app`, and the preview frame plus iframe have an inline dark `background-color` when the dark app preset is active.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
pnpm vitest run src/shell/ExportPreviewTab.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL for the missing `appTheme` prop, Preset/Table controls, Config text, Custom transitions, and dynamic preview background.

- [ ] **Step 3: Add preset-aware draft editing**

Extend props and color keys:

```ts
export interface ExportPreviewTabProps {
  request: ExportPreviewRequest;
  initialStyle: ExportStyle;
  appTheme: ExportTheme;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (style: ExportStyle) => void;
  buildPreview?: (options: ExportHtmlOptions) => Promise<string>;
}

type ColorStyleKey =
  | 'textColor'
  | 'backgroundColor'
  | 'inlineCodeTextColor'
  | 'inlineCodeBackgroundColor'
  | 'kbdTextColor'
  | 'kbdBackgroundColor'
  | 'tableBorderColor'
  | 'tableHeaderTextColor'
  | 'tableHeaderBackgroundColor';
```

Resolve initial App styles and mark all non-paper manual changes Custom:

```ts
const resolveDraft = (style: ExportStyle) => resolveExportStyleForTheme(style, appTheme);
const [draftStyle, setDraftStyle] = useState<ExportStyle>(() => resolveDraft(initialStyle));

const updateAppearance = (patch: Partial<ExportStyle>) => {
  setDraftStyle((current) =>
    normalizeExportStyle({ ...current, ...patch, preset: 'custom' }),
  );
};
```

Track the request identity in a ref. When the request changes, reset from `initialStyle`; when only `appTheme` or the resolved initial style changes, reapply it only if the current draft preset is `app`:

```ts
const previousRequestIdentityRef = useRef(requestIdentity);
useEffect(() => {
  const requestChanged = previousRequestIdentityRef.current !== requestIdentity;
  previousRequestIdentityRef.current = requestIdentity;
  if (requestChanged) {
    setDraftStyle(resolveExportStyleForTheme(initialStyle, appTheme));
    return;
  }
  setDraftStyle((current) =>
    current.preset === 'app'
      ? resolveExportStyleForTheme(initialStyle, appTheme)
      : current,
  );
}, [appTheme, initialStyle, requestIdentity]);
```

Keep paper-size updates on the existing normalization path without changing `preset`.

- [ ] **Step 4: Render the requested controls and wording**

Change the rail heading to a single line:

```tsx
<div className="mb-5 border-l-2 border-foreground pl-3">
  <p className="font-heading text-sm font-medium">Config</p>
</div>
```

Render this select as the first child of the control grid:

```tsx
<div className="grid gap-2">
  <Label htmlFor={controlId('preset')} className="text-xs font-medium text-foreground/85">
    Preset
  </Label>
  <select
    id={controlId('preset')}
    aria-label="Preset"
    value={draftStyle.preset}
    disabled={busy}
    onChange={(event) =>
      setDraftStyle((current) =>
        applyExportStylePreset(
          current,
          event.target.value as ExportStylePreset,
          appTheme,
        ),
      )
    }
  >
    <option value="app">Match app theme</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
    <option value="custom">Custom</option>
  </select>
</div>
```

Add a Table fieldset after the page color controls with the three labels from the design. Remove `bg-white` from the preview sheet and iframe and set `style={{ backgroundColor: draftStyle.backgroundColor }}` on both, merging the existing PDF `aspectRatio` style on the sheet.

Replace the Reset handler so it restores the app-synced appearance while retaining the request's initial paper size:

```tsx
onClick={() =>
  setDraftStyle(
    applyExportStylePreset(initialStyle, 'app', appTheme),
  )
}
```

- [ ] **Step 5: Run the component test and verify GREEN**

Run:

```bash
pnpm vitest run src/shell/ExportPreviewTab.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: all Export Preview component tests pass.

### Task 3: Thread the active app theme through export orchestration

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write a failing dark-theme integration test**

Bootstrap with `theme.kind: 'BuiltInDark'`, open PDF export, and prove the initial preset and generated artifact use dark values:

```tsx
expect(await screen.findByLabelText('Preset')).toHaveValue('app');
expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
expect(screen.getByLabelText('Table border color')).toHaveValue('#3f3f46');
fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
await waitFor(() => {
  expect(exportPdfFileMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.stringContaining('border-color: #3f3f46'),
    'A4',
    32,
  );
});
```

Extend the existing style persistence test: change Preset to `light`, edit a color so it becomes `custom`, confirm, reopen Export Preview, and assert the Custom preset and color remain.

- [ ] **Step 2: Run the focused App tests and verify RED**

Run:

```bash
pnpm vitest run src/App.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because App does not resolve or pass the active theme and the component prop is missing.

- [ ] **Step 3: Resolve and pass the current export theme**

Import `resolveExportStyleForTheme` and `ExportTheme`, then derive the theme and initial style near the current export state:

```ts
const exportAppTheme: ExportTheme =
  snapshot.theme.kind === 'BuiltInDark' ? 'dark' : 'light';
const exportPreviewInitialStyle = useMemo(
  () =>
    resolveExportStyleForTheme(
      normalizeExportStyle({ ...exportStyle, paperSize: settings.pdfPaperSize }),
      exportAppTheme,
    ),
  [exportAppTheme, exportStyle, settings.pdfPaperSize],
);
```

Pass `appTheme={exportAppTheme}` to `ExportPreviewTab`. Keep confirmation persistence unchanged except for the extended normalized style fields. `buildExportHtml` remains the final source of truth for both preview and artifact resolution.

- [ ] **Step 4: Run focused App and export tests and verify GREEN**

Run:

```bash
pnpm vitest run src/App.test.tsx src/shell/ExportPreviewTab.test.tsx src/lib/exportDocument.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: all focused tests pass.

### Task 4: Audit and verify the complete requirement

**Files:**
- Inspect: `src/lib/exportDocument.ts`
- Inspect: `src/shell/ExportPreviewTab.tsx`
- Inspect: `src/App.tsx`
- Inspect: all modified tests

- [ ] **Step 1: Run formatting and source checks**

Run:

```bash
git diff --check
rg -n "Artifact controls|Every value below is applied" src
```

Expected: no whitespace errors and no matches for either removed UI string.

- [ ] **Step 2: Run TypeScript checking and the full serial frontend suite**

Run:

```bash
pnpm exec tsc --noEmit
pnpm vitest run --maxWorkers=1 --no-file-parallelism
```

Expected: TypeScript succeeds and every Vitest file passes.

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm build
```

Expected: the frontend and Tauri production build complete successfully.

- [ ] **Step 4: Perform a requirement-by-requirement source audit**

Confirm all of the following from current source and test evidence:

```text
[ ] Match app theme resolves BuiltInLight to the Light palette.
[ ] Match app theme resolves BuiltInDark to the Dark palette.
[ ] Fixed Light/Dark and Custom remain user-selectable and persisted.
[ ] Table border, header text, and header background are coherent and editable.
[ ] Preview and final HTML/PDF use the same buildExportHtml CSS.
[ ] Preset is the first control.
[ ] Artifact controls is now Config.
[ ] The verbose description is absent.
[ ] Dark preview has no hard-coded white sheet or iframe background.
[ ] Legacy default and customized saved styles migrate without data loss.
```

- [ ] **Step 5: Review, commit in logical units, and push**

Review the complete diff with the code-review skill. Stage explicit paths only, create Conventional Commits for the implementation and any plan/spec updates, and run plain `git push`. Never use a force option.
