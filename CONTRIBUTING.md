# Contributing

Use Node.js 24 and npm:

```sh
npm ci
npm run build
npm run check
npm run test:fixtures
```

Run `npm run format` to format changes. Rebuild after editing source or runtime dependencies, and include the updated `dist` files: GitHub runs the bundled Action directly.

## Tests and code changes

- Keep metadata, tests, both READMEs and the [design document](docs/design/github-action.md) aligned.
- Test changed behavior, including failure outputs and credential handling.
- Use local HTTP mocks and fake keys. Tests and CI must not send real notifications.
- Preserve message whitespace, JSON numeric precision, omitted fields and zero values.
- Keep runtime code portable across Linux, Windows and macOS.
- Include applicable dependency license notices in the distribution.

`npm run check` checks JavaScript, formatting, metadata, tests and distribution consistency. `npm run test:fixtures` exercises the bundle against the CI mock server. The GitHub workflow runs actual `uses: ./` steps on six OS/architecture combinations and checks outputs and `continue-on-error` behavior.

## Pull requests and releases

Describe the behavior change and how it was tested. Record substantial design changes under `docs/design/`. Use English Conventional Commit messages.

Follow the [release procedure](docs/releasing.md) for versioning and publication. Report vulnerabilities through the channels in [SECURITY.md](SECURITY.md).
