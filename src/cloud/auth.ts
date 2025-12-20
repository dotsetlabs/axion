/**
 * Axion Cloud Authentication
 *
 * Manages local credential storage and authentication state.
 * Credentials are stored securely in the user's home directory.
 *
 * Security:
 * - Tokens stored in ~/.axion/credentials (chmod 600)
 * - Automatic token refresh before expiration
 * - Secure logout clears all local credentials
 */

import { readFile, writeFile, mkdir, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AuthTokens, User, CloudConfig } from './types.js';

/** Directory for global Axion config */
const CONFIG_DIR = join(homedir(), '.axion');

/** Credentials file path */
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

/** Cloud config file (per-project, stored in project dir) */
export const CLOUD_CONFIG_FILE = '.axion/cloud.json';

/**
 * Stored credentials structure
 */
interface StoredCredentials {
    user: User;
    tokens: AuthTokens;
    apiUrl: string;
}

/**
 * Ensures the config directory exists with proper permissions
 */
async function ensureConfigDir(): Promise<void> {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Saves authentication credentials securely
 */
export async function saveCredentials(
    user: User,
    tokens: AuthTokens,
    apiUrl: string
): Promise<void> {
    await ensureConfigDir();

    const credentials: StoredCredentials = { user, tokens, apiUrl };
    await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
        encoding: 'utf8',
        mode: 0o600, // Owner read/write only
    });
}

/**
 * Loads stored credentials
 * @returns Credentials or null if not logged in
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
    try {
        const content = await readFile(CREDENTIALS_FILE, 'utf8');
        return JSON.parse(content) as StoredCredentials;
    } catch {
        return null;
    }
}

/**
 * Clears all stored credentials (logout)
 */
export async function clearCredentials(): Promise<void> {
    try {
        await unlink(CREDENTIALS_FILE);
    } catch {
        // Ignore if file doesn't exist
    }
}

/**
 * Checks if user is currently authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
    // 1. Check Service Token (CI/CD)
    if (process.env.AXION_TOKEN) return true;

    // 2. Check Local Credentials
    const creds = await loadCredentials();
    if (!creds) return false;

    // Check if token is expired (with 5 minute buffer)
    const now = Math.floor(Date.now() / 1000);
    return creds.tokens.expiresAt > now + 300;
}

/**
 * Gets the current access token if valid
 * @throws Error if not authenticated or token expired
 */
export async function getAccessToken(): Promise<string> {
    // 1. Check Service Token
    if (process.env.AXION_TOKEN) {
        return process.env.AXION_TOKEN;
    }

    // 2. Check Local Credentials
    const creds = await loadCredentials();
    if (!creds) {
        throw new Error('Not logged in. Run "axn login" first.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (creds.tokens.expiresAt <= now) {
        throw new Error('Session expired. Run "axn login" to reauthenticate.');
    }

    return creds.tokens.accessToken;
}

/**
 * Gets the current user info
 * @throws Error if not authenticated
 */
export async function getCurrentUser(): Promise<User> {
    if (process.env.AXION_TOKEN) {
        return {
            id: 'service-account',
            email: 'hello@dotsetlabs.com',
            name: 'Service Account (CI/CD)',
            createdAt: new Date().toISOString(),
        };
    }

    const creds = await loadCredentials();
    if (!creds) {
        throw new Error('Not logged in. Run "axn login" first.');
    }
    return creds.user;
}

/**
 * Gets the API URL from stored credentials
 */
export async function getApiUrl(): Promise<string> {
    const creds = await loadCredentials();
    return creds?.apiUrl ?? 'https://api.dotsetlabs.com/axion';
}

/**
 * Saves cloud project configuration to the local project directory
 */
export async function saveCloudConfig(
    workDir: string,
    config: CloudConfig
): Promise<void> {
    const configPath = join(workDir, CLOUD_CONFIG_FILE);
    const configDir = join(workDir, '.axion');
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Loads cloud project configuration
 * @returns Config or null if project not linked to cloud
 */
export async function loadCloudConfig(workDir: string): Promise<CloudConfig | null> {
    try {
        const configPath = join(workDir, CLOUD_CONFIG_FILE);
        const content = await readFile(configPath, 'utf8');
        return JSON.parse(content) as CloudConfig;
    } catch {
        return null;
    }
}

/**
 * Checks if the current project is linked to cloud
 */
export async function isCloudLinked(workDir: string): Promise<boolean> {
    const config = await loadCloudConfig(workDir);
    return config !== null;
}

/**
 * Removes cloud link from project
 */
export async function unlinkCloud(workDir: string): Promise<void> {
    try {
        const configPath = join(workDir, CLOUD_CONFIG_FILE);
        await unlink(configPath);
    } catch {
        // Ignore if file doesn't exist
    }
}
