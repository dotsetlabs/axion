/**
 * Axion Native SDK
 *
 * Programmatic access to Axion secrets without CLI wrapper commands.
 * Ideal for serverless functions, native integrations, and direct access patterns.
 *
 * @example Quick start - load into process.env
 * ```typescript
 * import { loadSecrets } from '@dotsetlabs/axion/sdk';
 *
 * await loadSecrets({ scope: 'production' });
 * console.log(process.env.DATABASE_URL);
 * ```
 *
 * @example Direct access without modifying process.env
 * ```typescript
 * import { getSecret, getSecrets } from '@dotsetlabs/axion/sdk';
 *
 * const dbUrl = await getSecret('DATABASE_URL');
 * const allSecrets = await getSecrets({ scope: 'production' });
 * ```
 *
 * @example Multi-service client
 * ```typescript
 * import { createClient } from '@dotsetlabs/axion/sdk';
 *
 * const api = createClient({ service: 'api', scope: 'production' });
 * const secrets = await api.getAll();
 * ```
 */

import { ManifestManager, GLOBAL_SERVICE } from './manifest.js';

// ============================================
// Types
// ============================================

/** Environment scope */
export type Scope = 'development' | 'staging' | 'production';

/**
 * Options for loading secrets
 */
export interface LoadSecretsOptions {
    /** Environment scope (default: 'development') */
    scope?: Scope;
    /** Service name for multi-service projects (default: '_global') */
    service?: string;
    /** Working directory containing .dotset/axion/ (default: process.cwd()) */
    workDir?: string;
    /** Overwrite existing process.env values (default: false) */
    overwrite?: boolean;
}

/**
 * Options for getting secrets
 */
export interface GetSecretsOptions {
    /** Environment scope (default: 'development') */
    scope?: Scope;
    /** Service name for multi-service projects (default: '_global') */
    service?: string;
    /** Working directory containing .dotset/axion/ (default: process.cwd()) */
    workDir?: string;
}

/**
 * Axion client interface for advanced usage patterns
 */
export interface AxionClient {
    /** Get a single secret value */
    get(key: string): Promise<string | undefined>;
    /** Get all secrets as key-value object */
    getAll(): Promise<Record<string, string>>;
    /** Check if a secret exists */
    has(key: string): Promise<boolean>;
    /** Clear cache and reload secrets from disk/cloud */
    reload(): Promise<void>;
    /** Current scope */
    readonly scope: Scope;
    /** Current service */
    readonly service: string;
}

/**
 * Options for creating an Axion client
 */
export interface CreateClientOptions {
    /** Environment scope (default: 'development') */
    scope?: Scope;
    /** Service name for multi-service projects (default: '_global') */
    service?: string;
    /** Working directory containing .dotset/axion/ (default: process.cwd()) */
    workDir?: string;
}

// ============================================
// Cache
// ============================================

/**
 * In-memory cache for decrypted secrets
 * Keyed by `${workDir}:${service}:${scope}`
 */
const secretsCache = new Map<string, Record<string, string>>();

/**
 * Generates cache key for a given configuration
 */
function getCacheKey(workDir: string, service: string, scope: Scope): string {
    return `${workDir}:${service}:${scope}`;
}

/**
 * Clears all cached secrets
 */
export function clearCache(): void {
    secretsCache.clear();
}

/**
 * Clears cached secrets for a specific configuration
 */
export function clearCacheFor(options: GetSecretsOptions = {}): void {
    const workDir = options.workDir ?? process.cwd();
    const service = options.service ?? GLOBAL_SERVICE;
    const scope = options.scope ?? 'development';
    const key = getCacheKey(workDir, service, scope);
    secretsCache.delete(key);
}

// ============================================
// Core Functions
// ============================================

/**
 * Get all secrets for a given scope and service
 *
 * Returns a cached copy if available. Decrypts from manifest on first call.
 *
 * @param options - Configuration options
 * @returns Record of secret key-value pairs
 *
 * @example
 * ```typescript
 * const secrets = await getSecrets({ scope: 'production' });
 * console.log(secrets.DATABASE_URL);
 * ```
 */
export async function getSecrets(options: GetSecretsOptions = {}): Promise<Record<string, string>> {
    const workDir = options.workDir ?? process.cwd();
    const service = options.service ?? GLOBAL_SERVICE;
    const scope = options.scope ?? 'development';
    const cacheKey = getCacheKey(workDir, service, scope);

    // Return from cache if available
    if (secretsCache.has(cacheKey)) {
        return { ...secretsCache.get(cacheKey)! };
    }

    // Load and decrypt from manifest
    const manager = new ManifestManager({ workDir });

    // Check if initialized
    if (!(await manager.isInitialized())) {
        throw new Error(
            'Axion not initialized. Run `axn init` first, or ensure the .dotset/axion/ directory exists.'
        );
    }

    const secrets = await manager.getVariables(service, scope);

    // Cache the result
    secretsCache.set(cacheKey, secrets);

    return { ...secrets };
}

/**
 * Get a single secret value
 *
 * @param key - Secret key name
 * @param options - Configuration options
 * @returns Secret value or undefined if not found
 *
 * @example
 * ```typescript
 * const dbUrl = await getSecret('DATABASE_URL', { scope: 'production' });
 * if (dbUrl) {
 *     // Use the secret
 * }
 * ```
 */
export async function getSecret(
    key: string,
    options: GetSecretsOptions = {}
): Promise<string | undefined> {
    const secrets = await getSecrets(options);
    return secrets[key];
}

/**
 * Check if a secret exists
 *
 * @param key - Secret key name
 * @param options - Configuration options
 * @returns true if the secret exists
 *
 * @example
 * ```typescript
 * if (await hasSecret('API_KEY')) {
 *     const key = await getSecret('API_KEY');
 * }
 * ```
 */
export async function hasSecret(
    key: string,
    options: GetSecretsOptions = {}
): Promise<boolean> {
    const secrets = await getSecrets(options);
    return key in secrets;
}

/**
 * Load secrets into process.env
 *
 * Decrypts secrets and injects them into `process.env`.
 * By default, existing process.env values are preserved (not overwritten).
 *
 * @param options - Configuration options
 *
 * @example Basic usage
 * ```typescript
 * await loadSecrets();
 * console.log(process.env.DATABASE_URL);
 * ```
 *
 * @example Production scope with overwrite
 * ```typescript
 * await loadSecrets({ scope: 'production', overwrite: true });
 * ```
 *
 * @example Multi-service
 * ```typescript
 * await loadSecrets({ service: 'api', scope: 'production' });
 * ```
 */
export async function loadSecrets(options: LoadSecretsOptions = {}): Promise<void> {
    const overwrite = options.overwrite ?? false;
    const secrets = await getSecrets(options);

    for (const [key, value] of Object.entries(secrets)) {
        if (overwrite || !(key in process.env)) {
            process.env[key] = value;
        }
    }
}

/**
 * Get the count of secrets that would be loaded
 *
 * Useful for logging/debugging without actually loading secrets.
 *
 * @param options - Configuration options
 * @returns Number of secrets available
 */
export async function countSecrets(options: GetSecretsOptions = {}): Promise<number> {
    const secrets = await getSecrets(options);
    return Object.keys(secrets).length;
}

/**
 * List all secret keys (without values)
 *
 * @param options - Configuration options
 * @returns Array of secret key names
 */
export async function listSecretKeys(options: GetSecretsOptions = {}): Promise<string[]> {
    const secrets = await getSecrets(options);
    return Object.keys(secrets);
}

// ============================================
// Client Factory
// ============================================

/**
 * Create a reusable Axion client with fixed options
 *
 * Useful when you need to access secrets multiple times with the same
 * scope/service configuration.
 *
 * @param options - Client configuration
 * @returns AxionClient instance
 *
 * @example
 * ```typescript
 * const client = createClient({ scope: 'production', service: 'api' });
 *
 * const dbUrl = await client.get('DATABASE_URL');
 * const allSecrets = await client.getAll();
 * const hasKey = await client.has('API_KEY');
 * ```
 */
export function createClient(options: CreateClientOptions = {}): AxionClient {
    const workDir = options.workDir ?? process.cwd();
    const service = options.service ?? GLOBAL_SERVICE;
    const scope = options.scope ?? 'development';

    const clientOptions: GetSecretsOptions = { workDir, service, scope };

    return {
        scope,
        service,

        async get(key: string): Promise<string | undefined> {
            return getSecret(key, clientOptions);
        },

        async getAll(): Promise<Record<string, string>> {
            return getSecrets(clientOptions);
        },

        async has(key: string): Promise<boolean> {
            return hasSecret(key, clientOptions);
        },

        async reload(): Promise<void> {
            clearCacheFor(clientOptions);
            await getSecrets(clientOptions); // Re-populate cache
        },
    };
}

// ============================================
// Convenience Exports
// ============================================

/**
 * Check if Axion is initialized in the given directory
 *
 * @param workDir - Working directory (default: process.cwd())
 * @returns true if Axion is initialized
 */
export async function isInitialized(workDir?: string): Promise<boolean> {
    const manager = new ManifestManager({ workDir: workDir ?? process.cwd() });
    return manager.isInitialized();
}

/**
 * Default export for convenient import
 */
export default {
    loadSecrets,
    getSecret,
    getSecrets,
    hasSecret,
    createClient,
    clearCache,
    clearCacheFor,
    countSecrets,
    listSecretKeys,
    isInitialized,
};
