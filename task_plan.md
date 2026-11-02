# MeowPush Action v1 implementation plan

## Objective and decisions

Implement the user-approved public Node.js 24 Action in the current repository and branch. Single POST, native fetch, bundled @actions/core, no runtime installation. MIT licensed. Standard Action plus examples; no Docker, reusable workflow or automatic templates.

Inputs: key/keys (exclusive), body, title, subtitle, level, badge, icon, image, url, group, collapse-id, ttl, data, endpoint, timeout (milliseconds). Only public documentation fields; no sound, group_filter or transport overrides. Preserve body whitespace and raw data JSON numeric precision. Validate structure/types locally, leave business limits to the server. Custom HTTP and HTTPS endpoints are allowed. Timeout defaults to 30000 milliseconds; no retries or redirects.

Success requires a valid 2xx PushResponse with accepted > 0 and failed = 0. Always write available outputs before failure: success, notification-id, accepted, failed, results, http-status, error-code, error-message. Replace returned keys with zero-based input indexes; redact all diagnostics. Tolerating failure uses step-level continue-on-error.

## Phase 1 — Grounding and plan

Status: complete

- [x] Inspect empty master repository and available Node.js 24 tooling.
- [x] Record approved scope, source references and known API documentation drift.
- [x] Assign independent documentation and CI work without overlapping source edits.

## Phase 2 — Implementation and verification

Status: complete

- [x] Implement input conversion, bounded HTTP send, response validation, sanitization and outputs.
- [x] Add metadata, package lock, esbuild distribution and meaningful unit/integration tests.
- [x] Configure six-platform CI, metadata/workflow validation, formatting and dist consistency.
- [x] Run local checks and review implementation; fix discovered defects.

## Phase 3 — Documentation and handoff

Status: complete

- [x] Complete English/Chinese README, MIT, contribution/security/release guidance.
- [x] Record final architecture and exact output/error contracts under docs/design.
- [x] Update verification evidence and distinguish local checks from pending hosted CI.

## Boundaries

Do not create branches/worktrees or publish tags/releases without a separate request. On 2026-11-02 the user authorized committing and pushing this implementation, configuring the existing sibling test repository, and sending real notifications through its configured GitHub Secrets for acceptance testing. Fixes may be committed and pushed as needed to complete that testing. Action repository: azurdream/meowpush-gh-actions; test repository: azurdream/meowpush-gh-actions-test.

## Verification

Node built-in tests with local HTTP mock and child-process bundled Action tests. Cover Unicode/multiline, zero values, lossless data, key combinations, errors, partial/empty results, timeout through body read, no retries/redirects, masking and step outputs. GitHub matrix: Linux/Windows/macOS × x64/arm64, including actual uses: ./ and continue-on-error assertions. Hosted CI can only be claimed after a real run.

## Errors encountered

| Error                                                         | Resolution                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Local mock server listen returned EPERM in filesystem sandbox | Re-ran local-only tests with approved sandbox escalation; no remote service was contacted. |

## Phase 4 — Review and public documentation refinement

Status: complete

- [x] Review the initial working tree against the approved spec and project standards; reproduce and fix actionable defects.
- [x] Make Application Push Keys the recommended setup; retain legacy Device/Group compatibility without recommending it.
- [x] Remove temporary handoff notes, unnecessary unsupported-field mentions and repetitive explanations from public documentation.
- [x] Revalidate affected runtime behavior, generated distribution, bilingual examples and documentation links.
- [x] Record review findings, fixes and remaining verification limits.

## Phase 5 — Push and live acceptance

Status: complete

- [x] Verify both remotes and secret names, validate the intended commit scope, and push the Action implementation.
- [x] Configure the existing test repository to use the Action at an exact commit SHA with its existing secret.
- [x] Run the Action repository's six-platform CI and real cross-repository acceptance tests; inspect results and logs.
- [x] Fix failures, push scoped English Conventional Commits and rerun affected tests until acceptance passes.
- [x] Record commit/run links and observed acceptance results, distinguishing API acceptance from device display.
