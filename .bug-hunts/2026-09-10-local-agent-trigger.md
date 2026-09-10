# Local agent trigger

- Symptom: a single `@` opens the local agent composer and cannot be typed normally.
- Expected: only `@@` opens the composer; a single `@` remains ordinary text.
- Environment: Markdowner 0.260909.0, React 19, Tiptap 3, macOS; WYSIWYG keyboard input.
- First seen: reported 2026-09-10; last working version unknown.
- Architecture: React/Tiptap editor input is handled in the frontend; platform APIs are unaffected.

## Hypothesis ledger

| # | Hypothesis | Falsified if | Observed | Verdict |
|---|---|---|---|---|
| 1 | Mention eligibility intercepts the first `@` at a block/whitespace boundary | A single `@` returns no eligible range | First `@` returns a range; second `@` returns null | Survived |

## Reproduction

`pnpm exec vitest run src/features/ai/localAgents/mentions.test.ts --maxWorkers=1`

Before fix: 4 failed, 18 passed. Single `@` expected null but received a range;
second `@` expected the trigger range but received null.

After fix: `pnpm exec vitest run src/features/ai/localAgents/mentions.test.ts src/App.test.tsx --maxWorkers=1 -t 'local agent|local-agent|localAgent'`
passed 33 relevant tests (270 unrelated tests filtered out).

## Diagnosis

- Cause: eligibility checked the boundary before the current caret without requiring an existing `@`.
- Fix: require the preceding `@` at a safe boundary with a collapsed caret. Consume that first character before capturing the insertion destination and prevent the second key. App regression tests exercise ordinary first-key handling, trigger cleanup, composer opening, serializer fallback, and reopening.
- Falsified: none; the first hypothesis reproduced the reported behavior directly.
- Blast radius: searched all mention eligibility callers; only the WYSIWYG App key handler uses this helper. Command Palette and explicit AI actions retain their independent entry points.
- Left open: none for the trigger. Floating UI placement is tracked as a separate requested fix.
- Instrumentation: no temporary probes added.
