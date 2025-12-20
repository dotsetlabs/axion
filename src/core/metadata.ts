/**
 * Axion Device Metadata
 *
 * Collects device information for audit logging and analytics.
 * Generates a persistent, cryptographically random device ID.
 *
 * Security:
 * - Device ID is generated using crypto.randomUUID() for uniqueness
 * - ID is persisted to avoid regeneration on each request
 * - No PII is collected - only technical device information
 */

import { hostname, platform, arch, release } from 'node:os';
import { version as nodeVersion } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

/** Device ID file path */
const DEVICE_ID_FILE = join(homedir(), '.axion', 'device-id');

export interface DeviceMetadata {
    /** Unique device identifier (UUID v4) */
    deviceId: string;
    /** Machine hostname */
    hostname: string;
    /** Operating system platform */
    platform: string;
    /** CPU architecture */
    arch: string;
    /** OS release version */
    osRelease: string;
    /** Node.js version */
    nodeVersion: string;
    /** CLI version */
    cliVersion: string;
    /** Request timestamp */
    timestamp: string;
}

/** Cached device ID to avoid repeated file reads */
let cachedDeviceId: string | null = null;

/**
 * Gets or generates a persistent, cryptographically random device ID
 *
 * The ID is stored in ~/.axion/device-id and persists across CLI invocations.
 * Uses crypto.randomUUID() for cryptographic uniqueness.
 *
 * @returns A UUID v4 string uniquely identifying this device
 */
async function getDeviceId(): Promise<string> {
    // Return cached value if available
    if (cachedDeviceId) {
        return cachedDeviceId;
    }

    try {
        // Try to read existing device ID
        const existingId = await readFile(DEVICE_ID_FILE, 'utf8');
        const trimmedId = existingId.trim();

        // Validate it's a proper UUID format
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmedId)) {
            cachedDeviceId = trimmedId;
            return trimmedId;
        }
    } catch {
        // File doesn't exist or is unreadable - generate new ID
    }

    // Generate new cryptographically random UUID
    const newId = randomUUID();

    try {
        // Persist the new ID
        const dir = join(homedir(), '.axion');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(DEVICE_ID_FILE, newId, { encoding: 'utf8', mode: 0o600 });
        cachedDeviceId = newId;
    } catch {
        // If we can't persist, still use the generated ID for this session
        cachedDeviceId = newId;
    }

    return newId;
}

/**
 * Collects device metadata for audit logs and analytics
 *
 * This information is sent with API requests to:
 * - Enable audit logging of which devices accessed secrets
 * - Help debug issues across different environments
 * - Track CLI version distribution for deprecation planning
 *
 * @returns Device metadata object
 */
export async function getDeviceMetadata(): Promise<DeviceMetadata> {
    return {
        deviceId: await getDeviceId(),
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        osRelease: release(),
        nodeVersion: nodeVersion,
        cliVersion: pkg.version,
        timestamp: new Date().toISOString(),
    };
}
