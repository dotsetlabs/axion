# Changelog

All notable changes to this project will be documented in this file.

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
