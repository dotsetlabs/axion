# @dotsetlabs/axion

**Secrets Module for the dotset Platform.**  
Zero-disk encrypted secrets injected directly into process memory.

[![npm version](https://img.shields.io/npm/v/@dotsetlabs/axion)](https://www.npmjs.com/package/@dotsetlabs/axion)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Installation

### CLI Usage

Install the unified CLI to use Axion via command line:

```bash
npm install -g @dotsetlabs/cli
```

### SDK Usage

Install the SDK package for programmatic access:

```bash
npm install @dotsetlabs/axion
```

## Quick Start

### With CLI

```bash
dotset init --axion
dotset secrets set API_KEY "sk-..."
dotset run -- npm start
```

### With SDK

```typescript
import { loadSecrets, getSecret } from '@dotsetlabs/axion/sdk';

// Load all secrets into process.env
await loadSecrets({ scope: 'production' });

// Or access directly
const apiKey = await getSecret('API_KEY', { scope: 'production' });
```

## Features

- **Zero-Disk Architecture** — Secrets exist only in memory at runtime
- **AES-256-GCM Encryption** — Industry-standard authenticated encryption
- **Argon2id Key Derivation** — OWASP-recommended memory-hard KDF
- **Secret Templating** — Reference secrets with `{{KEY}}` syntax
- **Cloud Sync** — Securely share secrets across your team
- **Scope Support** — Separate development, staging, and production

## SDK Exports

```typescript
// Main SDK
import { loadSecrets, getSecret, getSecrets, createClient } from '@dotsetlabs/axion/sdk';

// Low-level modules
import { ManifestManager } from '@dotsetlabs/axion/manifest';
import { encrypt, decrypt } from '@dotsetlabs/axion/crypto';
import { parseEnvFile } from '@dotsetlabs/axion/parser';
```

## Documentation

Full documentation: [docs.dotsetlabs.com/axion](https://docs.dotsetlabs.com/axion/quickstart)

## Part of the dotset Platform

Axion is the Secrets module of the dotset developer platform:
- **Axion** — Zero-disk encrypted secrets *(this package)*
- **Gluon** — Runtime security telemetry
- **Tachyon** — Zero-trust dev tunnels

## License

MIT
