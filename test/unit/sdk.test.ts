/**
 * Axion SDK Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { ManifestManager } from '../../src/core/manifest.js';
import {
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
} from '../../src/sdk.js';

describe('Axion SDK', () => {
    let workDir: string;
    let manager: ManifestManager;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'axion-sdk-test-'));
        manager = new ManifestManager({ workDir });
        await manager.init();

        // Set up test secrets
        await manager.setVariable('DATABASE_URL', 'postgres://localhost/test');
        await manager.setVariable('API_KEY', 'sk-test-123');
        await manager.setVariable('PROD_KEY', 'prod-value', '_global', 'production');

        // Clear any cached secrets
        clearCache();
    });

    afterEach(async () => {
        clearCache();
        await rm(workDir, { recursive: true, force: true });
    });

    describe('getSecrets', () => {
        it('should get all secrets for default scope', async () => {
            const secrets = await getSecrets({ workDir });

            expect(secrets.DATABASE_URL).toBe('postgres://localhost/test');
            expect(secrets.API_KEY).toBe('sk-test-123');
        });

        it('should get secrets for specific scope', async () => {
            const devSecrets = await getSecrets({ workDir, scope: 'development' });
            const prodSecrets = await getSecrets({ workDir, scope: 'production' });

            expect(devSecrets.DATABASE_URL).toBe('postgres://localhost/test');
            expect(prodSecrets.PROD_KEY).toBe('prod-value');
        });

        it('should cache secrets on subsequent calls', async () => {
            const first = await getSecrets({ workDir });
            const second = await getSecrets({ workDir });

            expect(first).toEqual(second);
        });

        it('should throw if not initialized', async () => {
            const emptyDir = await mkdtemp(join(tmpdir(), 'axion-empty-'));

            await expect(getSecrets({ workDir: emptyDir })).rejects.toThrow('Axion not initialized');

            await rm(emptyDir, { recursive: true, force: true });
        });
    });

    describe('getSecret', () => {
        it('should get a single secret', async () => {
            const value = await getSecret('DATABASE_URL', { workDir });

            expect(value).toBe('postgres://localhost/test');
        });

        it('should return undefined for missing secret', async () => {
            const value = await getSecret('NONEXISTENT', { workDir });

            expect(value).toBeUndefined();
        });
    });

    describe('hasSecret', () => {
        it('should return true for existing secret', async () => {
            const exists = await hasSecret('DATABASE_URL', { workDir });

            expect(exists).toBe(true);
        });

        it('should return false for missing secret', async () => {
            const exists = await hasSecret('NONEXISTENT', { workDir });

            expect(exists).toBe(false);
        });
    });

    describe('loadSecrets', () => {
        it('should inject secrets into process.env', async () => {
            // Clear any existing test values
            delete process.env.DATABASE_URL;
            delete process.env.API_KEY;

            await loadSecrets({ workDir });

            expect(process.env.DATABASE_URL).toBe('postgres://localhost/test');
            expect(process.env.API_KEY).toBe('sk-test-123');

            // Clean up
            delete process.env.DATABASE_URL;
            delete process.env.API_KEY;
        });

        it('should not overwrite existing env vars by default', async () => {
            process.env.DATABASE_URL = 'existing-value';

            await loadSecrets({ workDir });

            expect(process.env.DATABASE_URL).toBe('existing-value');

            // Clean up
            delete process.env.DATABASE_URL;
            delete process.env.API_KEY;
        });

        it('should overwrite existing env vars when overwrite is true', async () => {
            process.env.DATABASE_URL = 'existing-value';

            await loadSecrets({ workDir, overwrite: true });

            expect(process.env.DATABASE_URL).toBe('postgres://localhost/test');

            // Clean up
            delete process.env.DATABASE_URL;
            delete process.env.API_KEY;
        });
    });

    describe('createClient', () => {
        it('should create a client with fixed options', async () => {
            const client = createClient({ workDir });

            expect(client.scope).toBe('development');
            expect(client.service).toBe('_global');
        });

        it('should get secrets via client', async () => {
            const client = createClient({ workDir });

            const value = await client.get('DATABASE_URL');
            expect(value).toBe('postgres://localhost/test');
        });

        it('should get all secrets via client', async () => {
            const client = createClient({ workDir });

            const secrets = await client.getAll();
            expect(secrets.DATABASE_URL).toBe('postgres://localhost/test');
            expect(secrets.API_KEY).toBe('sk-test-123');
        });

        it('should check existence via client', async () => {
            const client = createClient({ workDir });

            expect(await client.has('DATABASE_URL')).toBe(true);
            expect(await client.has('NONEXISTENT')).toBe(false);
        });

        it('should reload secrets via client', async () => {
            const client = createClient({ workDir });

            // Get initial secrets
            await client.getAll();

            // Modify secrets directly
            await manager.setVariable('NEW_VAR', 'new-value');

            // Reload
            await client.reload();

            // Should see new secret
            expect(await client.has('NEW_VAR')).toBe(true);
        });

        it('should create client for specific scope', async () => {
            const client = createClient({ workDir, scope: 'production' });

            expect(client.scope).toBe('production');

            const secrets = await client.getAll();
            expect(secrets.PROD_KEY).toBe('prod-value');
        });
    });

    describe('countSecrets', () => {
        it('should return count of secrets', async () => {
            const count = await countSecrets({ workDir });

            expect(count).toBe(2); // DATABASE_URL and API_KEY
        });
    });

    describe('listSecretKeys', () => {
        it('should return list of secret keys', async () => {
            const keys = await listSecretKeys({ workDir });

            expect(keys).toContain('DATABASE_URL');
            expect(keys).toContain('API_KEY');
            expect(keys.length).toBe(2);
        });
    });

    describe('isInitialized', () => {
        it('should return true for initialized directory', async () => {
            const result = await isInitialized(workDir);

            expect(result).toBe(true);
        });

        it('should return false for non-initialized directory', async () => {
            const emptyDir = await mkdtemp(join(tmpdir(), 'axion-empty-'));

            const result = await isInitialized(emptyDir);

            expect(result).toBe(false);

            await rm(emptyDir, { recursive: true, force: true });
        });
    });

    describe('cache management', () => {
        it('should clear all caches', async () => {
            // Populate cache
            await getSecrets({ workDir });

            // Clear
            clearCache();

            // Should re-fetch (we can't easily verify this, but no error means success)
            const secrets = await getSecrets({ workDir });
            expect(secrets.DATABASE_URL).toBe('postgres://localhost/test');
        });

        it('should clear cache for specific config', async () => {
            // Populate caches for different scopes
            await getSecrets({ workDir, scope: 'development' });
            await getSecrets({ workDir, scope: 'production' });

            // Clear only development
            clearCacheFor({ workDir, scope: 'development' });

            // Production cache should still exist (verified by no re-fetch error)
            const prodSecrets = await getSecrets({ workDir, scope: 'production' });
            expect(prodSecrets.PROD_KEY).toBe('prod-value');
        });
    });
});
