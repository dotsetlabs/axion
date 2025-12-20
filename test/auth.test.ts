import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

// Hoisted Mocks - MUST be before imports of the module under test
vi.mock('node:fs/promises');
vi.mock('node:os', () => ({
    homedir: () => '/mock/home'
}));

// Now import the module
import {
    saveCloudConfig,
    loadCloudConfig,
    isAuthenticated,
    clearCredentials
} from '../src/cloud/auth.js';

describe('Auth Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
