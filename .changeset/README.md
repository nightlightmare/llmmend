# Changesets

Run `pnpm changeset` in a PR to describe a user-facing change.

To release, open a PR that runs `pnpm changeset version`: it bumps `package.json`, writes `CHANGELOG.md` and removes the consumed changesets. When that PR is merged, `.github/workflows/release.yml` stages the new version on npm (Trusted Publishing), tags it and creates the GitHub release. The version goes live once a maintainer approves it with 2FA on npmjs.com or with `npm stage approve`. A version bot PR is not used, because PRs created with `GITHUB_TOKEN` do not run the required checks.
