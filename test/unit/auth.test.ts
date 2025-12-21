import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';

// Hoisted Mocks - MUST be before imports of the module under test
vi.mock('node:fs/promises');
vi.mock('node:os', () => ({
    homedir: () => '/mock/home'
}));

// Mock the client module for refresh token tests
const mockRefreshTokens = vi.fn();
vi.mock('../../src/cloud/client.js', () => ({
    createClient: () => ({
        refreshTokens: mockRefreshTokens,
    }),
}));

// Now import the module
import {
    saveCloudConfig,
    loadCloudConfig,
    isAuthenticated,
    clearCredentials,
    getAccessToken,
} from '../../src/cloud/auth.js';

describe('Auth Module', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.AXION_TOKEN;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('Cloud Config', () => {
        it('should save cloud config', async () => {
            const mockCwd = '/test/cwd';
            const config = {
                projectId: 'p1',
                apiUrl: 'http://api',
                linkedAt: '2024-01-01'
            };

            await saveCloudConfig(mockCwd, config);

            expect(fs.mkdir).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalled();
            const writeCall = (fs.writeFile as any).mock.calls[0];
            expect(writeCall[1]).toContain('projectId');
        });

        it('should load cloud config', async () => {
            const mockCwd = '/test/cwd';
            const config = { projectId: 'p1' };

            (fs.readFile as any).mockResolvedValue(JSON.stringify(config));

            const result = await loadCloudConfig(mockCwd);
            expect(result).toEqual(config);
        });

        it('should return null if config missing', async () => {
            const error: any = new Error('ENOENT');
            error.code = 'ENOENT';
            (fs.readFile as any).mockRejectedValue(error);

            const result = await loadCloudConfig('/test');
            expect(result).toBeNull();
        });
    });

    describe('Credentials', () => {
        it('should report unauthenticated if no credentials', async () => {
            const error: any = new Error('ENOENT');
            error.code = 'ENOENT';
            (fs.readFile as any).mockRejectedValue(error);

            expect(await isAuthenticated()).toBe(false);
        });

        it('should report authenticated if valid credentials', async () => {
            (fs.readFile as any).mockResolvedValue(JSON.stringify({
                tokens: { accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 10000 }
            }));

            // Should pass access check
            (fs.access as any).mockResolvedValue(undefined);

            expect(await isAuthenticated()).toBe(true);
        });

        it('should clear credentials on logout', async () => {
            await clearCredentials();
            expect(fs.unlink).toHaveBeenCalled();
        });
    });

    describe('getAccessToken', () => {
        it('should return AXION_TOKEN when set (service token)', async () => {
            process.env.AXION_TOKEN = 'service-token-123';

            const token = await getAccessToken();

            expect(token).toBe('service-token-123');
            expect(fs.readFile).not.toHaveBeenCalled();
        });

        it('should throw error when not logged in', async () => {
            const error: any = new Error('ENOENT');
            error.code = 'ENOENT';
            (fs.readFile as any).mockRejectedValue(error);

            await expect(getAccessToken()).rejects.toThrow('Not logged in');
        });

        it('should return valid token without refresh', async () => {
            const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            (fs.readFile as any).mockResolvedValue(JSON.stringify({
                user: { id: 'u1', email: 'test@test.com' },
                tokens: {
                    accessToken: 'valid-token',
                    refreshToken: 'refresh-token',
                    expiresAt: futureExpiry
                },
                apiUrl: 'https://api.test.com'
            }));

            const token = await getAccessToken();

            expect(token).toBe('valid-token');
            expect(mockRefreshTokens).not.toHaveBeenCalled();
        });

        it('should auto-refresh token when within 5 minute buffer', async () => {
            const nearExpiry = Math.floor(Date.now() / 1000) + 200; // 3 minutes from now (within 5 min buffer)
            const newFutureExpiry = Math.floor(Date.now() / 1000) + 3600;

            (fs.readFile as any).mockResolvedValue(JSON.stringify({
                user: { id: 'u1', email: 'test@test.com', name: 'Test', createdAt: '2024-01-01' },
                tokens: {
                    accessToken: 'old-token',
                    refreshToken: 'old-refresh-token',
                    expiresAt: nearExpiry
                },
                apiUrl: 'https://api.test.com'
            }));

            mockRefreshTokens.mockResolvedValue({
                accessToken: 'new-token',
                refreshToken: 'new-refresh-token',
                expiresAt: newFutureExpiry
            });

            const token = await getAccessToken();

            expect(token).toBe('new-token');
            expect(mockRefreshTokens).toHaveBeenCalledWith('old-refresh-token');
            expect(fs.writeFile).toHaveBeenCalled();
        });

        it('should throw session expired when refresh fails', async () => {
            const nearExpiry = Math.floor(Date.now() / 1000) + 100; // Within buffer

            (fs.readFile as any).mockResolvedValue(JSON.stringify({
                user: { id: 'u1', email: 'test@test.com' },
                tokens: {
                    accessToken: 'expired-token',
                    refreshToken: 'invalid-refresh-token',
                    expiresAt: nearExpiry
                },
                apiUrl: 'https://api.test.com'
            }));

            mockRefreshTokens.mockRejectedValue(new Error('Refresh token expired'));

            await expect(getAccessToken()).rejects.toThrow('Session expired');
        });
    });
});
