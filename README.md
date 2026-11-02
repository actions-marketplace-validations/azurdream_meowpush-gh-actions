# MeowPush GitHub Action

[简体中文](README.zh-CN.md)

Send [MeowPush](https://docs.meowpush.com/en/) notifications from GitHub Actions. Supports Linux, Windows and macOS on x64/arm64 runners, with no extra setup in your workflow.

## Quick start

1. Create an application in [MeowPush Account Management](https://accounts.meowpush.com/applications/) or the MeowPush app, and choose its receiving devices or groups.
2. Copy the **Application Push Key** (starting with `mpap`).
3. In your GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Save the key as `MEOWPUSH_KEY`.

Use an Application Push Key for CI. Device and Group Push Keys remain supported for compatibility, but are not recommended. You can change an application's receiving targets without changing its key in the workflow. See the [application guide](https://docs.meowpush.com/en/applications/).

```yaml
name: ci

on:
  push:

jobs:
  notify:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Send notification
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: CI notification
          body: Hello from GitHub Actions
```

To keep notification failures from failing the workflow, add `continue-on-error: true` to the notification step, at the same level as `uses`.

For an existing job, add just the `Send notification` step. This Action needs no checkout or GitHub token.

`@v1` follows compatible updates. To pin a release, use its version tag or full commit SHA.

## Inputs

`key` and `body` are required for the recommended setup. Optional fields follow the [MeowPush API](https://docs.meowpush.com/en/api/#send-notifications).

| Input         | Description                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `key`         | Push Key; an Application Push Key is recommended. Cannot be combined with `keys`.                                          |
| `keys`        | JSON array retained for Device/Group key compatibility, up to 50 unique keys. An Application Key can only appear alone.    |
| `body`        | Message text, 1–4000 characters. Preserves whitespace and newlines.                                                        |
| `title`       | Title, 1–256 characters.                                                                                                   |
| `subtitle`    | Subtitle, 1–256 characters. Display varies by platform.                                                                    |
| `level`       | `passive`, `active` or `time-sensitive`. Default: `active`.                                                                |
| `badge`       | Badge count, 0–99. `0` clears the badge.                                                                                   |
| `icon`        | HTTPS icon URL, 1–2048 characters.                                                                                         |
| `image`       | HTTPS image URL, 1–2048 characters.                                                                                        |
| `url`         | URI to open when the notification is selected, 1–2048 characters.                                                          |
| `group`       | Notification grouping identifier, 1–64 characters.                                                                         |
| `collapse-id` | Replaces prior displayed content with the same identifier. Format: `[A-Za-z0-9_-]{1,32}`.                                  |
| `ttl`         | Lifetime in seconds, 0–2419200. Default: `86400`.                                                                          |
| `data`        | Custom JSON object.                                                                                                        |
| `endpoint`    | Send URL. Default: `https://send.meowpush.com/`. Accepts HTTP or HTTPS URLs without embedded credentials.                  |
| `timeout`     | Action-side timeout for sending the request and reading its response, in milliseconds. Positive integer; default: `30000`. |

Empty optional inputs are omitted. Values such as `badge: '0'` and `ttl: '0'` are sent as zero.

### Rich text and custom data

Pass Markdown, HTML or JSON notification content as text in `body`:

```yaml
      - name: Send build details
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: Build completed
          body: |
            ## Build report
            Repository: ${{ github.repository }}
            Commit: ${{ github.sha }}

            [Open run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          group: github-actions
          data: '{"source":"github-actions"}'
```

For dynamic `data`, serialize the object as JSON rather than inserting unescaped text into a JSON string.

## Outputs and failures

The step succeeds when a valid HTTP 2xx response reports **`accepted > 0` and `failed == 0`**. Partial failure, no receiving targets, and request errors fail the step. `accepted` means the upstream push service accepted the notification; it does not confirm display on a device.

| Output                | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `success`             | String `true` or `false`.                                                |
| `notification-id`     | Server notification ID, or empty if unavailable.                         |
| `accepted` / `failed` | Result counts as strings, or empty if unavailable.                       |
| `results`             | Per-target results as a JSON array, with keys removed. Defaults to `[]`. |
| `http-status`         | HTTP status code, or empty if no response was received.                  |
| `error-code`          | Error code; empty on success.                                            |
| `error-message`       | Error description with keys removed; empty on success.                   |

Outputs remain available when the step fails. Set `continue-on-error: true` on the notification step to read them without letting a notification error fail the job:

```yaml
      - name: Notify
        id: notify
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          body: CI task completed

      - name: Inspect notification result
        env:
          NOTIFY_SUCCESS: ${{ steps.notify.outputs.success }}
          NOTIFY_ERROR: ${{ steps.notify.outputs.error-code }}
        shell: bash
        run: printf 'Notification success=%s error=%s\n' "$NOTIFY_SUCCESS" "$NOTIFY_ERROR"
```

This setting applies only to the notification step. Build and test failures still fail the job. A failed notification keeps `steps.notify.outcome == 'failure'`, while `conclusion` becomes `success`.

### Notify on build failure

Append this step to a build job:

```yaml
      - name: Notify build failure
        if: ${{ failure() }}
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: Build failed
          body: '${{ github.workflow }} failed on ${{ github.ref_name }}'
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

Use `if: ${{ always() }}` to also notify after successful steps.

### Summarize jobs and pass results to another job

Add these entries under `jobs`, alongside your `build` and `test` jobs. The notification runs even when either dependency fails or is skipped:

```yaml
  notify:
    needs: [build, test]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    permissions: {}
    outputs:
      success: ${{ steps.send.outputs.success }}
      notification-id: ${{ steps.send.outputs.notification-id }}
    steps:
      - name: Send summary
        id: send
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: CI results
          body: |
            ${{ github.repository }} / ${{ github.ref_name }}
            Build: ${{ needs.build.result }}
            Tests: ${{ needs.test.result }}
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

  inspect-notification:
    needs: notify
    if: ${{ always() && needs.notify.result == 'success' }}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Read notification result
        env:
          NOTIFICATION_ID: ${{ needs.notify.outputs.notification-id }}
          NOTIFY_SUCCESS: ${{ needs.notify.outputs.success }}
        shell: bash
        run: printf 'Notification %s success=%s\n' "$NOTIFICATION_ID" "$NOTIFY_SUCCESS"
```

### Per-target results

`results` contains each target's status, transport, message ID and any error details. Source keys are replaced by zero-based input indexes:

```json
[
  {
    "status": "accepted",
    "transport": "apns",
    "message_id": "provider-message-id",
    "key_index": 0,
    "source_key_indexes": [0]
  }
]
```

For a single Application Push Key, its index is `0`; it may have several receiving targets. For `keys`, indexes refer to positions in the submitted array. Unmatched sources have a `null` index.

### Error codes

The API's `error.code` becomes the `error-code` output. Errors detected by the Action use these codes:

| Code                        | Meaning                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `action_invalid_input`      | Missing, conflicting or invalid inputs.                    |
| `action_timeout`            | The request or response timed out.                         |
| `action_network_error`      | Connection, TLS or response-stream error.                  |
| `action_http_error`         | HTTP error without an API error code, including redirects. |
| `action_invalid_response`   | The response did not contain a valid send result.          |
| `action_delivery_failed`    | At least one target failed.                                |
| `action_no_targets`         | No receiving targets were resolved.                        |
| `action_response_too_large` | The response or output exceeded the size limit.            |
| `action_internal_error`     | The Action could not prepare the request.                  |

Requests are not retried and redirects are not followed. After a timeout, delivery may already have occurred; rerunning can send a duplicate. `collapse-id` does not deduplicate requests.

## Self-hosted runners

Use runner **2.327.1 or newer** on an operating system supported by Node.js 24.

For a proxy or custom CA, configure the environment as needed:

```yaml
      - uses: azurdream/meowpush-gh-actions@v1
        env:
          NODE_USE_ENV_PROXY: '1'
          HTTPS_PROXY: ${{ secrets.CI_HTTPS_PROXY }}
          NO_PROXY: localhost,127.0.0.1
          NODE_EXTRA_CA_CERTS: /etc/company/ca.pem
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          body: Build completed
```

The CA file must exist on the runner. HTTP endpoints can use `HTTP_PROXY`. See [Node's network configuration](https://nodejs.org/learn/http/enterprise-network-configuration).

## Secrets

Store the Application Push Key in GitHub Secrets and send it only to a trusted endpoint. HTTP endpoints do not encrypt the key or notification content.

Repository Secrets are normally unavailable to fork PRs and Dependabot workflows. Skip notification steps when the secret is unavailable; an empty key fails input validation. See [GitHub's secrets guidance](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [release instructions](docs/releasing.md) and the [security policy](SECURITY.md).

Licensed under [MIT](LICENSE).
