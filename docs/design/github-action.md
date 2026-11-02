# MeowPush GitHub Action design

## Runtime and distribution

The Action runs on Node.js 24 using the runner's bundled runtime. `action.yml` points to `dist/index.cjs`, built with esbuild from plain JavaScript and `@actions/core`. The distribution includes dependency license notices and is checked against a fresh build in CI.

The runtime has four modules:

- `src/index.js` connects the GitHub toolkit to the Action.
- `src/action.js` coordinates inputs, requests and outputs.
- `src/inputs.js` validates input structure and constructs the JSON body.
- `src/send.js` handles HTTP, response validation and result sanitization.

Pure JavaScript keeps the same bundle usable on supported Linux, Windows and macOS x64/arm64 runners. See [GitHub's JavaScript Action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).

## Credentials and inputs

The recommended setup uses an Application Push Key stored in GitHub Secrets. Receiving devices and groups are managed in the MeowPush application. Device and Group keys remain supported for existing integrations, but are not recommended. An Application key must be the only key in a request.

The request is constructed from the declared inputs. `collapse-id` maps to `collapse_id`; other message field names match the [public API](https://docs.meowpush.com/en/api/#send-notifications).

Validation stays at the input boundary: required values, mutually exclusive key inputs, JSON types, duplicate keys, integer representation and incompatible key combinations. Message limits and credential validity belong to the server.

- Text inputs preserve whitespace. Empty optional fields are omitted; numeric zero is retained.
- `data` must be a JSON object without reserved top-level `aps` or `mp` properties.
- After structural validation, `data` is inserted as its original JSON text. Parsing and serializing its numbers would round large integers and decimals. The surrounding request fields are JSON-encoded separately.

## HTTP behavior

The Action sends one POST to `https://send.meowpush.com/` by default. Custom HTTP and HTTPS endpoints are supported. The `timeout` input sets an Action-side deadline covering sending and reading the response, in milliseconds. It defaults to 30000 and accepts positive integers up to 2147483647, within Node's timer range. It is not sent to the MeowPush API.

The UTF-8 payload is sent as a one-shot `ReadableStream` with an explicit byte `Content-Length` and `duplex: 'half'`. This prevents native fetch from replaying the POST after HTTP 421, which it can do with a string or Buffer body. A regression test checks the server receives exactly one request and the original 421 is reported.

Redirects are returned as failures. There is no automatic retry: a timeout can occur after a notification has been accepted, and a new request can duplicate it. `collapse_id` replaces displayed content; it does not deduplicate requests.

Responses are limited to 128 KiB after transport decompression. Sanitized output values are limited to 256 KiB measured as UTF-16. Exceeding either limit yields `action_response_too_large` and clears aggregate outputs.

Proxies and custom CAs use Node environment settings such as `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS`; see [Node network configuration](https://nodejs.org/learn/http/enterprise-network-configuration).

## Responses and outputs

Success requires HTTP 2xx, a valid aggregate response, `accepted > 0` and `failed === 0`. The response validator checks required field types and verifies the counters match the individual result statuses. Provider acceptance does not confirm device delivery or display.

A non-2xx response can contain an API error envelope or an aggregate result. Valid aggregate data is retained on failure. Unrecognized or non-JSON responses produce a diagnostic without exposing the raw body.

All eight declared outputs are written before `setFailed`. Unknown counts are empty strings, distinct from zero, and unavailable results are `[]`. The caller controls failure tolerance with step-level `continue-on-error`; cross-job consumers use job outputs. See [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepscontinue-on-error).

## Sanitization

Keys are registered for GitHub masking as soon as they are read. Input errors and network diagnostics avoid request data and arbitrary exception text.

Response strings are redacted against submitted keys and recognizable Push Key patterns. Result objects export only `status`, `transport`, `message_id`, `reason`, `detail`, `retry_at`, `delivery_adapter` and `delivery_policy`, plus source indexes:

- `key_index` replaces the primary source key.
- `source_key_indexes` replaces the source-key array.
- Indexes start at zero in input order; unmatched sources become `null`.

This preserves target correlation without returning credentials. GitHub's own secret heuristics may still suppress an output. The toolkit writes outputs and escapes annotations; response text cannot define new workflow commands. The runtime does not execute shell commands.

## Verification

Tests cover input conversion, lossless data, UTF-8 content length, response schemas, partial and empty results, redaction, deadlines, response bounds, redirects and HTTP 421 replay prevention. Timeout tests advance a simulated clock after the request or headers arrive, avoiding assumptions about runner speed. Standalone bundle tests run outside the repository to check that runtime dependencies are included.

CI runs actual `uses: ./` calls on `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`, `windows-11-arm`, `macos-15-intel` and `macos-15`, checking outputs and step failure handling against local mocks. Formatting, metadata, workflow syntax and distribution consistency are checked separately.
