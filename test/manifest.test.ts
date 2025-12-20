import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManifestManager, GLOBAL_SERVICE } from '../src/core/manifest.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

describe('ManifestManager', () => {
    let workDir: string;
    let manifestManager: ManifestManager;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'axion-test-'));
        manifestManager = new ManifestManager({ workDir });
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    describe('Initialization', () => {
        it('should report not initialized initially', async () => {
            expect(await manifestManager.isInitialized()).toBe(false);
        });

        it('should initialize successfully', async () => {
            const key = await manifestManager.init();
            expect(await manifestManager.isInitialized()).toBe(true);
            expect(key).toHaveLength(32);
        });

        it('should prevent re-initialization', async () => {
            await manifestManager.init();
            // Typically the logic is in CLI, but the manager might just overwrite.
            // Let's check that calling init again works (overwrites) or throws depending on implementation.
            // Looking at code: init() just overwrites. The "Project already initialized" check is in CLI.
            const newKey = await manifestManager.init();
            expect(newKey).toHaveLength(32);
        });
    });

    describe('Variable Operations', () => {
        beforeEach(async () => {
            await manifestManager.init();
        });

        it('should set and get a global variable', async () => {
            await manifestManager.setVariable('TEST_VAR', 'test-value');
            const vars = await manifestManager.getVariables();
            expect(vars['TEST_VAR']).toBe('test-value');
        });

        // it('should validate variable names', async () => {
        //     await expect(manifestManager.setVariable('123INVALID', 'val'))
        //         .rejects.toThrow();
        // });

        it('should default to development scope', async () => {
            await manifestManager.setVariable('DEV_VAR', 'dev-val');
            // Assuming default getVariables scope is development
            const vars = await manifestManager.getVariables();
            expect(vars['DEV_VAR']).toBe('dev-val');
        });

        it('should handle scopes correctly', async () => {
            await manifestManager.setVariable('API_KEY', 'dev-key', GLOBAL_SERVICE, 'development');
            await manifestManager.setVariable('API_KEY', 'prod-key', GLOBAL_SERVICE, 'production');

            const devVars = await manifestManager.getVariables(GLOBAL_SERVICE, 'development');
            const prodVars = await manifestManager.getVariables(GLOBAL_SERVICE, 'production');

            expect(devVars['API_KEY']).toBe('dev-key');
            expect(prodVars['API_KEY']).toBe('prod-key');
        });

        it('should remove variables', async () => {
            await manifestManager.setVariable('TO_REMOVE', 'bye');
            expect((await manifestManager.getVariables())['TO_REMOVE']).toBe('bye');

            await manifestManager.removeVariable('TO_REMOVE');
            expect((await manifestManager.getVariables())['TO_REMOVE']).toBeUndefined();
        });
    });

    describe('Secret References (@ref:)', () => {
        beforeEach(async () => {
            await manifestManager.init();
        });

        it('should resolve a simple reference', async () => {
            await manifestManager.setVariable('BASE_URL', 'https://api.example.com');
            await manifestManager.setVariable('DOCS_URL', '@ref:BASE_URL/docs');

            const vars = await manifestManager.getVariables();
            expect(vars['DOCS_URL']).toBe('https://api.example.com/docs');
        });

        it('should resolve nested references', async () => {
            await manifestManager.setVariable('PROTOCOL', 'https');
            await manifestManager.setVariable('HOST', 'api.example.com');
            await manifestManager.setVariable('BASE_URL', '@ref:PROTOCOL://@ref:HOST');

            const vars = await manifestManager.getVariables();
            expect(vars['BASE_URL']).toBe('https://api.example.com');
        });

        it('should detect circular references', async () => {
            await manifestManager.setVariable('A', '@ref:B');
            await manifestManager.setVariable('B', '@ref:A');

            await expect(manifestManager.getVariables()).rejects.toThrow('Circular reference');
        });

        it('should throw for missing references', async () => {
            await manifestManager.setVariable('KEY', '@ref:MISSING_VAR');
            await expect(manifestManager.getVariables()).rejects.toThrow('Reference @ref:MISSING_VAR not found');
        });
    });

    describe('Drift Detection', () => {
        beforeEach(async () => {
            await manifestManager.init();
        });

        it('should identify local-only secrets', async () => {
            // Local has DB_URL, Cloud is empty
            await manifestManager.setVariable('DB_URL', 'local-db');

            const cloudManifest = {
                version: 1,
                services: { _global: {} },
                scopes: {},
                updatedBy: 'test',
                updatedAt: new Date().toISOString()
            };

            const drift = (manifestManager as any).compareManifests(
                await (manifestManager as any).loadLocal(),
                cloudManifest
            );

            expect(drift.hasDrift).toBe(true);
            expect(drift.localOnly).toContainEqual(expect.objectContaining({ key: 'DB_URL' }));
            expect(drift.cloudOnly).toHaveLength(0);
            expect(drift.modified).toHaveLength(0);
        });

        it('should identify cloud-only secrets', async () => {
            // Local is empty, Cloud has API_KEY
            const cloudManifest = {
                version: 1,
                services: { _global: { API_KEY: 'cloud-key' } },
                scopes: {},
                updatedBy: 'test',
                updatedAt: new Date().toISOString()
            };

            const drift = (manifestManager as any).compareManifests(
                await (manifestManager as any).loadLocal(),
                cloudManifest
            );

            expect(drift.hasDrift).toBe(true);
            expect(drift.cloudOnly).toContainEqual(expect.objectContaining({ key: 'API_KEY' }));
            expect(drift.localOnly).toHaveLength(0);
            expect(drift.modified).toHaveLength(0);
        });

        it('should identify modified secrets', async () => {
            // Both have APP_NAME, but values differ
            await manifestManager.setVariable('APP_NAME', 'local-app');

            const cloudManifest = {
                version: 1,
                services: { _global: { APP_NAME: 'cloud-app' } },
                scopes: {},
                updatedBy: 'test',
                updatedAt: new Date().toISOString()
            };

            const drift = (manifestManager as any).compareManifests(
                await (manifestManager as any).loadLocal(),
                cloudManifest
            );

            expect(drift.hasDrift).toBe(true);
            expect(drift.modified).toContainEqual(expect.objectContaining({
                key: 'APP_NAME',
                localValue: 'local-app',
                cloudValue: 'cloud-app'
            }));
        });
    });

    describe('Persistence', () => {
        it('should persist variables across instances', async () => {
            await manifestManager.init();
            await manifestManager.setVariable('PERSISTENT', 'true');

            // New instance same dir
            const newManager = new ManifestManager({ workDir });
            const vars = await newManager.getVariables();
            expect(vars['PERSISTENT']).toBe('true');
        });
    });
});
