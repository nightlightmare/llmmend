# Changesets

Run `pnpm changeset` in a PR to describe a user-facing change.

To release, open a PR that runs `pnpm changeset version`: it bumps `package.json`, writes `CHANGELOG.md` and removes the consumed changesets. When that PR is merged, `.github/workflows/release.yml` publishes the new version to npm (Trusted Publishing, with provenance), tags it and creates the GitHub release. A version bot PR is not used, because PRs created with `GITHUB_TOKEN` do not run the required checks.
