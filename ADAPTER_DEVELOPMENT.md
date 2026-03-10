# Adapter Development Guide

This guide walks you through building a custom PagerMon ingest adapter from scratch.

By the end, you'll understand:

- What an adapter is and how it integrates with the core runtime
- The adapter contract and lifecycle
- Step-by-step implementation of a working adapter
- Three deployment approaches (npm dependency, Docker base, bare metal)

## What Is An Adapter?

An adapter is a plugin that reads messages from a specific source and emits them to PagerMon.

**Examples of adapter sources:**

- RTL-SDR radio receiver (built-in multimon adapter)
- SMTP inbox (email-to-pager gateway)
- HTTP/WebSocket API polling
- Serial port modem
- File system monitoring

**The adapter's job:**

1. Connect to your source
2. Parse source-specific data
3. Convert to normalized `Message` objects
4. Emit messages to the core runtime

**The core's job:**

- Queue messages reliably
- Submit to PagerMon API with retries
- Monitor health and manage lifecycle

This separation keeps source complexity isolated from shared runtime concerns.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Your Adapter Repository                                    │
│                                                              │
│  ┌────────────────────┐         ┌──────────────────┐       │
│  │   index.js         │────────>│  Adapter Class   │       │
│  │   (entrypoint)     │         │  (your logic)    │       │
│  └────────────────────┘         └──────────────────┘       │
│           │                                                  │
│           │ bootstrapWithAdapter()                          │
│           v                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  @pagermon/ingest-core (npm dependency)              │  │
│  │                                                       │  │
│  │  • Config parsing                                    │  │
│  │  • Queue management (Redis + BullMQ)                 │  │
│  │  • API client with retries                           │  │
│  │  • Worker + health monitor                           │  │
│  │  • Adapter lifecycle orchestration                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           v
                  ┌────────────────┐
                  │  PagerMon API  │
                  └────────────────┘
```

## Repository Split

The ingest service consists of two repository

- **Core repo** (This repository): shared runtime, maintained by PagerMon team
- **Your adapter repo**: source-specific logic, maintained by you

Your adapter depends on the core via npm (`npm install @pagermon/ingest-core`) or by extending a Docker image.

## Runtime Flow

Understanding the lifecycle helps you design your adapter correctly.

### Startup Sequence

1. **User starts your container/process**
2. **Your `index.js` calls `bootstrapWithAdapter(YourAdapter)`**
3. **Core validates environment config** (`INGEST_CORE__*`)
4. **Core initializes services:**
   - API client
   - Redis connection + queue
   - Health monitor Reference

Your adapter must export a **default class or constructor** with these methods:

### Required Methods

#### `getName(): string`

Return a stable identifier for logs and diagnostics.

```javascript
getName() {
  return 'my-custom-adapter';
}
```

#### `start(onMessage, onClose, onError): void`

Start producing messages.

**Parameters:**

- `onMessage(message)`: call this with each `Message` object
- `onClose()`: call when stream ends unexpectedly
- `onError(err)`: call for recoverable errors

**Your responsibilities:**

- Allocate resources (open sockets, spawn processes, etc.)
- Begin reading from source
- Call `onMessage()` for each parsed message
- Call `onError()` if source has issues but might recover
- Call `onClose()` if source disconnects/ends
- Store callbacks if you need them for async work

```javascript
start(onMessage, onClose, onError) {
  this.onMessage = onMessage;
  this.onClose = onClose;
  this.onError = onError;

  // Connect to your source
  this.connection = connectToSource();

  this.connection.on('data', (data) => {
    try {
      const message = this.parseData(data);
      this.onMessage(message);
    } catch (err) {
      this.onError(err);
    }
  });

  this.connection.on('close', () => {
    this.onClose();
  });
}
```

#### `stop(): void`

Clean up all resources.

\*\*YStep-by-Step: Build Your First Adapter

Let's build a simple HTTP polling adapter that fetches messages from a REST API.

### Step 1: Create Repository Structure

```bash
mkdir my-pagermon-adapter
cd my-pagermon-adapter
npm init -y
```

### Step 2: Install Core Dependency

```bash
npm install @pagermon/ingest-core
```

### Step 3: Create Adapter Class

Create `adapter/http-polling/adapter.js`:

```javascript
import Message from '@pagermon/ingest-core/lib/message/Message.js';

class HttpPollingAdapter {
  constructor(config = {}) {
    const adapterConfig = config.adapter || {};

    // Validate required config
    if (!adapterConfig.apiUrl) {
      throw new Error('INGEST_ADAPTER__API_URL is required');
    }

    this.apiUrl = adapterConfig.apiUrl;
    this.pollInterval = adapterConfig.pollInterval || 10000; // 10s default
    this.intervalHandle = null;
    this.running = false;
  }

  getName() {
    return 'http-polling';
  }

  start(onMessage, onClose, onError) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.running = true;

    console.log(`[HTTP-POLLING] Starting, polling ${this.apiUrl} every ${this.pollInterval}ms`);

    this.intervalHandle = setInterval(() => {
      this.poll();
    }, this.pollInterval);

    // Initial poll
    this.poll();
  }

  async poll() {
    if (!this.running) return;

    try {
      const response = await fetch(this.apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Assume API returns: { messages: [{address, text, format}] }
      for (const item of data.messages || []) {
        const message = new Message({
          address: item.address,
          message: item.text,
          format: item.format || 'alpha',
          source: 'http-polling',
        });

        this.onMessage(message);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  stop() {
    console.log('[HTTP-POLLING] Stopping');
    this.running = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  isRunning() {
    return this.running;
  }
}

export default HttpPollingAdapter;
```

### Step 4: Create Entrypoint

Create `index.js`:

```javascript
import { bootstrapWithAdapter } from '@pagermon/ingest-core/bootstrap.js';
import HttpPollingAdapter from './adapter/http-polling/adapter.js';

bootstrapWithAdapter(HttpPollingAdapter);
```

### Step 5: Configure Environment

Create `.env.example`:

```bash
# Core settings
INGEST_CORE__API_URL=http://pagermon:3000
INGEST_CORE__API_KEY=your_api_key_here
INGEST_CORE__REDIS_URL=redis://redis:6379
INGEST_CORE__LABEL=http-polling-adapter

# Adapter settings
INGEST_ADAPTER__API_URL=https://example.com/api/messages
INGEST_ADAPTER__POLL_INTERVAL=10000
```

### Step 6: Test Locally

```bash
cp .env.example .env
# Edit .env with real values
node index.js
```

**That's it!** You now have a working adapter

````

### Constructor
Every message your adapter emits must be a valid `Message` object.

### Import

```javascript
import Message from '@pagermon/ingest-core/lib/message/Message.js';
````

### Required Fields

| Field     | Type     | Description                             |
|-----------|----------|-----------------------------------------|
| `address` | `string` | Pager address/capcode                   |
| `message` | `string` | Message body (required for `alpha`)     |
| `format`  | `string` | `'alpha'` or `'numeric'`                |
| `source`  | `string` | Your adapter name (core overrides this) |

### Optional Fields

| Field       | Type     | Description              |
|-------------|----------|--------------------------|
| `timestamp` | `number` | Unix timestamp (seconds) |
| `time`      | `string` | ISO8601 datetime string  |

### Creating Messages

````javascript
// Alpha message
const alphaMsg = new Message({
  address: '1234567',
  message: 'Emergency alert: Fire at Main St',
  format: 'alpha',
  sDeployment Options

You have three ways to deploy your adapter. Choose based on your environment and requirements.

---

### Option 1: Custom Image with npm Dependency

**Best for:** Production deployments, CI/CD pipelines

Build a container image that installs your adapter and its dependencies.

#### Dockerfile

```dockerfile
FROM node:24-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (includes @pagermon/ingest-core)
RUN npm ci --only=production

# Copy adapter code
COPY . .

# Run adapter entrypoint
CMD ["node", "index.js"]
````

#### Build and Run

```bash
docker build -t my-org/pagermon-adapter-http:latest .

docker run -d \
  --name pagermon-ingest \
  --env-file .env \
  my-org/pagermon-adapter-http:latest
```

#### Full Stack with Compose

`compose.yml`:

```yaml
services:
  ingest:
    image: my-org/pagermon-adapter-http:latest
    restart: unless-stopped
    env_file:
      - stack.env
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:8-alpine
    restart: unless-stopped
    command:
      - redis-server
      - --appendonly
      - yes
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s

volumes:
  redis-data:
```

Start stack:

```bash
docker compose up -d
```

---

### Option 2: Custom Image with Dockerfile Base

**Best for:** Extending existing adapter images, reusing core image layers

Derive from a published core image or another adapter.

#### Dockerfile

If a core base image existed:

```dockerfile
FROM shutterfire/pagermon-ingest-core:latest

WORKDIR /app

# Copy your adapter
COPY adapter/ ./adapter/
COPY index.js ./

CMD ["node", "index.js"]
```

Or extend multimon adapter:

```dockerfile
FROM shutterfire/ingest-multimon:latest

# Add your custom overlay adapter
COPY adapter/custom-overlay/ /opt/pagermon-adapter/

# Override entrypoint if needed
CMD ["node", "/app/index.js"]
```

**Note:** Currently, `@pagermon/ingest-core` does not publish a standalone base image. This option is most useful for:

- Extending adapters (multimon → add custom parser)
- Organizational base images

---

### Option 3: Bare Metal with npm Dependency

**Best for:** Development, testing, non-containerized environments

Run directly on your host with Node.js installed.

#### Setup

```bash
# Clone your adapter repo
git clone https://github.com/you/my-adapter.git
cd my-adapter

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env

# Start adapter
npm start
```

`package.json` should include:

```json
{
  "name": "my-pagermon-adapter",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@pagermon/ingest-core": "^1.0.0"
  }
}
```

#### Requirements

- Node.js >= 22.0.0
- Redis server running locally or accessible via network
- PagerMon server accessible

#### Running Redis Locally

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:8-alpine
```

Then set in `.env`:

```bash
INGEST_CORE__REDIS_URL=redis://localhost:6379
```

---

## Configuration Reference

### Core Settings (`INGEST_CORE__*`)

Your adapter receives core config automatically. You typically don't need to handle these.

| Variable                                  | Required | Default              | Description                |
|-------------------------------------------|----------|----------------------|----------------------------|
| `INGEST_CORE__API_URL`                    | Yes      | _(none)_             | PagerMon server URL        |
| `INGEST_CORE__API_KEY`                    | Yes      | _(none)_             | API key from PagerMon      |
| `INGEST_CORE__LABEL`                      | No       | `pagermon-ingest`    | Source label for messages  |
| `INGEST_CORE__REDIS_URL`                  | No       | `redis://redis:6379` | Redis connection URL       |
| `INGEST_CORE__ENABLE_DLQ`                 | No       | `true`               | Enable dead-letter queue   |
| `INGEST_CORE__HEALTH_CHECK_INTERVAL`      | No       | `10000`              | Health check interval (ms) |
| `INGEST_CORE__HEALTH_UNHEALTHY_THRESHOLD` | No       | `3`                  | Failures before unhealthy  |

### Adapter Settings (`INGEST_ADAPTER__*`)

Define your adapter-specific settings. Core passes these to your constructor as `config.adapter`.

**Naming convention:**

```bash
INGEST_ADAPTER__<KEY>=<value>
INGEST_ADAPTER__<NAMESPACE>__<KEY>=<value>
```

**Mapping to config object:**

```bash
# Flat
INGEST_ADAPTER__API_URL=http://example.com
→ config.adapter.apiUrl

# Nested
INGEST_ADAPTER__SMTP__HOST=smtp.example.com
INGEST_ADAPTER__SMTP__PORT=587
→ config.adapter.smtp.host
→ config.adapter.smtp.port
```

**Best practices:**

- Document all adapter settings in your README
- Provide `.env.example` with comments
- Validate required settings in constructor
- Use sensible defaults for optional settings

---

## Repository Layout

Recommended structure for adapter repositories:

```text
my-pagermon-adapter/
├── adapter/
│   └── my-adapter/
│       ├── adapter.js          # Main adapter class
│       ├── parser.js           # Optional: parsing logic
│       └── client.js           # Optional: source client
├── test/
│   ├── unit/
│   │   └── adapter.test.js     # Unit tests
│   └── integration/
│       └── e2e.test.js         # Integration tests
├── .env.example                # Example configuration
├── compose.yml                 # Docker Compose stack
├── Dockerfile                  # Container build
├── index.js                    # Entrypoint (bootstrap call)
├── package.json                # Dependencies
└── README.md                   # User documentation
```

---

## Testing Your Adapter

### Unit Tests

Test adapter logic in isolation using mocks.

`test/unit/adapter.test.js`:

```javascript
import { describe, expect, it, vi } from 'vitest';
import HttpPollingAdapter from '../../adapter/http-polling/adapter.js';

describe('HttpPollingAdapter', () => {
  it('validates required config', () => {
    expect(() => {
      new HttpPollingAdapter({});
    }).toThrow('INGEST_ADAPTER__API_URL is required');
  });

  it('starts polling and emits messages', async () => {
    const adapter = new HttpPollingAdapter({
      adapter: {
        apiUrl: 'http://test.local/api',
        pollInterval: 100,
      },
    });

    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    adapter.start(onMessage, onClose, onError);

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(onMessage).toHaveBeenCalled();

    adapter.stop();
  });
});
```

### Integration Tests

Test your adapter with real dependencies if possible.

```javascript
it('fetches messages from live API', async () => {
  const adapter = new HttpPollingAdapter({
    adapter: {
      apiUrl: process.env.TEST_API_URL,
    },
  });

  const messages = [];
  const onMessage = (msg) => messages.push(msg);

  adapter.start(onMessage, vi.fn(), vi.fn());

  await new Promise((resolve) => setTimeout(resolve, 2000));

  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0].address).toBeDefined();

  adapter.stop();
});
```

---

## Advanced Topics

### Child Process Management

If your adapter spawns subprocesses (like multimon adapter):

```javascript
import { spawn } from 'child_process';

class MyAdapter {
  start(onMessage, onClose, onError) {
    this.process = spawn('my-decoder', ['--flag']);

    this.process.stdout.on('data', (chunk) => {
      // Parse and emit messages
    });

    this.process.on('error', (err) => {
      onError(err);
    });

    this.process.on('exit', (code) => {
      if (code !== 0) {
        onClose();
      }
    });
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}
```

### Stream Processing

For continuous streams (TCP, WebSocket):

```javascript
import { createConnection } from 'net';

class TcpStreamAdapter {
  start(onMessage, onClose, onError) {
    this.socket = createConnection({
      host: this.config.host,
      port: this.config.port,
    });

    this.socket.on('connect', () => {
      console.log('Connected to source');
    });

    this.socket.on('data', (chunk) => {
      const messages = this.parseChunk(chunk);
      messages.forEach((msg) => onMessage(msg));
    });

    this.socket.on('error', (err) => {
      onError(err);
    });

    this.socket.on('close', () => {
      onClose();
    });
  }

  stop() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
```

### Polling with Backoff

Implement exponential backoff for API polling:

```javascript
class SmartPollingAdapter {
  constructor(config) {
    this.baseInterval = config.adapter.pollInterval || 5000;
    this.maxInterval = 60000;
    this.currentInterval = this.baseInterval;
    this.consecutiveErrors = 0;
  }

  async poll() {
    try {
      const data = await this.fetchData();
      this.consecutiveErrors = 0;
      this.currentInterval = this.baseInterval;

      data.forEach((item) => this.onMessage(this.parseItem(item)));
    } catch (err) {
      this.consecutiveErrors++;
      this.currentInterval = Math.min(this.baseInterval * Math.pow(2, this.consecutiveErrors), this.maxInterval);
      this.onError(err);
    }

    if (this.running) {
      this.timeoutHandle = setTimeout(() => this.poll(), this.currentInterval);
    }
  }
}
```

---

## Publishing Your Adapter

### Docker Hub

```bash
# Build
docker build -t your-org/pagermon-adapter-custom:latest .

# Tag version
docker tag your-org/pagermon-adapter-custom:latest \
           your-org/pagermon-adapter-custom:1.0.0

# Push
docker push your-org/pagermon-adapter-custom:latest
docker push your-org/pagermon-adapter-custom:1.0.0
```

### GitHub Container Registry

```bash
docker tag your-org/pagermon-adapter-custom:latest \
           ghcr.io/your-org/pagermon-adapter-custom:latest

docker push ghcr.io/your-org/pagermon-adapter-custom:latest
```

### npm Package (Optional)

If you want others to extend your adapter:

```bash
npm publish
```

Users can then:

```bash
npm install your-adapter-package
```

---

## Getting Help

- **Core issues**: [eopo/ingest-core](https://github.com/eopo/ingest-core/issues)
- **Multimon adapter**: [eopo/ingest-adapter-multimon](https://github.com/eopo/ingest-adapter-multimon/issues)
- **Community**: PagerMon Discord/Slack

When asking for help, include:

- Adapter source type (HTTP, SMTP, custom hardware, etc.)
- Deployment method (Docker, bare metal)
- Relevant logs
- Configuration (redact sensitive values)
  console.error('Invalid message:', err.message);
  }

````

Validation rules:

- `address` must be non-empty string
- `format` must be `'alpha'` or `'numeric'`
- For `alpha`: `message` must be non-empty
- For `numeric`: `message` is optionalnrecoverable initialization errors

**When to call `onError()`:**

- Transient source failures (network timeout, parse error)
- Recoverable issues that don't terminate the stream

**When to call `onClose()`:**

- Source connection closes unexpectedly
- Source signals end-of-stream

**Example:**

```javascript
this.source.on('error', (err) => {
  if (err.code === 'ETIMEDOUT') {
    // Transient, might recover
    this.onError(err);
  } else {
    // Permanent failure
    this.onClose();
  }
});
````

1. Core calls `adapter.stop()`
2. Your adapter closes connections, stops streams, kills child processes
3. Core stops worker
4. Core closes Redis connection
5. Core exits gracefully

**Your responsibility:** Clean up resources in `stop()` so no leaks occur.

## Adapter Contract

Your adapter must export a default class or constructor function that creates an object implementing:

Required methods:

- `getName()`
- `start(onMessage, onClose, onError)`
- `stop()`
- `isRunning()`

Emit `Message` objects from:

- `@pagermon/ingest-core/lib/message/Message.js`

Contract semantics:

- `getName()` should return a stable identifier for logging/diagnostics.
- `start(...)` should allocate resources and begin producing messages.
- `stop()` must clean up timers, sockets, streams, child processes, and listeners.
- `isRunning()` should reflect actual adapter state, not only a static flag.

Error handling expectations:

- Call `onError(err)` for recoverable or stream-level failures.
- Call `onClose()` when the message stream ends unexpectedly.
- Throw from constructor for invalid mandatory adapter config.

## Configuration Model

Core config keys use `INGEST_CORE__*`.

Adapter config keys use `INGEST_ADAPTER__*` and are passed to adapters as:

- `this.config.adapter` (structured object)
- `this.config.rawEnv` (raw env map)

Example env:

```bash
INGEST_CORE__API_KEY=your_api_key
INGEST_ADAPTER__FREQUENCIES=163000000
INGEST_ADAPTER__PROTOCOLS=POCSAG512
INGEST_ADAPTER__SMTP__HOST=smtp.example.org
```

In adapter code:

```javascript
const adapterConfig = this.config.adapter || {};
const smtp = adapterConfig.smtp || {};
```

Recommended approach:

- Read all adapter-specific settings from `this.config.adapter`.
- Keep `this.config.rawEnv` only as fallback/debug aid.
- Validate required adapter settings early (constructor or startup).

## Message Requirements

Create and emit valid `Message` objects.

Minimum practical fields for PagerMon ingestion:

- `address`
- `format` (`alpha` or `numeric`)
- `source`

For `alpha`, provide a non-empty `message` string.

Example:

```javascript
import Message from '@pagermon/ingest-core/lib/message/Message.js';

onMessage(
  new Message({
    address: '123456',
    message: 'Test page',
    format: 'alpha',
    source: 'my-adapter',
  })
);
```

## Minimal Adapter Repo Layout

```text
adapter-repo/
  index.js
  Dockerfile
  package.json
  adapter/
    <your-adapter>/
  test/
    unit/
    integration/
```

Suggested files:

- `index.js`: bootstrap entry
- `adapter/<name>/adapter.js`: adapter class
- optional helper modules (parsers, transport clients, subprocess wrappers)
- adapter-owned tests (unit + integration)

## Testing Guidance

Adapter repos should own adapter-specific tests, especially:

- parser/normalization unit tests
- startup/shutdown lifecycle tests
- failure-path tests (`onError`, `onClose`)
- hardware/source integration tests where applicable

Core repository tests only validate core runtime behavior and adapter contract loading.
