# Changelog

## 1.0.1 — 2026-11-02

- Simplify successful-send logs by removing the redundant delivery-status message.

## 1.0.0 — 2026-11-02

Initial release of the MeowPush GitHub Action.

- Send notifications with an Application Push Key and message body.
- Support the common MeowPush message fields, custom HTTP/HTTPS endpoints, and a millisecond `timeout`.
- Expose notification IDs, acceptance counts, sanitized target results and error outputs to later steps or jobs.
- Preserve multiline text, Unicode, numeric zero and custom JSON number precision.
- Send once without automatic retries or redirects; report partial failures and empty target sets as failed steps.
- Run on Linux, Windows and macOS with x64/arm64 runners using Node.js 24.
- Include English and Chinese usage examples.
