# Selection AI, Agent Discovery, and Auto Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selected-text AI preserve the user's exact byte range even at protected Markdown boundaries, expose a configurable selection-AI shortcut, make local CLI agent discovery reliable and manually configurable, and clarify that file auto-save is opt-in while recovery backups remain continuously enabled.

**Architecture:** Keep Markdown safety in `markdowner-core`, treating every protected-token intersection with the exact selection as an opaque fragment and validating the reconstructed full token after replacement. Keep shortcut and settings ownership in the existing typed settings/keymap layers. Pass explicit local-agent executable paths from persisted settings through the frontend command boundary into Rust, where every path still receives canonicalization, ownership, permission, and compatibility checks. Make automatic discovery deterministic by combining current PATH, a marker-framed login-shell PATH, and a small non-recursive standard-directory list. Preserve the existing draft-recovery pipeline independently from the file auto-save eligibility gate.

**Tech Stack:** Rust 2024, Tauri 2, React 19, TypeScript 5.8, Vitest 4, Testing Library, pnpm 10, Cargo.

## Global Constraints

- Work in the user-approved current `main` checkout, starting at `c61d605`, and preserve unrelated user changes if any appear.
- Follow strict TDD for every behavior change: add a behavior test, observe the expected failure, implement the smallest coherent change, and rerun the focused suite.
- Preserve the exact user-selected byte range. Never expand a selection to token boundaries.
- Protected Markdown fragments are opaque. Provider or local-agent output may not alter, remove, duplicate, or reorder them.
- A selection with no editable bytes must fail before any paid provider or local process is invoked.
- Invalid or stale AI output must remain available through Review; it must not be applied to a different range.
- Manual executable paths are authoritative. An invalid manual path reports its own failure and never silently falls back to automatic discovery.
- Do not recursively scan the filesystem and do not weaken executable ownership or write-permission checks.
- `autoSave` means writing the open source file after one second. Recovery backup persistence remains enabled after one second regardless of `autoSave`.
- Do not bump the application version or create a release for this work.
- Never issue a real paid OpenRouter request during verification.
- At every checkpoint, stage only the named files, use a Conventional Commit message, push immediately, and prove `git rev-list --left-right --count HEAD...@{upstream}` returns `0 0`.

## Task 1: Support Exact Selections That Cross Protected Markdown Boundaries

**Files:**

- Modify: `crates/markdowner-core/src/ai_document.rs`
- Modify: `crates/markdowner-core/tests/ai_document.rs`
- Modify: `crates/markdowner-core/tests/markdown_fixtures.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/local_agents/mod.rs`

### 1.1 Specify the clipped-protection behavior in core tests

- [ ] Replace the fixture assertion that currently expects `Selection boundaries cannot split a protected Markdown element.` with a table of exact selection ranges that begin or end inside a protected link/image/code token.
- [ ] For each case, assert that `AiDocumentEnvelope::selection(...)` succeeds, `scope()` is byte-for-byte identical to the requested range, and the prompt envelope masks only the intersecting protected fragment.
- [ ] Add response-validation cases proving that editable text adjacent to a clipped protected fragment can change while the full Markdown token is reconstructed unchanged.
- [ ] Add hostile response cases for changed, missing, duplicated, and reordered clipped fragments, plus a case that injects bytes between the inside and outside pieces of a crossing token.
- [ ] Use literal source strings, literal ranges, and literal expected Markdown so the assertions do not reuse the production clipping algorithm.

Run:

```bash
cargo test --manifest-path crates/markdowner-core/Cargo.toml --test ai_document
cargo test --manifest-path crates/markdowner-core/Cargo.toml --test markdown_fixtures
```

Expected before implementation: the newly accepted boundary cases fail with the existing protected-boundary error.

### 1.2 Clip full-document protection to the exact selection

- [ ] In `AiDocumentEnvelope::with_policy`, remove only the selection-time rejection for a boundary inside a protected token; retain cursor insertion boundary rejection.
- [ ] Replace the wholly-contained-token filter in `segment_selection_from_full_protection` with a byte-range intersection:

```rust
let clipped_start = token.range.start.max(scope.start);
let clipped_end = token.range.end.min(scope.end);
```

- [ ] Skip empty intersections and express each non-empty intersection relative to `scope.start` while preserving the original protection kind.
- [ ] Keep full-document protection metadata available to validation so the clipped fragment can be tied back to its original full token.

### 1.3 Validate reconstructed full protected tokens

- [ ] Extend `validate_restored_protected_context` to derive the expected full token from three pieces: unchanged bytes before the selection, the restored protected binding inside the selection, and unchanged bytes after the selection.
- [ ] Compute shifted output positions from the selected replacement delta, then require one contiguous observed protected token of the same kind and exact original bytes.
- [ ] Reject extra bytes between the three pieces, fragment duplication, reordering, deletion, and any changed protected bytes with the existing protected-Markdown validation family.
- [ ] Keep `validate_selection_response` returning an operation whose range is exactly the original selection range.
- [ ] Run both focused core suites until green.

### 1.4 Reject selections with zero editable bytes before execution

- [ ] Add an `AiDocumentEnvelope` query such as `selection_has_editable_bytes()` that subtracts the union of clipped protected ranges from the exact selection length.
- [ ] Add core tests for a fully protected selection, a zero-length selection, and a selection containing at least one editable byte.
- [ ] In `src-tauri/src/ai/mod.rs`, reject a selected-text request with no editable bytes before constructing or sending any provider request. Use the actionable message `The selection contains only protected Markdown and cannot be changed.`
- [ ] In `src-tauri/src/local_agents/mod.rs`, perform the same check during request validation, before discovery or process launch.
- [ ] Add Rust tests whose fake provider/process counter stays at zero for the fully protected case.

Run:

```bash
cargo test --manifest-path crates/markdowner-core/Cargo.toml ai_document
cargo test --manifest-path src-tauri/Cargo.toml ai
cargo test --manifest-path src-tauri/Cargo.toml local_agents
```

### 1.5 Checkpoint the protected-selection implementation

- [ ] Review `git diff --check` and the named test diffs for accidental selection expansion.
- [ ] Stage only the five files listed in this task.
- [ ] Commit as `fix(ai): support protected selection boundaries`.
- [ ] Push `main` immediately and confirm local/tracking/live-remote parity is `0 0`.

## Task 2: Add a Configurable Selected-Text AI Shortcut

**Files:**

- Modify: `src/lib/keymap.ts`
- Modify: `src/lib/keymap.test.ts`
- Modify: `src/lib/keyboardShortcuts.ts`
- Modify: `src/lib/keyboardShortcuts.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/components/wysiwyg/SelectionToolbar.tsx`
- Modify: `src/components/wysiwyg/SelectionToolbar.test.tsx`
- Modify: `src/shell/WysiwygEditorChrome.tsx`
- Modify: `src/shell/WysiwygEditorChrome.test.tsx`

### 2.1 Define the command and default binding

- [ ] Add `ai.runSelection` to `ShellCommandId`, the AI section of `KEYMAP_ROWS`, and `DEFAULT_SHELL_BINDINGS` with `Cmd+Shift+K` on macOS semantics.
- [ ] Add keymap tests proving the default resolves to key `k` plus Shift and that a stored override replaces it.
- [ ] Add `runAiOnSelection` to `ShellShortcutAction` and map the command in `resolveShellShortcutAction`.
- [ ] Add resolver tests for the default, a custom binding, a conflicting binding, and an unrelated key.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/lib/keymap.test.ts src/lib/keyboardShortcuts.test.ts
```

Expected before implementation: the new command/action assertions fail because no shell binding exists.

### 2.2 Route the shortcut through the existing selection action

- [ ] Extend the global shell-shortcut switch in `src/App.tsx` so `runAiOnSelection` calls the existing `openAiForCurrentSelection` callback.
- [ ] Ensure the handled shortcut prevents editor-native behavior in both source and WYSIWYG modes.
- [ ] Add App tests that create a real source selection and a real WYSIWYG selection, dispatch the default keyboard event, and observe the selection-AI composer opening for the same selected range.
- [ ] Add a custom-binding App test proving the old default no longer fires after rebinding.

### 2.3 Show the effective binding wherever the action appears

- [ ] Compute the effective formatted binding from current settings once and pass it to the command palette, source selection action, and WYSIWYG editor chrome.
- [ ] Give the existing `ai.runSelection` command-palette entry its effective shortcut label.
- [ ] Add an optional shortcut prop to `WysiwygEditorChrome` and `SelectionToolbar`; append it to the AI button tooltip and accessible label without changing the visible compact toolbar layout.
- [ ] Append the effective shortcut to the source-selection AI button tooltip and accessible label.
- [ ] Update component and palette tests to assert the effective default and a custom override rather than testing static source text.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/App.test.tsx src/shell/commandPaletteCommands.test.ts src/components/wysiwyg/SelectionToolbar.test.tsx src/shell/WysiwygEditorChrome.test.tsx
```

### 2.4 Checkpoint the shortcut implementation

- [ ] Run `git diff --check` and the full shortcut/component focused set.
- [ ] Stage only the twelve files listed in this task.
- [ ] Commit as `feat(shortcuts): bind selected-text AI prompt`.
- [ ] Push immediately and confirm parity is `0 0`.

## Task 3: Persist and Use Manual Local-Agent Executable Paths

**Files:**

- Modify: `src/lib/settings.ts`
- Modify: `src/lib/settings.test.ts`
- Modify: `crates/markdowner-core/src/settings.rs`
- Modify: `src/features/ai/localAgents/types.ts`
- Modify: `src/lib/desktop.ts`
- Modify: `src/lib/desktop.test.ts`
- Modify: `src/features/ai/localAgents/LocalAgentSettings.tsx`
- Modify: `src/features/ai/localAgents/LocalAgentSettings.test.tsx`
- Modify: `src/features/ai/localAgents/LocalAgentComposer.tsx`
- Modify: `src/features/ai/localAgents/LocalAgentComposer.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/shell/SettingsPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/local_agents/mod.rs`
- Modify: `src-tauri/src/local_agents/discovery.rs`
- Modify: `src-tauri/src/local_agents/process.rs`
- Modify: `src-tauri/src/local_agents/adapters.rs`

### 3.1 Add a version-tolerant settings shape

- [ ] Define a typed `LocalAgentExecutablePaths` object with `claude`, `codex`, and `opencode` string fields in TypeScript and Rust.
- [ ] Add `localAgentExecutablePaths` to `Settings`, defaulting each entry to an empty string.
- [ ] Normalize each stored entry independently: preserve a string, replace a missing or malformed value with `""`, and do not discard other valid settings.
- [ ] Add TypeScript and Rust migration tests for missing, partial, valid, and malformed saved objects.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/lib/settings.test.ts
cargo test --manifest-path crates/markdowner-core/Cargo.toml settings
```

Expected before implementation: the persisted manual paths are absent or lost during normalization.

### 3.2 Extend the Tauri command contract

- [ ] Add `executablePath: string | null` to `LocalAgentRunRequest` and add the three-path object to `localAgentStatuses` input.
- [ ] Update `src/lib/desktop.ts` so status invokes `local_agent_statuses` with `{ executablePaths }`, and run serializes the optional path inside the request.
- [ ] Update desktop boundary tests with complete request/status fixtures and literal expected invoke arguments.
- [ ] Mirror the fields in Rust with camelCase serde behavior, keeping the debug formatter from printing document or instruction content.
- [ ] Update Rust request fixtures in adapters, process, and local-agent module tests.

### 3.3 Resolve manual paths authoritatively and safely

- [ ] Add a discovery entry point that accepts an optional manual path for a specific agent kind.
- [ ] Trim the configured value, expand only `~/`, reject other unexpanded tildes and relative paths, canonicalize symlinks, and apply the existing regular-file, executable, ownership, parent-directory, writable-permission, hash, and version-probe checks.
- [ ] Return a status source distinguishable as `Manual` or `Automatic`, while keeping the canonical executable path in the status.
- [ ] If a non-empty manual path fails any check or version compatibility probe, return that failure without invoking automatic discovery.
- [ ] Add Rust tests for a valid manual symlink, a relative path, a missing file, an unsafe executable, an incompatible binary, and proof that automatic candidates are not consulted after a manual failure.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml local_agents::discovery
cargo test --manifest-path src-tauri/Cargo.toml local_agents
```

### 3.4 Add Browse, Reset, and per-agent status UI

- [ ] Extend `LocalAgentSettings` props with the stored path object, an update callback, an injectable `selectExecutable(kind)` service, and `listStatuses(paths)`.
- [ ] Default Browse to Tauri's file dialog with a single-file selection and an agent-specific title.
- [ ] Render one path input, Browse button, Reset button, resolved canonical path/source, version, and failure reason per agent.
- [ ] Update one agent path immutably without overwriting the other two and refresh statuses with the same paths.
- [ ] Pass the settings object through `SettingsPanel` and App.
- [ ] Pass the same selected path into every composer status refresh and run request so the displayed status and launched binary cannot diverge.
- [ ] Add Testing Library cases for typing a path, Browse success/cancel, Reset, isolated per-agent updates, manual failure display, and the exact run request path.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/features/ai/localAgents/LocalAgentSettings.test.tsx src/features/ai/localAgents/LocalAgentComposer.test.tsx src/shell/SettingsPanel.test.tsx src/lib/desktop.test.ts
```

### 3.5 Checkpoint the manual-path implementation

- [ ] Run `git diff --check`, both settings suites, local-agent Rust suites, and the four frontend focused suites.
- [ ] Stage only the seventeen files listed in this task.
- [ ] Commit as `feat(ai): configure local agent executable paths`.
- [ ] Push immediately and confirm parity is `0 0`.

## Task 4: Make Automatic Local-Agent Discovery Resilient

**Files:**

- Modify: `src-tauri/src/local_agents/discovery.rs`
- Modify: `src-tauri/src/local_agents/mod.rs`

### 4.1 Parse PATH from noisy login shells

- [ ] Add tests whose fake login shell prints banners and session output before and after a uniquely framed PATH payload.
- [ ] Cover multiple marker-looking lines, missing markers, reversed markers, an empty framed PATH, invalid UTF-8, timeout, oversized output, and carriage returns.
- [ ] Invoke the configured login shell with fixed `-l -c` arguments that print a begin marker, the raw PATH, and an end marker; do not interpolate user input into the shell program.
- [ ] Parse the final complete bounded marker pair, validate the payload, and ignore all bytes outside the frame.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml login_shell_path
```

Expected before implementation: the banner-wrapped valid PATH case is rejected as multiline output.

### 4.2 Add deterministic standard directories

- [ ] Build the automatic search list in this precedence order: process/GUI PATH, framed login-shell PATH, then standard directories.
- [ ] Add the fixed system directories `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, and `/bin`.
- [ ] If HOME is absolute, add `~/.local/bin`, `~/.opencode/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.volta/bin`, `~/.npm-global/bin`, `~/.local/share/pnpm`, and `~/Library/pnpm`.
- [ ] Normalize and deduplicate directories without recursive scanning; preserve first occurrence precedence.
- [ ] Add literal-order tests for duplicate PATH entries, absent/relative HOME, and a user binary found only in a standard directory.

### 4.3 Probe candidates until one is compatible

- [ ] Change automatic discovery from “resolve the first executable, then probe once” to “resolve and probe each candidate in precedence order until one is compatible.”
- [ ] Continue after missing, unsafe, or version-incompatible automatic candidates while recording the highest-priority actionable failure.
- [ ] Return the first compatible candidate, or the recorded failure if none is compatible.
- [ ] Preserve the authoritative no-fallback behavior for a configured manual path.
- [ ] Add tests with an incompatible first candidate and compatible second candidate, all incompatible candidates, and manual incompatible candidate plus automatic compatible candidate.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml local_agents::discovery
cargo test --manifest-path src-tauri/Cargo.toml local_agents
```

### 4.4 Verify discovery against the current machine without mutating it

- [ ] Run the focused status/discovery tests.
- [ ] Run the existing read-only status command path or a targeted Rust test harness to confirm the installed `claude`, `codex`, and `opencode` candidates are evaluated from their actual canonical paths.
- [ ] Record unavailable or incompatible agents as status evidence, not as a test failure, provided the discovery contract and diagnostic reason are correct.

### 4.5 Checkpoint automatic discovery

- [ ] Run `git diff --check` and both local-agent Rust suites.
- [ ] Stage only `src-tauri/src/local_agents/discovery.rs` and `src-tauri/src/local_agents/mod.rs`.
- [ ] Commit as `fix(ai): discover agents from noisy login shells`.
- [ ] Push immediately and confirm parity is `0 0`.

## Task 5: Clarify File Auto Save While Preserving Recovery Backups

**Files:**

- Modify: `src/lib/settings.ts`
- Modify: `src/lib/settings.test.ts`
- Modify: `crates/markdowner-core/src/settings.rs`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/shell/SettingsPanel.test.tsx`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/App.test.tsx`

### 5.1 Make malformed `autoSave` migrate independently to false

- [ ] Add TypeScript and Rust tests loading settings with `autoSave` missing, `false`, `true`, and a malformed non-boolean while another setting remains valid.
- [ ] Preserve valid stored booleans exactly and normalize only malformed/missing values to the existing default `false`.
- [ ] In Rust, use a field-level tolerant boolean deserializer so a malformed `autoSave` value does not discard the rest of the settings object.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/lib/settings.test.ts
cargo test --manifest-path crates/markdowner-core/Cargo.toml settings
```

Expected before implementation: malformed values are either preserved in TypeScript or cause a broader Rust settings fallback.

### 5.2 Make the UI contract explicit

- [ ] Rename the Settings row to `Auto Save to File`.
- [ ] Add concise copy: `Writes edits to the open file after 1 second. Recovery backups are always kept separately.`
- [ ] Rename command-palette actions to `Enable Auto Save to File` and `Disable Auto Save to File`.
- [ ] Keep the control off for fresh settings and preserve a stored valid value.
- [ ] Add SettingsPanel and command-palette behavior tests for the label, description, toggle update, and current-state command label.

### 5.3 Prove file writes and recovery backups are independent

- [ ] Add an App integration test with fake timers and `autoSave: false` that edits a document, advances one second, observes the recovery-draft persistence call, and observes zero source-file write calls.
- [ ] Keep the existing enabled auto-save test proving the original file is written after one second.
- [ ] Keep the existing disabled test and hot-exit recovery coverage.
- [ ] Avoid asserting implementation timers directly; assert the two persistence boundary effects.

Run:

```bash
pnpm vitest run --maxWorkers=1 src/App.test.tsx src/shell/SettingsPanel.test.tsx src/shell/commandPaletteCommands.test.ts
```

### 5.4 Checkpoint auto-save clarification

- [ ] Run `git diff --check`, focused frontend tests, and Rust settings tests.
- [ ] Stage only the eight files listed in this task.
- [ ] Commit as `feat(editor): clarify file auto save and recovery`.
- [ ] Push immediately and confirm parity is `0 0`.

## Task 6: Integrated Verification, Review, and Remote Proof

**Files:**

- Modify only files required by a demonstrated verification failure.

### 6.1 Run formatting and static verification

- [ ] Run Prettier in check mode over every changed TypeScript, TSX, and Markdown file.
- [ ] Run `cargo fmt --all -- --check`.
- [ ] Run `git diff --check` and inspect the complete diff from `d4c260a` through HEAD for unrelated changes, accidental version changes, leaked paths, or weakened safety checks.

### 6.2 Run the full automated test chain

- [ ] Run frontend tests sequentially to avoid known contention:

```bash
pnpm vitest run --maxWorkers=1
```

- [ ] Run all Rust tests:

```bash
cargo test --manifest-path crates/markdowner-core/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] Run the repository's aggregate chain:

```bash
pnpm test
```

- [ ] Run a production build without a version bump:

```bash
pnpm build
```

### 6.3 Exercise the user-facing desktop chain

- [ ] Launch or install the debug/local app through the repository-supported build path without creating a release.
- [ ] In source mode, select text whose start or end falls inside protected Markdown, invoke `Cmd+Shift+K`, and confirm the exact selection opens in Prompt and unsafe output remains in Review.
- [ ] Repeat the shortcut in WYSIWYG mode and confirm a custom rebind is shown and honored.
- [ ] In Settings, configure, Browse, Reset, and refresh at least one local-agent path; confirm displayed path/source/version matches the executable used by the run request without issuing a paid provider request.
- [ ] Confirm `Auto Save to File` defaults off, source files are not written by the timer while off, and recovery restores an unsaved edit after relaunch.
- [ ] Report any macOS GUI, TCC, installed-app, or live-agent evidence that cannot be observed separately from automated test success.

### 6.4 Review and correct only evidenced issues

- [ ] Review correctness, protected-range security, settings migration safety, Tauri request compatibility, UI accessibility, and test mutation coverage.
- [ ] If review or verification finds an issue, add or adjust a failing test first, make the smallest correction, rerun the affected focused suite, and commit/push a scoped Conventional Commit.
- [ ] Do not rewrite or squash already-pushed checkpoints.

### 6.5 Prove final repository state

- [ ] Confirm `git status --short` is empty.
- [ ] Run `git fetch origin` and verify no upstream movement invalidates the completed work.
- [ ] Confirm `git rev-list --left-right --count HEAD...@{upstream}` returns `0 0`.
- [ ] Confirm `git rev-parse HEAD`, `git rev-parse @{upstream}`, and `git ls-remote origin refs/heads/main` identify the same commit.
- [ ] Report checkpoint commits, test/build/runtime evidence, any bounded evidence gap, and the intentional absence of a release/version bump.
