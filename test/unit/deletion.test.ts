import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient } from '../../src/cloud/client.js';

// Mock internal dependencies
vi.mock('../../src/cloud/auth.js', () => ({
    getAccessToken: vi.fn(() => Promise.resolve('mock-token')),
    saveCredentials: vi.fn(),
    getCredentials: vi.fn(),
}));

vi.mock('../../src/core/metadata.js', () => ({
    getDeviceMetadata: vi.fn(() => Promise.resolve({
        os: 'mac',
        version: '1.0.0',
        deviceId: 'mock-device'
    })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Axion Cloud Client - Deletion', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should delete a project successfully', async () => {
        const client = createClient();
        const projectId = 'test-proj-123';

        // Mock successful response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                message: 'Project deleted',
                deletedAt: new Date().toISOString(),
                sideEffects: {
                    membersRevoked: 2,
                    manifests: 5
                }
            })
        });

        const result = await client.deleteProject(projectId);

        // Verify request
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining(`/projects/${projectId}`),
            expect.objectContaining({
                method: 'DELETE',
                headers: expect.objectContaining({
                    'Authorization': expect.any(String)
                })
            })
        );

        // Verify response
        expect(result.success).toBe(true);
        expect(result.sideEffects.membersRevoked).toBe(2);
        expect(result.sideEffects.manifests).toBe(5);
    });

    it('should handle deletion errors', async () => {
        const client = createClient();
        const projectId = 'test-proj-404';

        // Mock error response
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({
                code: 'NOT_FOUND',
                message: 'Project not found'
            })
        });

        await expect(client.deleteProject(projectId)).rejects.toThrow('Project not found');
    });
});
