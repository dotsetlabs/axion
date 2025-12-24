/**
 * Axion Sync Configuration
 *
 * Manages .dotset/axion/sync.yaml configuration and .env file discovery.
 * Provides a structured way to track which .env files should be
 * synchronized with Axion cloud.
 *
 * Features:
 * - Config file management (.dotset/axion/sync.yaml)
 * - Auto-discovery of .env files in project
 * - Scope inference from filename patterns
 * - Support for monorepo structures with service scoping
 */

import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import yaml from 'js-yaml';

/** Sync config file location */
export const SYNC_CONFIG_PATH = '.dotset/axion/sync.yaml';

/** Maximum directory depth for .env discovery */
const MAX_DISCOVERY_DEPTH = 4;

/** Common .env file patterns to discover */
const ENV_FILE_PATTERNS = [
    /^\.env$/,
    /^\.env\.(local|development|dev|staging|stage|test|production|prod)$/,
    /^\.env\.[a-z]+\.local$/,
];

/** Directories to skip during discovery */
const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.dotset',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    '__pycache__',
    'venv',
    '.venv',
]);

/**
 * Sync file entry configuration
 */
export interface SyncFileEntry {
    /** Relative path to the .env file */
    path: string;
    /** Environment scope (development, staging, production) */
    scope: 'development' | 'staging' | 'production';
    /** Optional service name for monorepo organization */
    service?: string;
    /** Whether this file is enabled for sync */
    enabled?: boolean;
}

/**
 * Sync configuration structure (.dotset/axion/sync.yaml)
 */
export interface SyncConfig {
    /** Config version for future compatibility */
    version: '1';
    /** List of tracked .env files */
    files: SyncFileEntry[];
}

/**
 * Discovered .env file with metadata
 */
export interface DiscoveredEnvFile {
    /** Absolute path to the file */
    absolutePath: string;
    /** Relative path from project root */
    relativePath: string;
    /** Inferred scope from filename */
    inferredScope: 'development' | 'staging' | 'production';
    /** Inferred service from directory (for monorepos) */
    inferredService?: string;
    /** Number of variables in the file */
    variableCount: number;
}

/**
 * Creates an empty sync configuration
 */
export function createEmptySyncConfig(): SyncConfig {
    return {
        version: '1',
        files: [],
    };
}

/**
 * Loads the sync configuration from .dotset/axion/sync.yaml
 *
 * @param workDir - Working directory (defaults to cwd)
 * @returns SyncConfig or null if not found
 */
export async function loadSyncConfig(workDir: string = process.cwd()): Promise<SyncConfig | null> {
    const configPath = join(workDir, SYNC_CONFIG_PATH);

    try {
        await access(configPath);
        const content = await readFile(configPath, 'utf8');
        const config = yaml.load(content) as SyncConfig;

        // Validate version
        if (config.version !== '1') {
            throw new Error(`Unsupported sync config version: ${config.version}`);
        }

        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Saves the sync configuration to .dotset/axion/sync.yaml
 *
 * @param config - SyncConfig to save
 * @param workDir - Working directory (defaults to cwd)
 */
export async function saveSyncConfig(
    config: SyncConfig,
    workDir: string = process.cwd()
): Promise<void> {
    const configPath = join(workDir, SYNC_CONFIG_PATH);
    const yamlContent = yaml.dump(config, { indent: 2 });
    await writeFile(configPath, yamlContent, 'utf8');
}

/**
 * Infers the environment scope from a filename
 *
 * Patterns:
 * - .env → development
 * - .env.local → development
 * - .env.development → development
 * - .env.dev → development
 * - .env.staging → staging
 * - .env.stage → staging
 * - .env.production → production
 * - .env.prod → production
 *
 * @param filename - The .env filename
 * @returns Inferred scope
 */
export function inferScopeFromFilename(filename: string): 'development' | 'staging' | 'production' {
    const lower = filename.toLowerCase();

    // Production patterns
    if (lower.includes('production') || lower.includes('prod')) {
        return 'production';
    }

    // Staging patterns
    if (lower.includes('staging') || lower.includes('stage')) {
        return 'staging';
    }

    // Everything else is development
    return 'development';
}

/**
 * Infers a service name from the directory path (for monorepos)
 *
 * Examples:
 * - apps/api/.env → "api"
 * - packages/web/.env → "web"
 * - services/auth/.env → "auth"
 * - .env → undefined (root level)
 *
 * @param relativePath - Relative path to the .env file
 * @returns Inferred service name or undefined
 */
export function inferServiceFromPath(relativePath: string): string | undefined {
    const dir = dirname(relativePath);

    // Root level files don't have a service
    if (dir === '.') {
        return undefined;
    }

    // Check for common monorepo patterns
    const parts = dir.split('/').filter(Boolean);

    // patterns: apps/X, packages/X, services/X, libs/X
    const monorepoRoots = ['apps', 'packages', 'services', 'libs', 'modules'];
    if (parts.length >= 2 && monorepoRoots.includes(parts[0])) {
        return parts[1];
    }

    // For other structures, use the immediate parent directory
    if (parts.length >= 1) {
        return parts[parts.length - 1];
    }

    return undefined;
}

/**
 * Counts the number of variables in an .env file
 *
 * @param filePath - Path to the .env file
 * @returns Number of valid variable definitions
 */
async function countEnvVariables(filePath: string): Promise<number> {
    try {
        const content = await readFile(filePath, 'utf8');
        const lines = content.split('\n');
        let count = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) continue;
            // Check for valid KEY=value pattern
            if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) {
                count++;
            }
        }

        return count;
    } catch {
        return 0;
    }
}

/**
 * Checks if a filename matches .env file patterns
 */
function isEnvFile(filename: string): boolean {
    return ENV_FILE_PATTERNS.some(pattern => pattern.test(filename));
}

/**
 * Recursively discovers .env files in a directory
 *
 * @param dir - Directory to search
 * @param workDir - Project root for relative path calculation
 * @param depth - Current depth (for limiting recursion)
 * @returns Array of discovered .env files
 */
async function discoverInDirectory(
    dir: string,
    workDir: string,
    depth: number = 0
): Promise<DiscoveredEnvFile[]> {
    if (depth > MAX_DISCOVERY_DEPTH) {
        return [];
    }

    const results: DiscoveredEnvFile[] = [];

    try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            if (entry.isDirectory()) {
                // Skip excluded directories
                if (SKIP_DIRECTORIES.has(entry.name)) continue;

                // Recurse into subdirectories
                const subResults = await discoverInDirectory(fullPath, workDir, depth + 1);
                results.push(...subResults);
            } else if (entry.isFile() && isEnvFile(entry.name)) {
                const relativePath = relative(workDir, fullPath);
                const variableCount = await countEnvVariables(fullPath);

                results.push({
                    absolutePath: fullPath,
                    relativePath,
                    inferredScope: inferScopeFromFilename(entry.name),
                    inferredService: inferServiceFromPath(relativePath),
                    variableCount,
                });
            }
        }
    } catch {
        // Ignore directories we can't read
    }

    return results;
}

/**
 * Discovers all .env files in the project
 *
 * Searches the project directory recursively (up to MAX_DISCOVERY_DEPTH)
 * for files matching common .env patterns. Skips node_modules and other
 * common directories that shouldn't contain tracked .env files.
 *
 * @param workDir - Project root directory
 * @returns Array of discovered .env files with metadata
 */
export async function discoverEnvFiles(workDir: string = process.cwd()): Promise<DiscoveredEnvFile[]> {
    const discovered = await discoverInDirectory(workDir, workDir, 0);

    // Sort by path for consistent ordering
    return discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Converts discovered files to sync config entries
 *
 * @param files - Discovered .env files
 * @returns Array of SyncFileEntry
 */
export function toSyncEntries(files: DiscoveredEnvFile[]): SyncFileEntry[] {
    return files.map(file => ({
        path: file.relativePath,
        scope: file.inferredScope,
        service: file.inferredService,
        enabled: true,
    }));
}

/**
 * Validates a sync configuration
 *
 * Checks that all referenced files exist and have valid scopes.
 *
 * @param config - SyncConfig to validate
 * @param workDir - Working directory
 * @returns Array of validation errors (empty if valid)
 */
export async function validateSyncConfig(
    config: SyncConfig,
    workDir: string = process.cwd()
): Promise<string[]> {
    const errors: string[] = [];
    const validScopes = new Set(['development', 'staging', 'production']);

    for (const file of config.files) {
        // Check file exists
        const fullPath = join(workDir, file.path);
        try {
            await access(fullPath);
        } catch {
            errors.push(`File not found: ${file.path}`);
        }

        // Check valid scope
        if (!validScopes.has(file.scope)) {
            errors.push(`Invalid scope "${file.scope}" for ${file.path}`);
        }
    }

    return errors;
}

/**
 * Merges new discovered files into an existing config
 *
 * Only adds files that aren't already tracked.
 *
 * @param config - Existing sync config
 * @param discovered - Newly discovered files
 * @returns Updated config with new files added
 */
export function mergeDiscoveredFiles(
    config: SyncConfig,
    discovered: DiscoveredEnvFile[]
): SyncConfig {
    const existingPaths = new Set(config.files.map(f => f.path));
    const newEntries = discovered
        .filter(f => !existingPaths.has(f.relativePath))
        .map(file => ({
            path: file.relativePath,
            scope: file.inferredScope,
            service: file.inferredService,
            enabled: true,
        }));

    return {
        ...config,
        files: [...config.files, ...newEntries],
    };
}

/**
 * Gets the enabled files from a sync config
 *
 * @param config - SyncConfig
 * @returns Array of enabled file entries
 */
export function getEnabledFiles(config: SyncConfig): SyncFileEntry[] {
    return config.files.filter(f => f.enabled !== false);
}

/**
 * Formats discovered files for display
 *
 * @param files - Discovered files
 * @returns Formatted string for CLI output
 */
export function formatDiscoveredFiles(files: DiscoveredEnvFile[]): string {
    if (files.length === 0) {
        return 'No .env files found.';
    }

    const lines = files.map(f => {
        const service = f.inferredService ? ` [service: ${f.inferredService}]` : '';
        const vars = f.variableCount === 1 ? '1 var' : `${f.variableCount} vars`;
        return `  ${f.relativePath} (${vars}) → ${f.inferredScope}${service}`;
    });

    return ['📁 Found .env files:', ...lines].join('\n');
}
