/**
 * @dotsetlabs/axion
 * 
 * Secrets SDK for the dotset platform.
 * Zero-disk encrypted secrets with AES-256-GCM.
 * 
 * @example Quick start
 * ```typescript
 * import { loadSecrets, getSecret } from '@dotsetlabs/axion/sdk';
 * 
 * await loadSecrets({ scope: 'production' });
 * const apiKey = await getSecret('API_KEY');
 * ```
 * 
 * @example Using subpath imports
 * ```typescript
 * import { ManifestManager } from '@dotsetlabs/axion/manifest';
 * import { encrypt, decrypt } from '@dotsetlabs/axion/crypto';
 * ```
 * 
 * @packageDocumentation
 */

// Re-export SDK as the main entry point
export * from './sdk.js';

// Re-export key types and constants from manifest
export { GLOBAL_SERVICE, MANIFEST_FILENAME, KEY_FILENAME } from './manifest.js';
export type { Manifest, ServiceVariables, ManifestManagerOptions } from './manifest.js';
