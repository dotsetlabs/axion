import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createClient } from '../../src/cloud/client.js';

/**
 * Client Integration Tests
 * 
 * These tests require a running backend server at http://localhost:3000
 * They are skipped by default for CI - run manually with:
 *   AXION_INTEGRATION_TESTS=true npm test
 * 
 * NOTE: The server now uses SSO-only authentication (GitHub/Google).
 * Integration tests require a valid AXION_TOKEN (service token) to be set.
 */

const INTEGRATION_TESTS_ENABLED = process.env.AXION_INTEGRATION_TESTS === 'true';

// Mock fetch global for unit tests
const mockFetch = vi.fn();

describe('Axion Cloud Client', () => {
    describe('createClient', () => {
        it('should create client with default API URL', () => {
            const client = createClient();
            expect(client).toBeDefined();
            expect(typeof client.pulse).toBe('function');
            expect(typeof client.checkAccess).toBe('function');
            expect(typeof client.fetchManifest).toBe('function');
            expect(typeof client.uploadManifest).toBe('function');
            expect(typeof client.fetchHistory).toBe('function');
            expect(typeof client.rollback).toBe('function');
            expect(typeof client.fetchAuditLogs).toBe('function');
            expect(typeof client.getCurrentUser).toBe('function');
            expect(typeof client.createToken).toBe('function');
            expect(typeof client.listTokens).toBe('function');
            expect(typeof client.revokeToken).toBe('function');
            expect(typeof client.exportSecrets).toBe('function');
            expect(typeof client.refreshTokens).toBe('function');
        });

        it('should create client with custom API URL', () => {
            const client = createClient({ apiUrl: 'https://custom.api.com' });
            expect(client).toBeDefined();
        });
    });

    describe.skipIf(!INTEGRATION_TESTS_ENABLED)('Integration Tests', () => {
        let client: ReturnType<typeof createClient>;

        beforeAll(async () => {
            client = createClient({ apiUrl: 'http://localhost:3000' });
            // Note: Server uses SSO-only auth. These tests require a valid service token.
            // Set AXION_TOKEN environment variable with a valid service token.
            if (!process.env.AXION_TOKEN) {
                throw new Error('AXION_TOKEN is required for integration tests. Server uses SSO-only authentication.');
            }
        });

        it('should upload and fetch manifest', async () => {
            await client.uploadManifest('test-project', 'encrypted-data', 'fingerprint');
            const result = await client.fetchManifest('test-project');
            expect(result.encryptedData).toBe('encrypted-data');
        });

        it('should track history on upload', async () => {
            await client.uploadManifest('history-test', 'v1', 'fp1');
            await client.uploadManifest('history-test', 'v2', 'fp2');
            const history = await client.fetchHistory('history-test');
            expect(history.length).toBeGreaterThanOrEqual(2);
        });
    });
});

