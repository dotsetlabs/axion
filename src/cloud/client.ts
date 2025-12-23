/**
 * Axion Cloud API Client
 *
 * Handles all communication with the Axion cloud service.
 *
 * Features:
 * - Automatic token injection
 * - Access verification before sensitive operations
 * - Audit logging of all actions
 */

import { getDeviceMetadata } from '../core/metadata.js';
import {
    getAccessToken,
    saveCredentials,
} from './auth.js';
import type {
    User,
    AccessCheckResult,
    CloudManifest,
    SyncRequest,
    SyncResponse,
    ApiError,
    AuditLogEntry,
    CloudManifestHistory,
    DeviceCodeResponse,
    DevicePollResponse,
    RefreshResponse,
} from './types.js';

/** Default API URL - set to local dev server, update for production */
const DEFAULT_API_URL = process.env.AXION_API_URL ?? 'https://api.dotsetlabs.com';

/**
 * Get headers with optional beta password for private beta access.
 * Set DOTSET_BETA_PASSWORD env var to authenticate against beta API.
 */
function getBaseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    const betaPassword = process.env.DOTSET_BETA_PASSWORD;
    if (betaPassword) {
        headers['X-Beta-Password'] = betaPassword;
    }

    return headers;
}

/**
 * API client configuration
 */
export interface ClientConfig {
    apiUrl?: string;
}

/**
 * Creates an API client instance
 */
export function createClient(config: ClientConfig = {}) {
    const apiUrl = config.apiUrl ?? DEFAULT_API_URL;

    /**
     * Makes an authenticated API request
     */
    async function request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const token = await getAccessToken();
        const url = `${apiUrl}${path}`;
        const metadata = await getDeviceMetadata();

        const response = await fetch(url, {
            method,
            headers: {
                ...getBaseHeaders(),
                'Authorization': `Bearer ${token}`,
                'X-Axion-Metadata': JSON.stringify(metadata),
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const error = (await response.json()) as ApiError;
            if (response.status === 401 && (error as { code?: string }).code === 'BETA_ACCESS_REQUIRED') {
                throw new Error('Beta access required. Set DOTSET_BETA_PASSWORD environment variable.');
            }
            throw new Error(error.message || `API error: ${response.status}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Makes an unauthenticated API request (for login)
     */
    async function publicRequest<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const url = `${apiUrl}${path}`;

        const response = await fetch(url, {
            method,
            headers: getBaseHeaders(),
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const error = (await response.json()) as ApiError;
            throw new Error(error.message || `API error: ${response.status}`);
        }

        return response.json() as Promise<T>;
    }

    return {
        /**
         * Initiates the Device Code Flow for CLI authentication (GitHub)
         * Returns the user code and verification URL to display
         */
        async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
            return publicRequest<DeviceCodeResponse>('POST', '/auth/device');
        },

        /**
         * Polls for GitHub device authorization status
         * Call this repeatedly until status is 'complete'
         */
        async pollDeviceFlow(deviceCode: string): Promise<DevicePollResponse> {
            return publicRequest<DevicePollResponse>('POST', '/auth/device/poll', { deviceCode });
        },

        /**
         * Initiates the Device Code Flow for CLI authentication (Google)
         * Returns the user code and verification URL to display
         */
        async initiateGoogleDeviceFlow(): Promise<DeviceCodeResponse> {
            return publicRequest<DeviceCodeResponse>('POST', '/auth/device/google');
        },

        /**
         * Polls for Google device authorization status
         * Call this repeatedly until status is 'complete'
         */
        async pollGoogleDeviceFlow(deviceCode: string): Promise<DevicePollResponse> {
            return publicRequest<DevicePollResponse>('POST', '/auth/device/google/poll', { deviceCode });
        },

        /**
         * Saves credentials after successful device flow authorization
         */
        async completeDeviceFlow(response: DevicePollResponse): Promise<User> {
            if (response.status !== 'complete' || !response.user || !response.tokens) {
                throw new Error('Device flow not complete');
            }
            await saveCredentials(response.user, response.tokens, apiUrl);
            return response.user;
        },

        /**
         * Refreshes tokens using a valid refresh token
         * Returns new access and refresh tokens (sliding window)
         */
        async refreshTokens(refreshToken: string): Promise<RefreshResponse> {
            return publicRequest<RefreshResponse>('POST', '/auth/refresh', { refreshToken });
        },

        /**
         * Creates a new project in the cloud
         */
        async createProject(name: string, keyFingerprint?: string): Promise<{ id: string; name: string }> {
            return request<{ id: string; name: string }>('POST', '/axion/projects', { name, keyFingerprint });
        },

        /**
         * Sends a heartbeat pulse to the cloud
         * Returns a session token if access is granted (JIT)
         */
        async pulse(projectId: string): Promise<string> {
            const response = await request<{ token: string }>('POST', `/axion/projects/${projectId}/pulse`);
            return response.token;
        },

        /**
         * Checks if user has access to a project
         */
        async checkAccess(projectId: string): Promise<AccessCheckResult> {
            return request<AccessCheckResult>('GET', `/axion/projects/${projectId}/access`);
        },

        /**
         * Fetches the encrypted manifest from cloud
         */
        async fetchManifest(projectId: string): Promise<CloudManifest> {
            const response = await request<SyncResponse>(
                'GET',
                `/axion/projects/${projectId}/manifest`
            );
            return response.manifest;
        },

        /**
         * Uploads encrypted manifest to cloud
         */
        async uploadManifest(
            projectId: string,
            encryptedData: string,
            keyFingerprint: string
        ): Promise<CloudManifest> {
            const response = await request<SyncResponse>(
                'PUT',
                `/axion/projects/${projectId}/manifest`,
                { projectId, encryptedData, keyFingerprint } as SyncRequest
            );
            return response.manifest;
        },

        /**
         * Gets current user info
         */
        async getCurrentUser(): Promise<User> {
            return request<User>('GET', '/auth/me');
        },

        /**
         * Fetches audit logs for the project
         */
        async fetchAuditLogs(projectId: string): Promise<AuditLogEntry[]> {
            return request<AuditLogEntry[]>('GET', `/axion/projects/${projectId}/audit`);
        },

        /**
         * Fetches version history
         */
        async fetchHistory(projectId: string): Promise<CloudManifestHistory[]> {
            return request<CloudManifestHistory[]>('GET', `/axion/projects/${projectId}/history`);
        },

        /**
         * Rolls back to a specific version
         */
        async rollback(projectId: string, version: number): Promise<void> {
            await request<{ success: boolean; newVersion: number }>('POST', `/axion/projects/${projectId}/rollback`, { version });
        },

        /**
         * Gets project members
         */
        async getMembers(projectId: string): Promise<{ id: string; userId: string; userEmail: string; role: string; revokedAt: string | null }[]> {
            return request('GET', `/axion/projects/${projectId}/members`);
        },

        /**
         * Adds a member to a project
         */
        async addMember(projectId: string, email: string, role: string = 'member'): Promise<{ id: string; userId: string; userEmail: string; role: string }> {
            return request('POST', `/axion/projects/${projectId}/members`, { email, role });
        },

        /**
         * Revokes a member's access
         */
        async revokeMember(projectId: string, userId: string): Promise<void> {
            await request('PATCH', `/axion/projects/${projectId}/members/${userId}/revoke`);
        },

        // --- Service Tokens ---

        /**
         * Creates a new service token for CI/CD
         */
        async createToken(
            projectId: string,
            name: string,
            scopes: string[] = ['read'],
            expiresInDays?: number
        ): Promise<{ id: string; name: string; token: string; tokenPrefix: string; scopes: string[]; expiresAt: string | null }> {
            return request('POST', `/axion/projects/${projectId}/tokens`, { name, scopes, expiresInDays });
        },

        /**
         * Lists all service tokens for a project
         */
        async listTokens(projectId: string): Promise<{
            id: string;
            name: string;
            tokenPrefix: string;
            scopes: string[];
            createdBy: string;
            lastUsedAt: string | null;
            expiresAt: string | null;
            revokedAt: string | null;
            createdAt: string;
            isActive: boolean;
        }[]> {
            return request('GET', `/axion/projects/${projectId}/tokens`);
        },

        /**
         * Revokes a service token
         */
        async revokeToken(projectId: string, tokenId: string): Promise<void> {
            await request('DELETE', `/axion/projects/${projectId}/tokens/${tokenId}`);
        },

        /**
         * Export secrets for CI/CD (used by GitHub Action)
         */
        async exportSecrets(projectId: string, scope?: string): Promise<{ secrets: Record<string, string> }> {
            const params = scope ? `?scope=${scope}` : '';
            return request('GET', `/axion/projects/${projectId}/secrets${params}`);
        },

        // --- Project Management ---

        /**
         * Deletes a project (soft delete, owner only)
         * @returns Deletion confirmation with side effects info
         */
        async deleteProject(projectId: string): Promise<{
            success: boolean;
            message: string;
            deletedAt: string;
            sideEffects: {
                membersRevoked: number;
                manifests: number;
            };
        }> {
            return request('DELETE', `/axion/projects/${projectId}`);
        },

        /**
         * Updates a project (e.g. name or fingerprint)
         */
        async updateProject(projectId: string, updates: { name?: string; keyFingerprint?: string }): Promise<void> {
            return request('PATCH', `/axion/projects/${projectId}`, updates);
        },

        /**
         * Lists all projects the user has access to
         */
        async listProjects(): Promise<{
            id: string;
            name: string;
            ownerId: string;
            keyFingerprint: string;
            createdAt: string;
            updatedAt: string;
        }[]> {
            return request('GET', '/axion/projects');
        }
    };
}

/**
 * Default client instance
 */
export const cloudClient = createClient();

/**
 * Re-export AxionCloudClient type for backwards compatibility
 */
export type AxionCloudClient = ReturnType<typeof createClient>;
