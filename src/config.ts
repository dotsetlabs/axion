/**
 * Axion Project Configuration
 *
 * Loads and validates project-level configuration from .dotset/axion/config.yaml.
 * Supports protected keys, validation patterns, and heartbeat enforcement.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'yaml';

/**
 * Axion Project Configuration
 */
export interface AxionConfig {
    /** Project ID */
    project_id?: string;
    /** Enforce heartbeat check */
    enforce_heartbeat?: boolean;
    /** Offline grace period (e.g. "1h") */
    offline_grace_period?: string;
    /** Keys that are write-only (always masked) */
    protected_keys?: string[];
    /** Validation rules for secrets */
    validation?: Record<string, string>;
}

/** Config filename */
export const CONFIG_FILENAME = '.dotset/axion/config.yaml';

/**
 * Loads the project configuration
 */
export async function loadConfig(workDir: string = process.cwd()): Promise<AxionConfig | null> {
    const configPath = join(workDir, CONFIG_FILENAME);
    try {
        const content = await readFile(configPath, 'utf8');
        return yaml.parse(content) as AxionConfig;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw new Error(`Failed to parse ${CONFIG_FILENAME}: ${(error as Error).message}`);
    }
}

/**
 * Validates a secret against the config rules
 */
export function validateSecret(key: string, value: string, config: AxionConfig | null): void {
    if (!config || !config.validation || !config.validation[key]) {
        return;
    }

    const pattern = config.validation[key];
    const regex = new RegExp(pattern);

    if (!regex.test(value)) {
        throw new Error(`Value for ${key} does not match validation pattern: ${pattern}`);
    }
}

/**
 * Checks if a key is protected (write-only)
 */
export function isProtected(key: string, config: AxionConfig | null): boolean {
    if (!config || !config.protected_keys) {
        return false;
    }
    return config.protected_keys.includes(key);
}
