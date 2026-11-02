# Security policy

## Report a vulnerability

Use **Security → Report a vulnerability** when available. Otherwise, use a private contact method listed on a maintainer's GitHub profile. Include the affected version, runner platform and reproduction steps using fake credentials. Do not put keys, private notification content or exploit details in a public issue.

If a key has leaked, reset it in MeowPush and update the GitHub Secret.

## Handling credentials

- Create a dedicated MeowPush application and store its Application Push Key in GitHub Secrets.
- Send only to a trusted endpoint. HTTP does not encrypt the key or notification content.
- The Action masks keys and removes them from outputs. Avoid printing secrets in other steps.
- Pass outputs to shell scripts through environment variables rather than inserting them directly into script text.
- Do not expose trusted secrets to untrusted pull-request code.

Security fixes are released for the latest major version. Update pinned versions or commit SHAs when a fix is published.
