# Releasing

## Prepare

1. Choose a SemVer version. Breaking changes to inputs, outputs, success rules or runtime requirements need a major version; compatible additions use a minor version and fixes use a patch version.
2. Update `package.json` and the lockfile, then run:

   ```sh
   npm ci
   npm run build
   npm run check
   npm run test:fixtures
   ```

3. Include the source, generated `dist` files and dependency license notices in the release commit.
4. Require passing GitHub CI for that revision on Linux, Windows and macOS, for both x64 and arm64.
5. Write release notes covering changes, compatibility and validation.

## Publish

Create a full version tag such as `v1.0.0` and a GitHub Release from the validated revision. Enable immutable releases where available; never move a published full-version tag.

Point the floating `v1` tag to the same revision. This alias follows compatible updates and must remain movable, so do not attach an immutable release to it. Verify that both tags contain `action.yml` and the complete `dist` package.

For Marketplace publication, check the Action name, branding, license and current [Marketplace requirements](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace). Enable private vulnerability reporting and verify the reporting route in `SECURITY.md`.

See GitHub's [immutable releases and tags guidance](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases).

## Version references and recovery

- `@v1` follows compatible v1 releases.
- `@v1.0.0` selects an exact release tag.
- `@<full commit SHA>` pins a specific revision.

If a release regresses, move `v1` to a known good version and publish a corrected patch release. Consumers pinned to a version or commit must update their reference. Document the affected versions and fix in the release notes.
