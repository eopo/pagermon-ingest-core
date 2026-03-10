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

### Adapter Contract Validation Test

The core includes adapter loader contract checks in `test/unit/adapter-loader.test.js`.

Adapter repositories should own hardware/integration decode tests.

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
