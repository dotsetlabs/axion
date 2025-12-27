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
dotset init
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
- **Project-Level RBAC** — Control access with Owner, Admin, Member, and Readonly roles
- **Environment Scopes** — Cryptographically isolated access for Development, Staging, and Production
- **Zero-Disk Architecture** — Secrets exist only in memory; keys are fetched dynamically based on scope
- **Tamper-Proof Audit** — SHA-256 hash chain audit logs covering all secret access
- **AES-256-GCM Encryption** — Industry-standard authenticated encryption
- **Secret Templating** — Reference secrets with `{{KEY}}` syntax
- **Cloud Sync** — Securely share secrets across your team with drift detection
- **Dynamic Key Injection** — `dotset run` fetches only the keys permitted for the current user and scope

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
- **Hadron** — Local CI runner
- **Lagrangian** — Instant crash replay

## License

MIT
