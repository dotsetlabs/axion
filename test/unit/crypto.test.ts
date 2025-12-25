import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateProjectKey,
    getKeyFingerprint,
    encrypt,
    decrypt,
    serializeEncrypted,
    deserializeEncrypted,
    ENCRYPTION_VERSION
} from '../../src/crypto.js';

describe('Crypto Module', () => {
    let key: string;

    beforeEach(() => {
        key = generateProjectKey();
    });

    describe('generateProjectKey', () => {
        it('should generate a 32-character hex string', () => {
            const key = generateProjectKey();
            expect(key).toMatch(/^[a-f0-9]{32}$/);
        });

        it('should generate unique keys', () => {
            const key1 = generateProjectKey();
            const key2 = generateProjectKey();
            expect(key1).not.toBe(key2);
        });
    });

    describe('getKeyFingerprint', () => {
        it('should return a 16-character hex string (SHA-256 slice)', () => {
            const fp = getKeyFingerprint(key);
            expect(fp).toHaveLength(16);
            expect(fp).toMatch(/^[a-f0-9]{16}$/);
        });

        it('should return consistent fingerprints for the same key', () => {
            const fp1 = getKeyFingerprint(key);
            const fp2 = getKeyFingerprint(key);
            expect(fp1).toBe(fp2);
        });
    });

    describe('Argon2id Encryption', () => {
        it('should encrypt and decrypt a string correctly', async () => {
            const secret = 'my-super-secret-value';
            const encrypted = await encrypt(secret, key);

            // Should be structured data with Argon2id metadata
            expect(encrypted).toHaveProperty('iv');
            expect(encrypted).toHaveProperty('content');
            expect(encrypted).toHaveProperty('version');
            expect(encrypted).toHaveProperty('kdf');
            expect(encrypted).toHaveProperty('kdfParams');

            const decrypted = await decrypt(encrypted, key);
            expect(decrypted).toBe(secret);
        });

        it('should fail to decrypt with wrong key', async () => {
            const secret = 'test';
            const encrypted = await encrypt(secret, key);
            const wrongKey = generateProjectKey();

            await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
        });

        it('should use Argon2id as the KDF', async () => {
            const encrypted = await encrypt('test', key);

            expect(encrypted.version).toBe(ENCRYPTION_VERSION);
            expect(encrypted.kdf).toBe('argon2id');
            expect(encrypted.kdfParams).toEqual({
                memoryCost: 65536, // 64 MiB
                timeCost: 3,
                parallelism: 4,
            });
        });

        it('should use OWASP recommended Argon2id parameters', async () => {
            const encrypted = await encrypt('test', key);

            // OWASP recommends minimum 64 MiB memory
            expect(encrypted.kdfParams.memoryCost).toBeGreaterThanOrEqual(65536);
            // At least 3 iterations
            expect(encrypted.kdfParams.timeCost).toBeGreaterThanOrEqual(3);
            // Parallelism should match available cores (up to 4)
            expect(encrypted.kdfParams.parallelism).toBeGreaterThanOrEqual(1);
        });

        it('should produce different ciphertext for same plaintext (random IV)', async () => {
            const secret = 'same-secret';
            const encrypted1 = await encrypt(secret, key);
            const encrypted2 = await encrypt(secret, key);

            // Different IVs and salts
            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted1.salt).not.toBe(encrypted2.salt);
            // Different ciphertext
            expect(encrypted1.content).not.toBe(encrypted2.content);

            // But both decrypt to same value
            expect(await decrypt(encrypted1, key)).toBe(secret);
            expect(await decrypt(encrypted2, key)).toBe(secret);
        });
    });

    describe('Serialization', () => {
        it('should serialize and deserialize encrypted data', async () => {
            const original = await encrypt('test-data', key);
            const serialized = serializeEncrypted(original);

            expect(typeof serialized).toBe('string');
            // Check for JSON structure including Argon2id fields
            expect(serialized).toContain('"iv":');
            expect(serialized).toContain('"content":');
            expect(serialized).toContain('"version":');
            expect(serialized).toContain('"kdf":"argon2id"');
            expect(serialized).toContain('"kdfParams"');

            const deserialized = deserializeEncrypted(serialized);
            expect(deserialized).toEqual(original);
        });
    });

    describe('Version Compatibility', () => {
        it('should reject unsupported future versions', async () => {
            const futureVersionData = {
                version: 999,
                kdf: 'argon2id' as const,
                kdfParams: {
                    memoryCost: 65536,
                    timeCost: 3,
                    parallelism: 4,
                },
                iv: 'test',
                salt: 'test',
                authTag: 'test',
                content: 'test'
            };

            await expect(decrypt(futureVersionData, key)).rejects.toThrow(/unsupported encryption version/i);
        });
    });
});
