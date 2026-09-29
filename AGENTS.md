# Repository instructions

## Push includes release

The repository owner's standing instruction is to complete a release whenever
an authorized task pushes completed work to `main`. A request to push, including
`$gcpr` / `$git-commit-push-realtime`, includes authorization to bump the version,
build, and publish the GitHub Release. Continue without asking for release
confirmation unless the user explicitly requests a push without a release.
This applies to documentation and configuration changes too.

- For realtime checkpoint workflows, push verified checkpoints as usual, then
  publish one release from the final completed state before ending the task.
- The version-bump push belongs to that same release; it does not trigger
  another bump or an endless release cycle.
- Releases require `main`. A feature-branch push does not authorize merging it
  into `main`; report that its release remains pending integration.
- Preserve unrelated changes. Never force-push, overwrite an existing tag or
  release, bypass verification, or publish a build from a different commit.

## Required release workflow

1. Finish the requested changes and run the relevant checks. Commit and push
   using the requested Git workflow.
2. Check the working tree, current branch, and upstream after fetching. Publish
   only from a clean `main` with `origin/main` parity of `0 0`.
3. Run `pnpm bump refresh`, then `pnpm sync-version --check`. The version scheme
   is `MAJOR.YYMMDD.PATCH`; do not hand-edit individual version copies.
4. Write `docs/releases/v<version>.md` with a concise, user-facing summary of
   additions, changes, and fixes since the previous published release. Review
   the actual diff and commits; describe the resulting behavior, omit empty
   categories, and call out compatibility changes only when present. Do not
   substitute a raw commit list or placeholders for the summary. Review and
   explicitly stage this file alongside `VERSION`, `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock`. Commit as
   `chore(release): v<version>`, push, and verify upstream parity again.
5. On macOS, run `pnpm release:publish`. This runs the release-script tests,
   frontend tests, shell-script tests, and serialized Rust tests, builds the
   Universal DMG, verifies it with `hdiutil`, and publishes the release. It may
   reuse a verified DMG only when its recorded version, commit, and SHA-256 match.
   Publishing requires the version-specific notes file and prepends it to
   GitHub's generated release notes; never publish with generated notes alone.
6. Verify the published release is not a draft, the tag points to the final
   commit, and the Universal DMG is uploaded with a digest matching the local
   build. Check that the published body includes the prepared change summary.
   Report the release URL and final Git status, not just a successful push.

If the current version is already published from the exact final commit with a
verified asset, verify and report it instead of creating a duplicate release.
If publishing fails, investigate and retry with the same verified build when
possible. Report any remaining blocker explicitly; a push alone is incomplete.

## GitHub authentication

Publish `channprj/markdowner` using the existing `channprj` GitHub credentials.
On machines with multiple accounts, a shell wrapper may select the right
account interactively while Node subprocesses inherit a different active
account. Pin the existing token to the publishing process:

```sh
(
  markdowner_release_token="$(command gh auth token --hostname github.com --user channprj)" || exit 1
  test -n "$markdowner_release_token" || exit 1
  GH_TOKEN="$markdowner_release_token" pnpm release:publish
)
```

Never print the token, enable shell tracing around this command, or persist it
in repository files. If the credential is unavailable, report the authentication
blocker. GitHub Actions release automation remains disabled; the agent performs
this local release workflow as part of completing an authorized push task.
