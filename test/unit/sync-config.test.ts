/**
 * Tests for Sync Config Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
    inferScopeFromFilename,
    inferServiceFromPath,
    discoverEnvFiles,
    loadSyncConfig,
    saveSyncConfig,
    createEmptySyncConfig,
    toSyncEntries,
    getEnabledFiles,
    formatDiscoveredFiles,
    mergeDiscoveredFiles,
} from '../../src/core/sync-config.js';

const TEST_DIR = join(process.cwd(), '.test-sync-config');

describe('Sync Config', () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
        await mkdir(join(TEST_DIR, '.dotset', 'axion'), { recursive: true });
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    describe('inferScopeFromFilename', () => {
        it('should infer development for .env', () => {
            expect(inferScopeFromFilename('.env')).toBe('development');
        });

        it('should infer development for .env.local', () => {
            expect(inferScopeFromFilename('.env.local')).toBe('development');
        });

        it('should infer development for .env.development', () => {
            expect(inferScopeFromFilename('.env.development')).toBe('development');
        });

        it('should infer staging for .env.staging', () => {
            expect(inferScopeFromFilename('.env.staging')).toBe('staging');
        });

        it('should infer staging for .env.stage', () => {
            expect(inferScopeFromFilename('.env.stage')).toBe('staging');
        });

        it('should infer production for .env.production', () => {
            expect(inferScopeFromFilename('.env.production')).toBe('production');
        });

        it('should infer production for .env.prod', () => {
            expect(inferScopeFromFilename('.env.prod')).toBe('production');
        });
    });

    describe('inferServiceFromPath', () => {
        it('should return undefined for root level files', () => {
            expect(inferServiceFromPath('.env')).toBeUndefined();
        });

        it('should infer service from apps/ directory', () => {
            expect(inferServiceFromPath('apps/api/.env')).toBe('api');
        });

        it('should infer service from packages/ directory', () => {
            expect(inferServiceFromPath('packages/web/.env')).toBe('web');
        });

        it('should infer service from services/ directory', () => {
            expect(inferServiceFromPath('services/auth/.env')).toBe('auth');
        });

        it('should use parent directory for other structures', () => {
            expect(inferServiceFromPath('backend/.env')).toBe('backend');
        });
    });

    describe('discoverEnvFiles', () => {
        it('should discover .env files', async () => {
            await writeFile(join(TEST_DIR, '.env'), 'FOO=bar\nBAZ=qux');
            await writeFile(join(TEST_DIR, '.env.production'), 'API_KEY=secret');

            const discovered = await discoverEnvFiles(TEST_DIR);

            expect(discovered).toHaveLength(2);
            expect(discovered[0].relativePath).toBe('.env');
            expect(discovered[0].inferredScope).toBe('development');
            expect(discovered[0].variableCount).toBe(2);

            expect(discovered[1].relativePath).toBe('.env.production');
            expect(discovered[1].inferredScope).toBe('production');
            expect(discovered[1].variableCount).toBe(1);
        });

        it('should discover nested .env files in monorepo', async () => {
            await mkdir(join(TEST_DIR, 'apps', 'api'), { recursive: true });
            await writeFile(join(TEST_DIR, 'apps', 'api', '.env'), 'PORT=3000');

            const discovered = await discoverEnvFiles(TEST_DIR);

            expect(discovered).toHaveLength(1);
            expect(discovered[0].relativePath).toBe('apps/api/.env');
            expect(discovered[0].inferredService).toBe('api');
        });

        it('should skip node_modules', async () => {
            await mkdir(join(TEST_DIR, 'node_modules', 'some-package'), { recursive: true });
            await writeFile(join(TEST_DIR, 'node_modules', 'some-package', '.env'), 'SHOULD_SKIP=true');

            const discovered = await discoverEnvFiles(TEST_DIR);

            expect(discovered).toHaveLength(0);
        });
    });

    describe('loadSyncConfig / saveSyncConfig', () => {
        it('should return null for non-existent config', async () => {
            const config = await loadSyncConfig(TEST_DIR);
            expect(config).toBeNull();
        });

        it('should save and load config', async () => {
            const config = createEmptySyncConfig();
            config.files = [
                { path: '.env', scope: 'development' },
                { path: '.env.production', scope: 'production' },
            ];

            await saveSyncConfig(config, TEST_DIR);
            const loaded = await loadSyncConfig(TEST_DIR);

            expect(loaded).not.toBeNull();
            expect(loaded!.version).toBe('1');
            expect(loaded!.files).toHaveLength(2);
            expect(loaded!.files[0].path).toBe('.env');
        });
    });

    describe('toSyncEntries', () => {
        it('should convert discovered files to sync entries', () => {
            const discovered = [
                {
                    absolutePath: '/test/.env',
                    relativePath: '.env',
                    inferredScope: 'development' as const,
                    inferredService: undefined,
                    variableCount: 5,
                },
                {
                    absolutePath: '/test/apps/api/.env',
                    relativePath: 'apps/api/.env',
                    inferredScope: 'development' as const,
                    inferredService: 'api',
                    variableCount: 3,
                },
            ];

            const entries = toSyncEntries(discovered);

            expect(entries).toHaveLength(2);
            expect(entries[0].path).toBe('.env');
            expect(entries[0].scope).toBe('development');
            expect(entries[0].enabled).toBe(true);
            expect(entries[1].service).toBe('api');
        });
    });

    describe('getEnabledFiles', () => {
        it('should filter enabled files', () => {
            const config = createEmptySyncConfig();
            config.files = [
                { path: '.env', scope: 'development', enabled: true },
                { path: '.env.old', scope: 'development', enabled: false },
                { path: '.env.production', scope: 'production' }, // undefined = enabled
            ];

            const enabled = getEnabledFiles(config);

            expect(enabled).toHaveLength(2);
            expect(enabled.map(f => f.path)).toContain('.env');
            expect(enabled.map(f => f.path)).toContain('.env.production');
        });
    });

    describe('mergeDiscoveredFiles', () => {
        it('should add new files without duplicating existing', () => {
            const config = createEmptySyncConfig();
            config.files = [{ path: '.env', scope: 'development' }];

            const discovered = [
                {
                    absolutePath: '/test/.env',
                    relativePath: '.env',
                    inferredScope: 'development' as const,
                    inferredService: undefined,
                    variableCount: 5,
                },
                {
                    absolutePath: '/test/.env.production',
                    relativePath: '.env.production',
                    inferredScope: 'production' as const,
                    inferredService: undefined,
                    variableCount: 3,
                },
            ];

            const merged = mergeDiscoveredFiles(config, discovered);

            expect(merged.files).toHaveLength(2);
            expect(merged.files[0].path).toBe('.env');
            expect(merged.files[1].path).toBe('.env.production');
        });
    });

    describe('formatDiscoveredFiles', () => {
        it('should format empty list', () => {
            expect(formatDiscoveredFiles([])).toBe('No .env files found.');
        });

        it('should format files with details', () => {
            const discovered = [
                {
                    absolutePath: '/test/.env',
                    relativePath: '.env',
                    inferredScope: 'development' as const,
                    inferredService: undefined,
                    variableCount: 5,
                },
            ];

            const output = formatDiscoveredFiles(discovered);
            expect(output).toContain('.env');
            expect(output).toContain('5 vars');
            expect(output).toContain('development');
        });
    });
});
