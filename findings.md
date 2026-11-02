# Research findings — MeowPush Action v1

## Owning local sources (read during planning)

- ../meowpush-docs/docs/zh/api/index.md: POST https://send.meowpush.com/; public fields, key/keys, response, upstream acceptance semantics.
- ../meowpush-push-server/server/src/api/push.rs: actual DTO, validation, response status mapping, lossless data decoding.
- ../meowpush-push-server/server/src/service/model.rs: PushResponse/PushResult, new notification IDs, submitted key echo.
- ../meowpush-push-server/docs/public/unipush-api-reference.md: retry caveats; no public request idempotency or dry-run contract.

## Important distinctions

- Public docs describe keys max 50 and badge 0–99; source permits up to 100 keys (deployment configurable), badge 9999, and critical level behind a deployment flag. This Action documents the public contract and avoids copying business validation.
- HTTP 200 may include all/partial failures or empty target expansion. Check both accepted and failed.
- A non-2xx response may contain an error envelope or a normal aggregate PushResponse. Gateway failures may be non-JSON.
- results.key/source_keys echo submitted credentials; output must remove them. Counts are final results, not proof of device delivery.
- data JSON uses lossless numeric handling on the server; JSON.parse/stringify round-tripping in JS is unsuitable.
- collapse_id replaces displayed notifications; it is not request deduplication. No automatic retries.

## Primary references

- https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action
- https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepscontinue-on-error
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases
- https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/
- https://nodejs.org/learn/http/enterprise-network-configuration

Node24 Actions use the runner's runtime. Pure JS avoids platform binaries. Node20 has been retired; ARM32 and old macOS are outside the compatibility promise. Node fetch respects proxy environment variables when NODE_USE_ENV_PROXY=1 is set before process start. setOutput before setFailed preserves outputs; downstream execution still needs continue-on-error or an appropriate condition.

## Review findings — 2026-10-27

- Native fetch can replay a POST after HTTP 421 when the body has a replayable source. The installed Undici implementation in `node_modules/undici/lib/web/fetch/index.js` checks `request.body.source` before retrying. A local server returning 421 then 200 reproduced two requests with the old string payload. A one-shot ReadableStream and `duplex: 'half'` retained the original 421 and sent exactly once. Explicit UTF-8 Content-Length preserves request framing.
- The current sibling application guide recommends a dedicated application: create it at Account Management or in the app, select recipients, then copy the Application Push Key. Device/Group keys remain protocol-compatible but should not be the documented recommended setup.
- Real-time 100 ms timeout tests assume fast runner scheduling. Waiting for request/headers before advancing mocked timers tests the same abort behavior without that assumption.
