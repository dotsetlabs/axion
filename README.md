# @dotsetlabs/axion

**The Zero-Disk Secret Plane.**  
Stop syncing `.env` files. Stream encrypted secrets directly to your app's memory.

[![npm version](https://img.shields.io/npm/v/@dotsetlabs/axion)](https://www.npmjs.com/package/@dotsetlabs/axion)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- **Zero-Disk Architecture** — Secrets are injected into `process.env` at runtime. No `.env` files on disk.
- **End-to-End Encryption** — Secrets are encrypted using AES-256-GCM before reaching the cloud.
- **SSO Authentication** — Sign in with GitHub or Google. No passwords to remember.
- **Team Collaboration** — Invite team members and control access with role-based permissions.
- **CI/CD Ready** — Headless authentication via `AXION_TOKEN` for your pipelines.
- **Audit Logs** — Track every access and change with `axn audit`.
- **Secret Drift Detection** — Identify discrepancies between local and cloud with `axn drift`.
- **Version History** — View history and rollback to previous versions.
- **Key Rotation** — Rotate encryption keys with automatic re-encryption.

## Quick Start

### 1. Install the CLI

```bash
npm install -g @dotsetlabs/axion
```

Or use directly with npx:
```bash
npx @dotsetlabs/axion run -- npm start
```

### 2. Sign in with SSO

```bash
axn login          # GitHub (default)
axn login --google # Google
```

The CLI uses OAuth Device Code Flow — you'll see a code to enter in your browser.

### 3. Initialize a project

```bash
axn init --cloud --name "my-project"
```

This automatically:
- Creates an encrypted vault for your secrets
- Discovers existing `.env` files in your project
- Creates `.axion/sync.yaml` to track them
- Links to Axion Cloud

### 4. Add secrets

**Import from existing .env files:**
```bash
axn sync
```

**Or add secrets manually:**
```bash
axn set DATABASE_URL "postgres://..."
axn set API_KEY "sk-12345" --scope production
```

### 5. Run your app with secrets

```bash
axn run -- npm start
axn run --scope production -- node dist/index.js
```

Axion fetches encrypted secrets, decrypts them in memory, and spawns your process with them injected into `process.env`.

## Deployment (CI/CD)

### On Render / Vercel / Railway / Heroku

1. **Create a Service Token** in the [Axion dashboard](https://dotsetlabs.com/axion) under your project settings.

2. **Set the environment variable** in your cloud provider:
   ```
   AXION_TOKEN=vpt_xxxxxxxxxxxxx
   ```

3. **Update your start command**:
   ```bash
   npx @dotsetlabs/axion run --scope production -- node dist/index.js
   ```

## Commands

### Core Commands

| Command | Description |
|:--------|:------------|
| `axn init` | Initialize a new project |
| `axn set <key> <value>` | Set a secret variable |
| `axn get <key>` | Get a secret variable |
| `axn rm <key>` | Remove a secret variable |
| `axn list` / `axn ls` | List all variables |
| `axn run -- <cmd>` | Run command with secrets injected |
| `axn export` | Export secrets (escape hatch) |

### Cloud Sync

| Command | Description |
|:--------|:------------|
| `axn sync` | Sync .env files with cloud |
| `axn sync <file>` | Sync a specific .env file |
| `axn sync --push` | Force push local to cloud |
| `axn sync --pull` | Force pull from cloud |
| `axn drift` | Detect differences between local and cloud |
| `axn push` | Push manifest to cloud |

### Version Control

| Command | Description |
|:--------|:------------|
| `axn history` | View version history |
| `axn rollback <version>` | Rollback to a previous version |

### Authentication & Account

| Command | Description |
|:--------|:------------|
| `axn login` | Sign in with GitHub |
| `axn login --google` | Sign in with Google |
| `axn logout` | Sign out and clear credentials |
| `axn whoami` | Show current user and linked project |

### Project Management

| Command | Description |
|:--------|:------------|
| `axn link <project-id>` | Link to an existing cloud project |
| `axn unlink` | Disconnect from cloud |
| `axn destroy` | Delete a project (owner only) |

### Team Management

| Command | Description |
|:--------|:------------|
| `axn members list` | List project members |
| `axn members add <email>` | Invite a team member |
| `axn members revoke <user-id>` | Revoke access |
| `axn audit` | View access audit logs |

### Service Tokens (CI/CD)

| Command | Description |
|:--------|:------------|
| `axn tokens create` | Create a new service token |
| `axn tokens list` | List all tokens |
| `axn tokens revoke <id>` | Revoke a token |

### Key Management

| Command | Description |
|:--------|:------------|
| `axn key` | Show key fingerprint |
| `axn key --show` | Reveal the actual key |
| `axn rotate` | Rotate encryption key |
| `axn recovery setup` | Create a recovery blob |
| `axn recovery restore` | Restore key from recovery blob |

### Global Options

| Option | Description |
|:-------|:------------|
| `-s, --service <name>` | Scope operations to a specific service |
| `--scope <env>` | Environment scope: `development`, `staging`, `production` |
| `--reveal` | Show actual secret values instead of masked |
| `--force` | Skip confirmation prompts |

## Syncing .env Files

Axion auto-discovers and syncs your .env files:

```bash
# Discover .env files in your project
axn sync --discover

# Set up sync config (.axion/sync.yaml)
axn sync --init

# Sync all configured files
axn sync

# Sync a specific file with scope
axn sync .env.production --scope production
```

### Monorepo Support

Axion automatically detects service context in monorepos:

```
apps/api/.env       → service: api
apps/web/.env       → service: web
packages/lib/.env   → service: lib
```

### Sync Config (.axion/sync.yaml)

```yaml
version: "1"
files:
  - path: .env
    scope: development
  - path: .env.production
    scope: production
  - path: apps/api/.env
    service: api
    scope: development
```

## Security

Axion employs a **client-side zero-knowledge architecture** with **OWASP #1 recommended** cryptography:

| Component | Implementation |
|:----------|:---------------|
| **Encryption** | AES-256-GCM (authenticated encryption) |
| **Key Derivation** | Argon2id (64 MiB memory, 3 iterations, 4 parallelism) |
| **Project Key** | 128-bit random key (stored in `.axion/key` with chmod 600) |
| **Salt** | 256-bit random salt per encryption |
| **IV** | 128-bit random IV per encryption |
| **Format** | Versioned encryption format for future algorithm upgrades |

**How it works:**

1. Your **Project Key** is generated locally and stored in `.axion/key`
2. Secrets are encrypted using **AES-256-GCM** before leaving your machine
3. Axion Cloud stores **only the encrypted ciphertext**
4. Decryption happens locally — we cannot read your secrets

**Important:** Back up your project key securely. If you lose it, your secrets cannot be recovered.

## Configuration

### axion.config.yaml

Optional project configuration for advanced features:

```yaml
# Protected keys are write-only (cannot be revealed)
protected_keys:
  - STRIPE_SECRET_KEY
  - DATABASE_PASSWORD

# Validation patterns for secrets
validation:
  DATABASE_URL: "^postgres://"
  API_KEY: "^sk-[a-z0-9]{32}$"
```

### Environment Variables

| Variable | Description |
|:---------|:------------|
| `AXION_TOKEN` | Service token for CI/CD (bypasses login) |
| `AXION_API_URL` | Custom API URL (for self-hosted) |

## Pricing

| Plan | Price | Includes |
|:-----|:------|:---------|
| **Free** | $0 | 1 project, 1 user |
| **Pro** | $12/mo or $99/yr | Unlimited projects, 5 users per project, audit logs |
| **Enterprise** | $29/mo or $249/yr | Unlimited projects, unlimited team members |

## License

MIT
