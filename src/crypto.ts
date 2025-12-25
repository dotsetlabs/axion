/**
 * Axion Cryptographic Module
 *
 * Provides AES-256-GCM encryption with Argon2id key derivation.
 * Argon2id is the OWASP #1 recommended algorithm for key derivation,
 * providing superior resistance to GPU and ASIC-based attacks.
 *
 * Security Design:
 * - AES-256-GCM for authenticated encryption (confidentiality + integrity)
 * - Argon2id for memory-hard key derivation (GPU/ASIC resistant)
 * - Random 128-bit IV per encryption operation
 * - Random 256-bit salt per encryption operation
 * - Versioned format for future algorithm upgrades
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';

/** Current encryption format version */
export const ENCRYPTION_VERSION = 1;

/** Algorithm constants */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Argon2id configuration - OWASP recommended parameters
 * - memoryCost: 64 MiB (65536 KiB) - memory hardness
 * - timeCost: 3 iterations - computational cost
 * - parallelism: 4 threads - parallelization factor
 *
 * These parameters provide strong security while remaining
 * practical for CLI usage on modern hardware.
 */
const ARGON2_MEMORY_COST = 65536; // 64 MiB
const ARGON2_TIME_COST = 3;
const ARGON2_PARALLELISM = 4;

/**
 * Encrypted data structure containing all components needed for decryption
 * Versioned format enables future algorithm migrations
 */
export interface EncryptedData {
    /** Encryption format version (for future migrations) */
    version: number;
    /** Key derivation function identifier */
    kdf: 'argon2id';
    /** Argon2id parameters for reproducible key derivation */
    kdfParams: {
        memoryCost: number;
        timeCost: number;
        parallelism: number;
    };
    /** Initialization vector (16 bytes, hex-encoded) */
    iv: string;
    /** Salt used for key derivation (32 bytes, hex-encoded) */
    salt: string;
    /** GCM authentication tag (16 bytes, hex-encoded) */
    authTag: string;
    /** Encrypted content (hex-encoded) */
    content: string;
}

/**
 * Derives an AES-256 key from a password using Argon2id
 *
 * Argon2id is memory-hard and resistant to GPU/ASIC attacks,
 * making it the most secure choice for key derivation.
 *
 * @param password - The password to derive the key from
 * @param salt - Salt for key derivation (generates new if not provided)
 * @param options - Optional Argon2 parameters (for decrypting with stored params)
 * @returns Object containing the derived key and salt used
 */
export async function deriveKey(
    password: string,
    salt?: Buffer,
    options?: { memoryCost?: number; timeCost?: number; parallelism?: number }
): Promise<{ key: Buffer; salt: Buffer }> {
    const useSalt = salt ?? randomBytes(SALT_LENGTH);

    const key = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: options?.memoryCost ?? ARGON2_MEMORY_COST,
        timeCost: options?.timeCost ?? ARGON2_TIME_COST,
        parallelism: options?.parallelism ?? ARGON2_PARALLELISM,
        hashLength: KEY_LENGTH,
        salt: useSalt,
        raw: true,
    });

    return { key: key as Buffer, salt: useSalt };
}

/**
 * Encrypts plaintext data using AES-256-GCM with Argon2id key derivation
 *
 * Security properties:
 * - Confidentiality: AES-256 encryption
 * - Integrity: GCM authentication tag
 * - Memory-hard KDF: Argon2id resists GPU/ASIC attacks
 * - Unique per operation: Random IV and salt
 *
 * @param plaintext - The data to encrypt
 * @param password - Password used for key derivation
 * @returns Encrypted data structure with all components for decryption
 */
export async function encrypt(plaintext: string, password: string): Promise<EncryptedData> {
    const iv = randomBytes(IV_LENGTH);
    const { key, salt } = await deriveKey(password);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
        version: ENCRYPTION_VERSION,
        kdf: 'argon2id',
        kdfParams: {
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        },
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        authTag: authTag.toString('hex'),
        content: encrypted,
    };
}

/**
 * Decrypts data that was encrypted with the encrypt function
 *
 * Uses the stored Argon2id parameters to reproduce the exact key derivation.
 *
 * @param encryptedData - The encrypted data structure
 * @param password - Password used for key derivation (must match encryption password)
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong password, corrupted data, or unsupported version)
 */
export async function decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
    // Validate version
    if (encryptedData.version > ENCRYPTION_VERSION) {
        throw new Error(
            `Unsupported encryption version ${encryptedData.version}. ` +
            `Please upgrade @dotsetlabs/axion to decrypt this data.`
        );
    }

    const iv = Buffer.from(encryptedData.iv, 'hex');
    const salt = Buffer.from(encryptedData.salt, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const content = Buffer.from(encryptedData.content, 'hex');

    // Use stored KDF parameters for reproducible key derivation
    const kdfOptions: Partial<argon2.Options> = {
        memoryCost: encryptedData.kdfParams.memoryCost,
        timeCost: encryptedData.kdfParams.timeCost,
        parallelism: encryptedData.kdfParams.parallelism,
    };

    const { key } = await deriveKey(password, salt, kdfOptions);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(content);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

/**
 * Serializes encrypted data to a string for file storage
 */
export function serializeEncrypted(data: EncryptedData): string {
    return JSON.stringify(data);
}

/**
 * Deserializes encrypted data from a string
 */
export function deserializeEncrypted(data: string): EncryptedData {
    return JSON.parse(data) as EncryptedData;
}

/**
 * Generates a cryptographically secure random key for project initialization
 * This key should be stored securely by the user (e.g., in a password manager)
 *
 * @returns A 32-character hex string (128 bits of entropy)
 */
export function generateProjectKey(): string {
    return randomBytes(16).toString('hex');
}

/**
 * Generates a fingerprint for a key using SHA-256
 * Useful for identifying keys without exposing them
 *
 * @param key - The key to fingerprint
 * @returns First 16 characters of SHA-256 hash (64 bits, collision-resistant for display)
 */
export function getKeyFingerprint(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
