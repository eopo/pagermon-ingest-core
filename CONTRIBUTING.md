# Contributing to Pagermon Ingest

This document describes the expected workflow for contributions to `ingest/`.

Related documents:

- End-user setup and operations: [README.md](./README.md)
- Custom adapter implementation details: [ADAPTER_DEVELOPMENT.md](./ADAPTER_DEVELOPMENT.md)

## How This Repo Fits

`ingest/` is the shared core runtime (`@pagermon/ingest-core`).

It owns reusable behavior:

- config parsing and validation
- adapter loading and orchestration
- queue, worker, API client, and health monitor

It does not own source-specific receiver/decoder logic. That lives in adapter repositories.

## Scope

Use this guide for:

- Bug fixes
- Feature changes
- Test improvements
- Core runtime improvements in this repository

For custom adapter authoring details, see [ADAPTER_DEVELOPMENT.md](./ADAPTER_DEVELOPMENT.md).

Use this decision rule before changing code:

- change `ingest/` when the behavior should apply to all adapters
- change adapter repo when behavior is specific to one source implementation

## Repository Layout

Key paths:

- `index.js`: loader-mode startup path
- `bootstrap.js`: bootstrap API used by adapter repos
- `lib/config.js`: env parsing/validation
- `lib/core/`: queue/API/worker/health services
- `lib/runtime/`: adapter loading and runtime lifecycle
- `lib/message/Message.js`: shared normalized message model
- `test/unit/`, `test/integration/`: core runtime tests

## Development Workflow

1. Install dependencies:

```bash
npm ci
```

2. Run quality checks before opening a PR:

```bash
npm run lint
npm test
```

3. If you change formatting-sensitive files, verify formatting:

```bash
npm run format:check
```

4. Keep documentation in sync for behavioral changes:

- update `README.md` for user-facing runtime behavior
- update `ADAPTER_DEVELOPMENT.md` for adapter contract/config changes

## Test Expectations

- Add tests for happy path and negative path behavior.
- Prefer deterministic tests over timing-sensitive tests.
- Keep core runtime tests under `test/unit/` and `test/integration/`.
- Keep adapter-specific tests in the adapter repository.

Core test focus by layer:

- `lib/config.js`: parsing, defaults, validation failures
- `lib/runtime/*`: startup, shutdown, error propagation, adapter contract checks
- `lib/core/*`: queue/API/worker behavior and failure handling

### Logger Conventions

Contributions that touch adapter startup/config should follow the current logger contract:

- Core provides a ready-to-use logger via `config.logger`.
- Adapters create their own scoped children via `config.logger.child({...})`.
- Do not re-introduce adapter-specific logger helpers in adapter config.

For tests, use the central helper from `@pagermon/ingest-core/testing`, which is made available via `test/helpers/index.js`:

- `createMockLogger(vi)` for spy-enabled logger assertions.
- `createMockLogger()` (or `createMockLogger(null)`) for no-op logger behavior.

Avoid ad-hoc inline noop logger objects in new tests unless there is a strong reason.

### Adapter Contract Validation Test

The core includes adapter loader contract checks in `test/unit/adapter-loader.test.js`.

Adapter repositories should own hardware/integration decode tests.

## Dependency Updates and Releases

Dependabot opens grouped update PRs every Monday at 03:00 UTC. The commit type decides whether release-please cuts a release:

- runtime dependencies (`deps(app)`) and Docker base images (`deps(docker)`) are user-facing and trigger a patch release
- devDependencies (`chore(deps-dev)`) and GitHub Actions (`ci`) are hidden from the changelog and do not trigger a release

CI builds and smoke-tests the Docker image natively on amd64 and arm64 with the same actions as the release workflow, runs the tests on the image's Node.js major, and lints the PR title (the squash commit message).

`dependabot-automerge.yml` enables auto-merge (squash, after the required `CI Gate` check passes) for:

- semver-minor and semver-patch updates of npm packages and GitHub Actions
- majors of devDependencies and of the `actions-ci` group, because CI exercises everything they affect

Runtime majors (raised as individual PRs), majors of release-only actions (`actions-release` group), and Docker base images need a manual review.

`release-train.yml` merges the pending release PR every Monday at 06:00 UTC (or on a manual run), once no other auto-merge PR is in flight, so everything merged since the last release ships together.

On release, `publish-npm.yml` packs the package once, attaches the tarball to the GitHub release, publishes the same tarball to npm, and dispatches `core-updated` to the multimon adapter. The adapter installs core from the release asset (npm resolves a new version only minutes after publishing), keeps a plain version in `package.json`, and opens a `deps(core)` PR with auto-merge. A core update makes the adapter's release train release immediately, bundled with any adapter update PRs still in flight.

## PR Quality Bar

A good PR in this repo is:

- small enough to review quickly
- covered by focused tests
- explicit about failure behavior and shutdown behavior
- documented when interfaces/configs change

## Pull Request Checklist

- Change is scoped and documented.
- New behavior has tests.
- Existing tests still pass.
- Lint passes with no warnings introduced.
- README/ADAPTER_DEVELOPMENT docs updated when behavior changes.
