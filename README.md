# @dotsetlabs/axion

**The Zero-Disk Secret Plane.**  
Stop syncing `.env` files. Stream encrypted secrets directly to your app's memory.

[![npm version](https://img.shields.io/npm/v/@dotsetlabs/axion)](https://www.npmjs.com/package/@dotsetlabs/axion)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Documentation

Full documentation is available at [docs.dotsetlabs.com](https://docs.dotsetlabs.com/axion/quickstart).

## Features

- **Zero-Disk Architecture** — Secrets are injected into `process.env` at runtime. No `.env` files on disk.
- **End-to-End Encryption** — Secrets are encrypted using AES-256-GCM before reaching the cloud.
- **Native SDK** — Use the SDK for serverless and programmatic access.
- **Secret Templating** — Reference secrets inside other secrets with `{{KEY}}` syntax.
- **Cloud Sync** — Securely share secrets with your team.

## Quick Start

```bash
npm install -g @dotsetlabs/axion

# Initialize local manifest
axn init

# Set a secret
axn set DATABASE_URL "postgres://localhost/db"

# Run your app
axn run -- npm start
```

## Security

Axion employs a client-side zero-knowledge architecture with industry-standard cryptography. For more details, see our [Security Documentation](https://docs.dotsetlabs.com/axion/security).

## License

MIT
