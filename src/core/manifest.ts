/**
 * Axion Manifest Manager
 *
 * Handles the encrypted manifest file (.axion.env) which stores
 * environment variables organized by service.
 *
 * Manifest Structure:
 * {
 *   version: "1.0",
 *   services: {
 *     "api": { "DATABASE_URL": "...", "API_KEY": "..." },
 *     "worker": { "REDIS_URL": "...", "QUEUE_NAME": "..." },
 *     "_global": { "NODE_ENV": "production" }  // Shared across all services
 *   }
 * }
 *
 * The "_global" service contains variables that are injected into all services.
 */

import { readFile, writeFile, mkdir, access, unlink, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
    encrypt,
    decrypt,
    serializeEncrypted,
    deserializeEncrypted,
    generateProjectKey,
    getKeyFingerprint,
} from './crypto.js';
import { cloudClient } from '../cloud/client.js';
import { loadCloudConfig } from '../cloud/auth.js';
import { loadConfig, validateSecret } from './config.js';
import { parseEnvFile } from './parser.js';

/** Reserved service name for global variables */
export const GLOBAL_SERVICE = '_global';

/** Default manifest filename */
export const MANIFEST_FILENAME = '.axion.env';

/** Key storage filename */
export const KEY_FILENAME = '.axion/key';

/** Cache directory for push/pull simulation */
export const CACHE_DIR = '.axion/cache';

/**
 * Service-scoped environment variables
 */
export interface ServiceVariables {
    [key: string]: string;
}

/**
 * Manifest structure for storing all environment variables
 */
export interface Manifest {
    /** Manifest format version */
    version: string;
    /** Environment variables organized by service */
    services: Record<string, ServiceVariables>;
    /** Scope-specific overrides */
    scopes?: {
        development?: Record<string, ServiceVariables>;
        staging?: Record<string, ServiceVariables>;
        production?: Record<string, ServiceVariables>;
    };
}

/**
 * Creates an empty manifest with default structure
 */
export function createEmptyManifest(): Manifest {
    return {
        version: '1.0',
        services: {
            [GLOBAL_SERVICE]: {},
        },
        scopes: {
            development: {},
            staging: {},
            production: {},
        },
    };
}

/**
 * Options for the ManifestManager
 */
export interface ManifestManagerOptions {
    /** Working directory (defaults to process.cwd()) */
    workDir?: string;
    /** Custom manifest filename */
    manifestFile?: string;
}

/**
 * Manages the encrypted manifest file for environment variables
 */
export class ManifestManager {
    private readonly workDir: string;
    private readonly manifestPath: string;
    private readonly keyPath: string;
    private readonly cachePath: string;

    constructor(options: ManifestManagerOptions = {}) {
        this.workDir = options.workDir ?? process.cwd();
        this.manifestPath = join(this.workDir, options.manifestFile ?? MANIFEST_FILENAME);
        this.keyPath = join(this.workDir, KEY_FILENAME);
        this.cachePath = join(this.workDir, CACHE_DIR);
    }

    /**
     * Checks if the project has been initialized
     */
    async isInitialized(): Promise<boolean> {
        try {
            await access(this.keyPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Initializes a new project with a fresh encryption key
     * @returns The generated project key (user should store this securely)
     */
    async init(): Promise<string> {
        const keyDir = dirname(this.keyPath);
        await mkdir(keyDir, { recursive: true });

        const projectKey = generateProjectKey();
        await writeFile(this.keyPath, projectKey, { encoding: 'utf8', mode: 0o600 });

        // Create empty manifest
        const manifest = createEmptyManifest();
        await this.save(manifest);

        return projectKey;
    }

    /**
     * Reads the project encryption key
     */
    private async getKey(): Promise<string> {
        try {
            return (await readFile(this.keyPath, 'utf8')).trim();
        } catch {
            throw new Error(
                'Project not initialized. Run "axn init" first.'
            );
        }
    }

    /**
     * Loads and decrypts the manifest
     * Supports "Zero-Disk" mode by fetching directly from cloud if linked.
     */
    async load(): Promise<Manifest> {
        const key = await this.getKey();

        let localManifest: Manifest | null = null;
        let cloudManifest: Manifest | null = null;

        // 1. Try to load and decrypt local manifest
        try {
            const encrypted = await readFile(this.manifestPath, 'utf8');
            const encryptedData = deserializeEncrypted(encrypted);
            const decrypted = await decrypt(encryptedData, key);
            localManifest = JSON.parse(decrypted) as Manifest;
        } catch (error) {
            // Ignore if file doesn't exist (ENOENT)
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`Warning: Failed to load local manifest: ${(error as Error).message}`);
            }
        }

        // 2. Try to fetch and decrypt cloud manifest
        try {
            const config = await loadCloudConfig(this.workDir);
            if (config) {
                // Heartbeat Pulse (JIT)
                try {
                    await cloudClient.pulse(config.projectId);
                } catch (err) {
                    if ((err as Error).message.includes('Heartbeat failed')) throw err;
                    // Ignore network errors
                }

                // Fetch latest manifest
                try {
                    const cloudData = await cloudClient.fetchManifest(config.projectId);
                    const cloudEncrypted = deserializeEncrypted(cloudData.encryptedData);
                    const cloudDecrypted = await decrypt(cloudEncrypted, key);
                    cloudManifest = JSON.parse(cloudDecrypted) as Manifest;
                } catch {
                    // Ignore fetch error (offline fallback)
                }
            }
        } catch {
            // Ignore config loading errors
        }

        // 3. Resolution Logic
        if (localManifest && cloudManifest) {
            // Both exist: use the one with higher version
            if (localManifest.version > cloudManifest.version) {
                return localManifest;
            } else if (cloudManifest.version > localManifest.version) {
                return cloudManifest;
            } else {
                // Same version: prefer cloud as source of truth, but they should be identical
                return cloudManifest;
            }
        } else if (localManifest) {
            // Only local exists
            return localManifest;
        } else if (cloudManifest) {
            // Only cloud exists
            return cloudManifest;
        }

        // 4. Default: New Empty Manifest
        return createEmptyManifest();
    }

    /**
     * Encrypts and saves the manifest
     * Automatically pushes to cloud if linked.
     */
    async save(manifest: Manifest): Promise<void> {
        const key = await this.getKey();
        const plaintext = JSON.stringify(manifest, null, 2);
        const encrypted = await encrypt(plaintext, key);
        const serialized = serializeEncrypted(encrypted);

        // 1. Save to Disk (Offline cache/backup)
        await writeFile(this.manifestPath, serialized, 'utf8');

        // 2. Push to Cloud (Auto-Sync)
        try {
            const config = await loadCloudConfig(this.workDir);
            if (config) {
                const fingerprint = await this.getFingerprint();
                await cloudClient.uploadManifest(config.projectId, serialized, fingerprint);
            }
        } catch {
            // Ignore cloud push errors (offline mode)
            // User will be warned by CLI if explicit sync fails,
            // but for implicit saves we fail silently to cache.
        }
    }

    /**
     * Gets all variables for a specific service (including global)
     * Merges default values with scope-specific overrides
     */
    async getVariables(service: string = GLOBAL_SERVICE, scope: 'development' | 'staging' | 'production' = 'development'): Promise<ServiceVariables> {
        const manifest = await this.load();
        const result: ServiceVariables = {};

        // 1. Merge Global Defaults
        Object.assign(result, manifest.services[GLOBAL_SERVICE] || {});

        // 2. Merge Global Scope Overrides
        if (manifest.scopes?.[scope]?.[GLOBAL_SERVICE]) {
            Object.assign(result, manifest.scopes[scope]![GLOBAL_SERVICE]);
        }

        // 3. Merge Service Defaults
        if (service !== GLOBAL_SERVICE) {
            Object.assign(result, manifest.services[service] || {});
        }

        // 4. Merge Service Scope Overrides
        if (service !== GLOBAL_SERVICE && manifest.scopes?.[scope]?.[service]) {
            Object.assign(result, manifest.scopes[scope]![service]);
        }

        // 5. Merge Local Overrides (Highest Priority)
        const overrides = await this.loadLocalOverrides();
        // Applies to all services? Or just match by key?
        // Standard .env overrides usually flatten everything.
        // For now, let's assume .axion.local keys override matching keys in the resolved scope.
        // This effectively treats local overrides as global for the current process resolution.
        Object.assign(result, overrides);

        // 6. Resolve Secret References (@ref:KEY syntax)
        return this.resolveReferences(result);
    }

    /**
     * Resolves @ref:KEY references to their actual values
     *
     * Supports:
     * - @ref:KEY - Reference another secret
     * - Circular reference detection
     *
     * Example:
     *   axn set DATABASE_URL "postgres://..."
     *   axn set API_DATABASE_URL "@ref:DATABASE_URL"
     */
    private resolveReferences(vars: ServiceVariables): ServiceVariables {
        const result: ServiceVariables = { ...vars };
        const refRegex = /@ref:([A-Za-z0-9_]+)/g;
        const resolving = new Set<string>();
        const resolved = new Set<string>();

        const resolveValue = (key: string, value: string): string => {
            if (typeof value !== 'string') return value;

            // Circular reference check
            if (resolving.has(key)) {
                throw new Error(`Circular reference detected: ${key}`);
            }

            resolving.add(key);

            const resolvedValue = value.replace(refRegex, (match, refKey) => {
                // Check if referenced key exists in original vars
                if (!(refKey in vars)) {
                    throw new Error(`Reference @ref:${refKey} not found (used in ${key})`);
                }

                // If the referenced key itself needs resolution, do it
                if (vars[refKey].includes('@ref:') && !resolved.has(refKey)) {
                    return resolveValue(refKey, vars[refKey]);
                }

                return result[refKey] || vars[refKey];
            });

            resolving.delete(key);
            result[key] = resolvedValue;
            resolved.add(key);
            return resolvedValue;
        };

        // Resolve all references
        for (const key of Object.keys(vars)) {
            if (!resolved.has(key)) {
                resolveValue(key, vars[key]);
            }
        }

        return result;
    }


    /**
     * Sets an environment variable in the manifest
     *
     * @param key - Variable name
     * @param value - Variable value
     * @param service - Service to scope the variable to (defaults to _global)
     * @param scope - Environment scope (optional, updates default if omitted)
     */
    async setVariable(key: string, value: string, service: string = GLOBAL_SERVICE, scope?: 'development' | 'staging' | 'production'): Promise<void> {
        // 1. Load Config & Validate
        const config = await loadConfig(this.workDir);
        validateSecret(key, value, config);

        // 2. Load Manifest
        const manifest = await this.load();

        if (scope) {
            // Update scope-specific override
            if (!manifest.scopes) manifest.scopes = { development: {}, staging: {}, production: {} };
            if (!manifest.scopes[scope]) manifest.scopes[scope] = {};
            if (!manifest.scopes[scope]![service]) manifest.scopes[scope]![service] = {};

            manifest.scopes[scope]![service][key] = value;
        } else {
            // Update default service variable
            if (!manifest.services[service]) {
                manifest.services[service] = {};
            }
            manifest.services[service][key] = value;
        }

        await this.save(manifest);
    }

    /**
     * Removes an environment variable from the manifest
     */
    async removeVariable(key: string, service: string = GLOBAL_SERVICE, scope?: 'development' | 'staging' | 'production'): Promise<boolean> {
        const manifest = await this.load();
        let changed = false;

        if (scope) {
            // Remove from scope override
            if (manifest.scopes?.[scope]?.[service] && key in manifest.scopes[scope]![service]) {
                delete manifest.scopes[scope]![service][key];
                changed = true;
            }
        } else {
            // Remove from default service
            if (manifest.services[service] && key in manifest.services[service]) {
                delete manifest.services[service][key];
                changed = true;
            }
        }

        if (changed) {
            await this.save(manifest);
            return true;
        }
        return false;
    }

    /**
     * Lists all services in the manifest
     */
    async listServices(): Promise<string[]> {
        const manifest = await this.load();
        return Object.keys(manifest.services);
    }

    /**
     * Gets the fingerprint of the current encryption key
     * Useful for identifying which key is in use without exposing it
     *
     * @returns First 16 characters of SHA-256 hash of the key
     */
    async getFingerprint(): Promise<string> {
        const key = await this.getKey();
        return getKeyFingerprint(key);
    }

    /**
     * Gets the current encryption key (use with caution)
     *
     * @returns The raw encryption key
     */
    async showKey(): Promise<string> {
        return this.getKey();
    }

    /**
     * Loads local overrides from .axion.local
     * @returns Dictionary of local variable overrides
     */
    private async loadLocalOverrides(): Promise<ServiceVariables> {
        const localPath = join(this.workDir, '.axion.local');
        try {
            const content = await readFile(localPath, 'utf8');
            const result = parseEnvFile(content);
            const overrides: ServiceVariables = {};
            for (const { key, value } of result.variables) {
                overrides[key] = value;
            }
            return overrides;
        } catch {
            return {}; // No overrides or file missing
        }
    }

    /**
     * Creates a backup of the current manifest
     *
     * @returns Path to the backup file
     */
    private async createBackup(): Promise<string> {
        const backupPath = `${this.manifestPath}.backup`;
        try {
            await copyFile(this.manifestPath, backupPath);
            return backupPath;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error('No manifest found to backup.');
            }
            throw error;
        }
    }

    /**
     * Restores the manifest from backup
     *
     * @param backupPath - Path to the backup file
     */
    private async restoreBackup(backupPath: string): Promise<void> {
        await copyFile(backupPath, this.manifestPath);
        await unlink(backupPath);
    }

    /**
     * Removes the backup file after successful operation
     *
     * @param backupPath - Path to the backup file
     */
    private async cleanupBackup(backupPath: string): Promise<void> {
        try {
            await unlink(backupPath);
        } catch {
            // Ignore if backup doesn't exist
        }
    }

    /**
     * Rotates the encryption key
     *
     * This operation:
     * 1. Creates a backup of the current manifest
     * 2. Decrypts the manifest with the old key
     * 3. Generates a new key (or uses provided one)
     * 4. Re-encrypts the manifest with the new key
     * 5. Writes the new key and manifest
     * 6. Verifies decryption works with new key
     * 7. Removes backup on success, or restores on failure
     *
     * @param newKey - Optional new key to use (generates one if not provided)
     * @returns Object containing the old and new keys
     */
    async rotateKey(newKey?: string): Promise<{ oldKey: string; newKey: string }> {
        // Get the current key
        const oldKey = await this.getKey();
        const keyToUse = newKey ?? generateProjectKey();

        // Validate new key format (should be hex string of appropriate length)
        if (!/^[a-f0-9]{32}$/i.test(keyToUse)) {
            throw new Error('Invalid key format. Key must be a 32-character hex string.');
        }

        // Create backup before any modifications
        const backupPath = await this.createBackup();

        try {
            // Load and decrypt manifest with old key
            const manifest = await this.load();

            // Write the new key
            await writeFile(this.keyPath, keyToUse, 'utf8');

            // Re-encrypt and save manifest with new key
            const plaintext = JSON.stringify(manifest, null, 2);
            const encrypted = await encrypt(plaintext, keyToUse);
            await writeFile(this.manifestPath, serializeEncrypted(encrypted), 'utf8');

            // Verify decryption works with new key
            const verifyManifest = await this.load();
            if (JSON.stringify(verifyManifest) !== JSON.stringify(manifest)) {
                throw new Error('Verification failed: manifest content mismatch after rotation');
            }

            // Success - remove backup
            await this.cleanupBackup(backupPath);

            return { oldKey, newKey: keyToUse };
        } catch (error) {
            // Rollback: restore backup and old key
            try {
                await writeFile(this.keyPath, oldKey, 'utf8');
                await this.restoreBackup(backupPath);
            } catch (restoreError) {
                throw new Error(
                    `Key rotation failed AND rollback failed. Backup at: ${backupPath}. ` +
                    `Original error: ${(error as Error).message}. ` +
                    `Rollback error: ${(restoreError as Error).message}`
                );
            }
            throw new Error(`Key rotation failed (rolled back): ${(error as Error).message}`);
        }
    }

    /**
     * Detects drift between local and cloud manifests
     *
     * Compares secrets to identify:
     * - Secrets only in local (not pushed to cloud)
     * - Secrets only in cloud (not pulled locally)
     * - Secrets with different values
     *
     * @returns DriftResult with all differences
     */
    async detectDrift(): Promise<DriftResult> {
        const config = await loadCloudConfig(this.workDir);
        if (!config) {
            throw new Error('Project not linked to cloud. Run "axn link <project-id>" first.');
        }

        const key = await this.getKey();

        // 1. Load local manifest (disk only, bypass cloud fetch)
        const localManifest = await this.loadLocal();

        // 2. Fetch cloud manifest
        let cloudManifest: Manifest;
        try {
            const cloudData = await cloudClient.fetchManifest(config.projectId);
            const cloudEncrypted = deserializeEncrypted(cloudData.encryptedData);
            const cloudDecrypted = await decrypt(cloudEncrypted, key);
            cloudManifest = JSON.parse(cloudDecrypted) as Manifest;
        } catch (error) {
            throw new Error(`Failed to fetch cloud manifest: ${(error as Error).message}`);
        }

        // 3. Compare manifests
        return this.compareManifests(localManifest, cloudManifest);
    }

    /**
     * Loads the manifest from the local file system only
     */
    private async loadLocal(): Promise<Manifest> {
        const key = await this.getKey();
        try {
            const encrypted = await readFile(this.manifestPath, 'utf8');
            const encryptedData = deserializeEncrypted(encrypted);
            const decrypted = await decrypt(encryptedData, key);
            return JSON.parse(decrypted) as Manifest;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return createEmptyManifest();
            }
            throw new Error(`Failed to load local manifest: ${(error as Error).message}`);
        }
    }

    /**
     * Compares two manifests and returns the differences
     */
    private compareManifests(local: Manifest, cloud: Manifest): DriftResult {
        const localOnly: DriftItem[] = [];
        const cloudOnly: DriftItem[] = [];
        const modified: DriftModifiedItem[] = [];

        // Get all services from both manifests
        const allServices = new Set([
            ...Object.keys(local.services),
            ...Object.keys(cloud.services),
        ]);

        for (const service of allServices) {
            const localVars = local.services[service] || {};
            const cloudVars = cloud.services[service] || {};

            const allKeys = new Set([
                ...Object.keys(localVars),
                ...Object.keys(cloudVars),
            ]);

            for (const key of allKeys) {
                const localValue = localVars[key];
                const cloudValue = cloudVars[key];

                if (localValue !== undefined && cloudValue === undefined) {
                    // Local only
                    localOnly.push({ key, service, value: localValue });
                } else if (localValue === undefined && cloudValue !== undefined) {
                    // Cloud only
                    cloudOnly.push({ key, service, value: cloudValue });
                } else if (localValue !== cloudValue) {
                    // Modified
                    modified.push({ key, service, localValue: localValue!, cloudValue: cloudValue! });
                }
            }
        }

        // Also compare scope overrides
        const scopes = ['development', 'staging', 'production'] as const;
        for (const scope of scopes) {
            const localScope = local.scopes?.[scope] || {};
            const cloudScope = cloud.scopes?.[scope] || {};

            const scopeServices = new Set([
                ...Object.keys(localScope),
                ...Object.keys(cloudScope),
            ]);

            for (const service of scopeServices) {
                const localScopeVars = localScope[service] || {};
                const cloudScopeVars = cloudScope[service] || {};

                const allScopeKeys = new Set([
                    ...Object.keys(localScopeVars),
                    ...Object.keys(cloudScopeVars),
                ]);

                for (const key of allScopeKeys) {
                    const scopedKey = `${key} (${scope})`;
                    const localValue = localScopeVars[key];
                    const cloudValue = cloudScopeVars[key];

                    if (localValue !== undefined && cloudValue === undefined) {
                        localOnly.push({ key: scopedKey, service, value: localValue });
                    } else if (localValue === undefined && cloudValue !== undefined) {
                        cloudOnly.push({ key: scopedKey, service, value: cloudValue });
                    } else if (localValue !== cloudValue) {
                        modified.push({ key: scopedKey, service, localValue: localValue!, cloudValue: cloudValue! });
                    }
                }
            }
        }

        const total = localOnly.length + cloudOnly.length + modified.length;

        return {
            hasDrift: total > 0,
            localOnly,
            cloudOnly,
            modified,
            summary: {
                total,
                added: localOnly.length,
                removed: cloudOnly.length,
                changed: modified.length,
            },
        };
    }
}

/**
 * Drift detection result
 */
export interface DriftResult {
    /** Whether any drift was detected */
    hasDrift: boolean;
    /** Secrets only in local (not pushed) */
    localOnly: DriftItem[];
    /** Secrets only in cloud (not pulled) */
    cloudOnly: DriftItem[];
    /** Secrets with different values */
    modified: DriftModifiedItem[];
    /** Summary counts */
    summary: {
        total: number;
        added: number;
        removed: number;
        changed: number;
    };
}

export interface DriftItem {
    key: string;
    service: string;
    value: string;
}

export interface DriftModifiedItem {
    key: string;
    service: string;
    localValue: string;
    cloudValue: string;
}
