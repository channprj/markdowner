# App test fixture timing and selectors

- Environment: Vitest/jsdom, full App suite during the 2026-09-10 release checks.
- Observed: the source-to-WYSIWYG caret test expected position 8 but observed 1 in the full suite; it passed alone. A baseline checkout before the popover changes failed the image-export error test because two surfaces rendered the same error text.
- Expected: assertions wait for the document under test to load and identify the intended alert.

| # | Hypothesis | Falsified if | Observed | Verdict |
|---|---|---|---|---|
| 1 | The caret test positions the cursor before async bootstrap fills the textarea | Waiting for source content still fails | Waiting for `# Alpha` still yielded position 1 in the full suite | Falsified |
| 2 | The export assertion assumes an error message has only one rendering | The query is scoped to the preview alert | A clean baseline full run reported two matching alert-description elements | Survived |
| 3 | The textarea mock never signals CodeMirror readiness, leaving startup restoration pending during the mode switch | Registering a source view and moving its selection still loses the caret | All 281 App tests passed with the source-view lifecycle represented | Survived |

## Reproduction

- Current full run: `pnpm exec vitest run src/App.test.tsx ... --maxWorkers=1`: caret test failed, 389 tests passed.
- Isolated caret test: 1 passed; timing depends on async bootstrap.
- Baseline abb0750 in a separate temporary worktree: `pnpm exec vitest run src/App.test.tsx --maxWorkers=1`: 280 passed, image-export selector failed with duplicate error text.

## Fix

Wait for `# Alpha`, register the CodeMirror view, and let startup restoration finish before moving the view's caret. Assert the native export error inside the `Export failed` alert. Assertions keep their original expected behavior; no test retries, longer timeouts, or skipped tests were added.

- Validation: `pnpm exec vitest run src/App.test.tsx --maxWorkers=1` passed all 281 tests; TypeScript checking passed.
- Falsified: waiting for textarea content alone did not fix the caret fixture.
- Blast radius: two existing App test fixtures only; no product behavior changed.
- Left open: none in these fixtures after the full-suite validation recorded with the release.
