/**
 * Axion Cloud Types
 *
 * Shared type definitions for cloud API interactions.
 * These types define the contract between CLI and cloud service.
 */

/**
 * User information returned from authentication
 */
export interface User {
    id: string;
    email: string;
    name?: string;
    createdAt: string;
}

/**
 * Authentication tokens
 */
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix timestamp
}

/**
 * Project information
 */
export interface Project {
    id: string;
    name: string;
    ownerId: string;
    keyFingerprint: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Project member with role and access status
 */
export interface ProjectMember {
    userId: string;
    email: string;
    role: 'admin' | 'member' | 'readonly';
    revokedAt: string | null;
}

/**
 * Access check result
 */
export interface AccessCheckResult {
    hasAccess: boolean;
    role: 'admin' | 'member' | 'readonly' | null;
    reason?: string;
    project?: {
        id: string;
        name: string;
        keyFingerprint: string;
    };
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
    id: string;
    projectId: string;
    userId: string;
    userEmail: string;
    action: AuditAction;
    ipAddress: string;
    createdAt: string;
}

/**
 * Supported audit actions
 */
export type AuditAction =
    | 'secret.read'
    | 'secret.write'
    | 'secret.delete'
    | 'project.sync'
    | 'member.add'
    | 'member.remove'
    | 'member.revoke'
    | 'key.rotate';

/**
 * Cloud manifest wrapper with metadata
 */
export interface CloudManifest {
    projectId: string;
    encryptedData: string;
    version: number;
    updatedAt: string;
    updatedBy: string;
}

/**
 * Local project configuration (stored in .axion/cloud.json)
 */
export interface CloudConfig {
    projectId: string;
    apiUrl: string;
    linkedAt: string;
}

/**
 * API error response
 */
export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Login response
 */
export interface LoginResponse {
    user: User;
    tokens: AuthTokens;
}

/**
 * Device Code Flow - Initial response
 */
export interface DeviceCodeResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
}

/**
 * Device Code Flow - Poll response
 */
export interface DevicePollResponse {
    status: 'pending' | 'slow_down' | 'complete';
    user?: User;
    tokens?: AuthTokens;
}

/**
 * Token refresh response
 */
export interface RefreshResponse {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

/**
 * Sync request payload
 */
export interface SyncRequest {
    projectId: string;
    encryptedData: string;
    keyFingerprint: string;
    localVersion?: number;
}

/**
 * Sync response
 */
export interface SyncResponse {
    manifest: CloudManifest;
    conflict: boolean;
}

/**
 * Manifest History Entry
 */
export interface CloudManifestHistory {
    version: number;
    updatedAt: string;
    updatedBy: string;
    keyFingerprint: string;
    encryptedData?: string;
}

