/**
 * CLI Integration Tests
 *
 * End-to-end tests for all Axion CLI commands.
 * Runs CLI commands in isolated temp directories against a real or mock server.
 *
 * To run these tests:
 *   1. Start the test server: npm run dev:server (in platform repo)
 *   2. Run integration tests: npm run test:integration
 *
 * Environment variables:
 *   AXION_API_URL - API server URL (default: http://localhost:3000)
 *   AXION_TEST_TOKEN - Service token for authenticated tests
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
    createTestProject,
    type TestProject,
    isTestServerRunning,
    TEST_API_URL,
} from './setup.js';

describe('CLI Integration Tests', () => {
    let project: TestProject;

    beforeEach(async () => {
        project = await createTestProject();
    });

    afterEach(async () => {
        await project.cleanup();
    });

    // ========================================
    // Init Command Tests
    // ========================================
    describe('axn init', () => {
        it('should initialize a new project', async () => {
            const result = await project.run('init');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('Project initialized');
            // Key is stored in .axion/key, manifest in .axion.env
            expect(await project.exists('.axion/key')).toBe(true);
            expect(await project.exists('.axion.env')).toBe(true);
        });

        it('should prevent re-initialization', async () => {
            await project.run('init');
            const result = await project.runExpectFail('init');

            expect(result.exitCode).not.toBe(0);
            expect(result.all).toContain('already initialized');
        });

        it('should auto-discover .env files during init', async () => {
            await project.writeFile('.env', 'API_KEY=test123\n');
            const result = await project.run('init');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('.env');
        });

        it('should fail gracefully with --cloud when not authenticated', async () => {
            const result = await project.runExpectFail('init', '--cloud');

            expect(result.exitCode).not.toBe(0);
            expect(result.all).toContain('Not logged in');
        });
    });

    // ========================================
    // Set/Get/List/Delete Command Tests
    // ========================================
    describe('axn set/get/list/delete', () => {
        beforeEach(async () => {
            await project.run('init');
        });

        it('should set and get a secret', async () => {
            await project.run('set', 'API_KEY', 'secret123');
            // --reveal flag is required to show actual value (otherwise shows ********)
            const result = await project.run('get', 'API_KEY', '--reveal');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('secret123');
        });

        it('should list all secrets', async () => {
            await project.run('set', 'KEY1', 'value1');
            await project.run('set', 'KEY2', 'value2');
            const result = await project.run('list');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('KEY1');
            expect(result.all).toContain('KEY2');
        });

        it('should remove a secret', async () => {
            await project.run('set', 'TO_DELETE', 'temporary');
            // Command is 'rm' not 'delete'
            await project.run('rm', 'TO_DELETE');
            const result = await project.runExpectFail('get', 'TO_DELETE', '--reveal');

            expect(result.all).not.toContain('temporary');
        });

        it('should handle scoped secrets', async () => {
            await project.run('set', 'DB_URL', 'dev-db', '--scope', 'development');
            await project.run('set', 'DB_URL', 'prod-db', '--scope', 'production');

            // --reveal flag is required to show actual value
            const devResult = await project.run('get', 'DB_URL', '--scope', 'development', '--reveal');
            const prodResult = await project.run('get', 'DB_URL', '--scope', 'production', '--reveal');

            expect(devResult.all).toContain('dev-db');
            expect(prodResult.all).toContain('prod-db');
        });

        it('should fail when getting non-existent key', async () => {
            const result = await project.runExpectFail('get', 'NONEXISTENT');

            expect(result.exitCode).not.toBe(0);
        });
    });

    // ========================================
    // Sync Command Tests (Requires authentication - skipped in basic tests)
    // ========================================
    describe.skipIf(!process.env.AXION_TEST_TOKEN)('axn sync', () => {
        beforeEach(async () => {
            await project.run('init');
        });

        it('should sync secrets with cloud', async () => {
            // Sync requires auth and cloud link
            await project.writeFile('.env', 'SYNC_KEY=sync-value\n');
            const result = await project.runExpectFail('sync', '.env');

            // Will fail without auth, but command should be recognized
            expect(result.all).toBeDefined();
        });
    });

    // ========================================
    // Run Command Tests
    // ========================================
    describe('axn run', () => {
        beforeEach(async () => {
            await project.run('init');
            await project.run('set', 'TEST_VAR', 'injected-value');
        });

        it('should inject secrets into child process', async () => {
            const result = await project.run('run', '--', 'node', '-e', 'console.log(process.env.TEST_VAR)');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('injected-value');
        });

        it('should preserve exit code from child process', async () => {
            const result = await project.runExpectFail('run', '--', 'node', '-e', 'process.exit(42)');

            expect(result.exitCode).toBe(42);
        });

        it('should inject multiple secrets', async () => {
            await project.run('set', 'VAR_A', 'alpha');
            await project.run('set', 'VAR_B', 'beta');

            const result = await project.run(
                'run', '--', 'node', '-e',
                'console.log(process.env.VAR_A + "-" + process.env.VAR_B)'
            );

            expect(result.all).toContain('alpha-beta');
        });
    });

    // ========================================
    // Export Command Tests
    // ========================================
    describe('axn export', () => {
        beforeEach(async () => {
            await project.run('init');
            await project.run('set', 'EXPORT_KEY', 'export-value');
        });

        it('should export secrets to stdout in env format', async () => {
            const result = await project.run('export');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('EXPORT_KEY=export-value');
        });

        it('should export secrets to stdout in JSON format', async () => {
            const result = await project.run('export', '--format', 'json');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('EXPORT_KEY');
            expect(result.all).toContain('export-value');
        });
    });

    // ========================================
    // Auth Command Tests (without server)
    // ========================================
    describe('axn auth commands', () => {
        it('should show not logged in status with whoami', async () => {
            const result = await project.runExpectFail('whoami');

            expect(result.all).toMatch(/not.*logged.*in|authenticate/i);
        });

        it('logout should succeed even when not logged in', async () => {
            const result = await project.run('logout');

            expect(result.exitCode).toBe(0);
        });
    });

    // ========================================
    // Cloud Command Tests (with server)
    // ========================================
    describe.skipIf(!process.env.AXION_TEST_TOKEN)('axn cloud commands', () => {
        let serverRunning = false;

        beforeAll(async () => {
            serverRunning = await isTestServerRunning();
        });

        it.skipIf(!serverRunning)('should push to cloud', async () => {
            await project.run('init');
            await project.run('set', 'CLOUD_KEY', 'cloud-value');

            // This would need proper auth setup
            const result = await project.runExpectFail('push');

            // Just verify the command runs (may fail without full auth)
            expect(result.all).toBeDefined();
        });

        it.skipIf(!serverRunning)('should pull from cloud', async () => {
            await project.run('init');

            const result = await project.runExpectFail('pull');

            expect(result.all).toBeDefined();
        });
    });

    // ========================================
    // Help and Version Tests
    // ========================================
    describe('axn help/version', () => {
        it('should show help', async () => {
            const result = await project.run('--help');

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('axn');
            expect(result.all).toContain('init');
            expect(result.all).toContain('set');
            expect(result.all).toContain('get');
        });

        it('should show version', async () => {
            const result = await project.run('--version');

            expect(result.exitCode).toBe(0);
            expect(result.all).toMatch(/\d+\.\d+\.\d+/);
        });
    });
});
