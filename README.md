# @pagermon/ingest-core

[![npm version](https://img.shields.io/npm/v/%40pagermon%2Fingest-core.svg)](https://www.npmjs.com/package/@pagermon/ingest-core)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/eopo/pagermon-ingest-core.svg)](LICENSE)
[![CI Status](https://img.shields.io/github/actions/workflow/status/eopo/pagermon-ingest-core/ci.yml?branch=main&label=CI)](https://github.com/eopo/pagermon-ingest-core/actions)

Shared ingest core runtime for PagerMon.

---

> **Looking to run PagerMon Ingest with RTL-SDR?**  
> You probably want the [multimon adapter repository](https://github.com/eopo/pagermon-ingest-adapter-multimon) instead.  
> This repository is the shared core runtime library and is only relevant if you're developing custom adapters or contributing to the core.

---

## What This Is

This repository contains the stable core pipeline shared by all PagerMon ingest adapters:

- config parsing and validation
- queue and worker processing
- API client and health monitor
- adapter orchestration and lifecycle management

It does **not** contain a concrete source adapter implementation (RTL-SDR, SMTP, etc.).

## Who This Is For

- **Adapter developers**: building custom ingest sources
- **Core contributors**: improving shared runtime behavior
- **Not for**: end users who just want to run a ready-made adapter

If you just want to run PagerMon Ingest with RTL-SDR hardware, use a concrete adapter repository instead of this one.

## Architecture At A Glance

`@pagermon/ingest-core` separates reusable runtime concerns from source-specific logic.

- Core runtime responsibilities:
  - read and validate config
  - initialize queue/API/health/worker services
  - start an adapter and consume emitted messages
  - enqueue normalized messages for API delivery
- Adapter responsibilities (in adapter repo):
  - read from a concrete source (SDR, SMTP, polling, etc.)
  - parse source-specific payloads
  - emit normalized `Message` objects

This split keeps source integration complexity out of the core and allows multiple adapter repos to share one stable runtime.

## Runtime Flow

On startup, the core follows this sequence:

1. Validate `INGEST_CORE__*` configuration.
2. Initialize API client, queue manager, health monitor, and worker.
3. Load/create adapter instance.
4. Start adapter stream processing.
5. For each emitted message:
   - set source label
   - enqueue message
   - worker submits to PagerMon API
6. On signal/error: stop adapter pipeline and core services gracefully.

This behavior is orchestrated in `lib/runtime/service.js` and `lib/runtime/pipeline.js`.

## Repository Structure

Important paths in this repository:

- `index.js`: default entrypoint (loader mode)
- `bootstrap.js`: bootstrap API used by adapter repos
- `lib/config.js`: env parsing and validation
- `lib/core/`: queue, API, worker, health services
- `lib/runtime/`: adapter loader and runtime orchestration
- `lib/message/Message.js`: shared normalized message model
- `test/unit/`, `test/integration/`: core runtime tests

## Adapter Convention

A concrete adapter image must provide this module:

- `/app/adapter/adapter.js`

The core loads that module at startup and validates the runtime adapter contract (`getName`, `start`, `stop`, `isRunning`).

## Configuration Prefixes

- Core: `INGEST_CORE__*`
- Adapter: `INGEST_ADAPTER__*`

The core forwards adapter keys as structured config (`adapter`) and raw env map (`rawEnv`) to the selected adapter.

Example mapping:

- Env: `INGEST_ADAPTER__SMTP__HOST=smtp.example.org`
- In adapter: `this.config.adapter.smtp.host === 'smtp.example.org'`
- Raw fallback: `this.config.rawEnv.INGEST_ADAPTER__SMTP__HOST`

## Runtime Modes

`@pagermon/ingest-core` supports two startup modes:

- Default loader mode: `node index.js`
- Bootstrap mode: adapter repo entrypoint calls `bootstrapWithAdapter(AdapterClass)`

Default loader mode expects an adapter entry module at `/app/adapter/adapter.js`
(override with `INGEST_CORE__ADAPTER_ENTRY`).

Bootstrap mode lets adapter repos pass the adapter class directly and avoids path conventions.

Use loader mode when your container layout already provides `/app/adapter/adapter.js`.
Use bootstrap mode when your adapter repo wants explicit startup control in code.

## Development

```bash
npm ci
npm run check
npm test
```

## Container

### Pre-built Images

Pre-built images are available from two registries:

- **Docker Hub**: `shutterfire/pagermon-ingest-core`
- **GitHub Container Registry**: `ghcr.io/eopo/pagermon-ingest-core`

Both registries contain identical images. Choose based on your preference:

```bash
# Docker Hub
docker pull shutterfire/pagermon-ingest-core:latest

# Or GitHub Container Registry
docker pull ghcr.io/eopo/pagermon-ingest-core:latest
```

### Building Locally

Build core image:

```bash
docker build -t shutterfire/pagermon-ingest-core:latest .
```

## Using Ingest with PagerMon Server

Ingest sends messages to PagerMon server API endpoint `INGEST_CORE__API_URL`.

If both services run in one compose project, set:

```bash
INGEST_CORE__API_URL=http://pagermon:3000
```

Where `pagermon` is the server service name.

## Developing Your Own Adapter

You can always build your own adapter to support other sources, such as PDW, incoming emails, polling from websites and so on.

- Full adapter contract and implementation guide: [ADAPTER_DEVELOPMENT.md](./ADAPTER_DEVELOPMENT.md)

Rule of thumb:

- change this repo when runtime behavior should be shared by all adapters
- change adapter repo when behavior is source-specific

If you only need to run Ingest, you can ignore this section.

## Contribution

If you plan to change code in this repository, use [CONTRIBUTING.md](./CONTRIBUTING.md) as the primary guide.

Quick local quality check:

```bash
npm run lint
npm test
```

Detailed testing conventions and adapter integration test behavior are documented in
[CONTRIBUTING.md](./CONTRIBUTING.md).
