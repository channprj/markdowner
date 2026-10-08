# Update check fails when the GitHub API quota is exhausted

- Symptom: latest-version checking shows “Check failed”.
- Expected: identify the latest published version and its Universal DMG without requiring GitHub login.
- Environment: macOS; repository and installed app version 0.260929.3; clean main at 05553c3, matching origin/main.
- First seen: reported 2026-10-08; last working version unknown.

## Reproduction

`curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: markdowner' https://api.github.com/repos/channprj/markdowner/releases/latest`

Exit 56, HTTP 403. Response headers report `x-ratelimit-limit: 60`, `x-ratelimit-remaining: 0`; the JSON message reports API rate limit exceeded. The updater uses this exact unauthenticated endpoint and turns curl failure into a rejected command, which the settings panel displays as “Check failed”. No personal network identifiers are retained here.

## Hypothesis ledger

| # | Hypothesis | Falsified if | Observed | Verdict |
|---|---|---|---|---|
| 1 | The unauthenticated REST API quota causes the failure | The exact updater request succeeds or fails for another reason | HTTP 403, remaining quota 0, rate-limit error body | Survived; root cause reproduced |
| 2 | Public GitHub release downloads share the exhausted REST quota | Public release endpoints succeed while the API is rate limited | The public latest-release page returned its final tag URL; a ranged DMG download returned HTTP 206 while the API returned 403 | Falsified |
| 3 | Full-suite App failures are caused by its first lazy import consuming the interaction test deadline | Preloading App outside the individual tests leaves the same interaction failure | The first five tests timed out; late renders then duplicated AI controls. A preload hook moved module loading to suite setup; those interactions passed in 11–143ms | Survived; test setup defect |

## Regression check, fix, and final verification

- `cargo test -p markdowner-desktop updater::tests::live_latest_release_can_be_checked_without_github_login -- --ignored --exact` failed before the fix: `public update check should succeed: "curl exited with status exit status: 56"`. This invokes the actual backend lookup, not a stub.
- `node --test --test-name-pattern='public update metadata' scripts/release.node-test.mjs` failed before the publisher fix: `latest.json must be uploaded alongside the DMG`. After the fix, all 23 release-script tests passed.
- The updater now fetches the public `releases/latest/download/latest.json` release asset first. Older releases without this asset retain the REST API fallback. Release publishing generates and uploads that file alongside the verified Universal DMG, with its exact version, asset URL, and prepared notes.
- Network checks run on a blocking worker, have bounded connection/total timeouts, ignore user curl configuration, and preserve HTTP error details if both sources fail.
- Local HTTP tests exercise real curl for public metadata success, legacy-release fallback, and failure of both sources. The first run found that accepted sockets inherit nonblocking mode on macOS; the test fixture now explicitly restores blocking mode before reading requests.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Updater: `cargo test -p markdowner-desktop updater::tests -- --test-threads=1` passed all 12 local tests; the live publication check remains opt-in.
- The first full frontend run had 1863 passes and seven App failures: five lazy-import timeouts followed by duplicate/missing AI controls. A focused first-test run reproduced its 5000ms timeout. Preloading App in suite setup keeps compilation outside the unchanged per-interaction deadlines and prevents renders from timed-out tests leaking into later tests. The temporary timing probe was removed.
- Final `pnpm test` passed: 23 release-script tests, 172 frontend files / 1870 tests, build-and-install script checks, and six self-update checks. A separate App run passed all 291 interaction tests. `git diff --check` and targeted rustfmt checks passed; independent code review found no defects.

## Cause

Update checks relied entirely on the unauthenticated GitHub REST API. Its quota is shared by public IP, so unrelated requests can exhaust it and make an otherwise valid published release inaccessible to the app's check. The backend rejected curl's 403 response and the frontend correctly showed “Check failed”.

## Fix

Publish a machine-readable JSON release asset and read it through GitHub's public latest-release download route. Keep the existing JSON shape and legacy API fallback so version comparison, notes, and DMG selection retain their behavior. The publishing and updater changes are one coupled fix: the public route becomes available with this release.

## Falsified

Public release downloads were not subject to the exhausted REST API quota in the reproduced environment.

## Blast radius

Searched `src-tauri/src` for `fetch_latest_release_json` and `RELEASES_LATEST_API`: this updater is the only in-app latest-release lookup. DMG installation already downloads a public release asset and needs no transport change. Existing frontend failure state remains truthful for real network failures.

## Left open

The end-to-end live check must be repeated after publication, because the previous published release does not contain `latest.json`. This network-dependent test is opt-in; ordinary tests use local HTTP fixtures. No temporary product instrumentation was added.
