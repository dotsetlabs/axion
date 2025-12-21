# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-12-20

### Added

- **Automatic Token Refresh**: Access tokens now refresh automatically when within 5 minutes of expiry, reducing login prompts
- **Integration Test Suite**: Comprehensive end-to-end tests for all CLI commands using `execa`
- **CI/CD Workflow**: GitHub Actions workflow runs tests on push to `main`
- **Improved Error Messages**: Better guidance when using `--cloud` flag without authentication

### Changed

- Reorganized test directory: `test/unit/` for unit tests, `test/integration/` for integration tests
- Updated vitest configs for separate unit and integration test runs

### Developer Experience

- New commands: `npm run test:integration`, `npm run test:all`
- 104+ tests total (86 unit, 18 integration)

---

## [1.0.0] - 2025-12-20

### Initial Release

- **Zero-Disk Architecture**: Secrets injected to `process.env` at runtime
- **End-to-End Encryption**: AES-256-GCM with versioned encryption format
- **Argon2id Key Derivation**: OWASP #1 recommended algorithm (64 MiB memory, GPU/ASIC resistant)
- **SSO Authentication**: GitHub and Google OAuth via Device Code Flow
- **Service Tokens**: Headless CI/CD authentication via `AXION_TOKEN`
- **Cloud Sync**: Push/pull encrypted manifests with version history
- **Team Collaboration**: Role-based access control (admin, member, readonly)
- **Audit Logging**: Track all access with device metadata
- **Secret Drift Detection**: Compare local vs cloud manifests
- **Key Rotation**: Rotate encryption keys with automatic re-encryption
- **Key Recovery**: Create encrypted recovery blobs for disaster recovery

### Security

- Argon2id for memory-hard, GPU-resistant key derivation
- AES-256-GCM for authenticated encryption
- Encryption format includes version/kdf/params for future algorithm upgrades
- Project keys stored with `chmod 600` permissions
- Credential files stored with `chmod 600` permissions
- Cryptographically random device IDs (UUID v4)
