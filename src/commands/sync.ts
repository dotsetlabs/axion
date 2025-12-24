import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { ManifestManager, MANIFEST_FILENAME, GLOBAL_SERVICE } from '../core/manifest.js';
import { cloudClient } from '../cloud/client.js';
import { isAuthenticated, loadCloudConfig } from '../cloud/auth.js';
import {
    loadSyncConfig,
    saveSyncConfig,
    discoverEnvFiles,
    createEmptySyncConfig,
    toSyncEntries,
    formatDiscoveredFiles,
    getEnabledFiles,
} from '../core/sync-config.js';
import { parseEnvFile } from '../core/parser.js';
import { readFile, writeFile } from 'node:fs/promises';

export function registerSyncCommands(program: Command) {
    const manifest = new ManifestManager();

    /**
     * Push Command
     * Push manifest to remote, or migrate from .env file
     */
    program
        .command('push [file]')
        .description('Push manifest to cloud, or import from .env file')
        .option('--scope <env>', 'Environment scope to push to', 'development')
        .option('--overwrite', 'Overwrite existing variables')
        .action(async (file: string | undefined, options: { scope: string; overwrite?: boolean }) => {
            try {
                const opts = program.opts();
                const service = opts.service ?? GLOBAL_SERVICE;

                if (file) {
                    // Migration Mode
                    info(`Migrating variables from ${file} to ${options.scope} scope...`);

                    const content = await readFile(file, 'utf8');
                    const result = parseEnvFile(content);

                    if (result.errors.length > 0) {
                        console.log(colors.yellow('\n⚠️  Parsing warnings:'));
                        for (const err of result.errors) console.log(`   Line ${err.line}: ${err.message}`);
                    }

                    if (result.variables.length === 0) {
                        info('No variables found to migrate.');
                        return;
                    }

                    let imported = 0;
                    for (const { key, value } of result.variables) {
                        // Check if variable exists
                        const existing = await manifest.getVariables(service, options.scope as any);
                        if (key in existing && !options.overwrite) continue;

                        await manifest.setVariable(key, value, service, options.scope as any);
                        imported++;
                    }

                    success(`Migrated ${imported} variables to ${options.scope} scope.`);

                    // save() auto-syncs to cloud when project is linked
                    success('Changes saved and synced to cloud.');
                } else {
                    // Normal Push - trigger a save to sync latest to cloud
                    info('Syncing manifest to cloud...');
                    // Reload and save to trigger cloud sync
                    const currentManifest = await manifest.load();
                    await manifest.save(currentManifest);
                    success('Manifest synced to cloud.');
                }
            } catch (err) {
                error((err as Error).message);
            }
        });

    /**
     * Sync Command
     * Sync .env files with Axion cloud using hybrid approach
     */
    program
        .command('sync')
        .description('Sync .env files with Axion cloud')
        .argument('[file]', 'Specific .env file to sync')
        .option('--push', 'Force push local to cloud')
        .option('--pull', 'Force pull cloud to local')
        .option('--scope <env>', 'Environment scope (development, staging, production)', 'development')
        .option('--init', 'Set up sync configuration interactively')
        .option('--discover', 'Discover .env files without syncing')
        .action(async (
            file: string | undefined,
            options: {
                push?: boolean;
                pull?: boolean;
                scope?: string;
                init?: boolean;
                discover?: boolean;
            }
        ) => {
            try {
                const opts = program.opts();
                const service = opts.service ?? GLOBAL_SERVICE;

                // Handle --discover flag: just show discovered files
                if (options.discover) {
                    info('Discovering .env files...');
                    const discovered = await discoverEnvFiles(process.cwd());
                    console.log();
                    console.log(formatDiscoveredFiles(discovered));
                    console.log();
                    return;
                }

                // Handle --init flag: set up sync config
                if (options.init) {
                    info('Setting up sync configuration...');
                    const discovered = await discoverEnvFiles(process.cwd());

                    if (discovered.length === 0) {
                        info('No .env files found in project.');
                        info('Create a .env file and run "axn sync --init" again.');
                        return;
                    }

                    console.log();
                    console.log(formatDiscoveredFiles(discovered));
                    console.log();

                    // Create sync config from discovered files
                    const config = createEmptySyncConfig();
                    config.files = toSyncEntries(discovered);

                    await saveSyncConfig(config);
                    success(`Sync config saved to .dotset/axion/sync.yaml with ${config.files.length} file(s)`);
                    console.log();
                    info('Run "axn sync" to import these files into Axion.');
                    return;
                }

                // Check if authenticated for cloud operations
                if (!(await isAuthenticated())) {
                    error('Not logged in. Run "axn login" first.');
                }

                // Check if linked
                const cloudConfig = await loadCloudConfig(process.cwd());
                if (!cloudConfig) {
                    error('Project not linked. Run "axn link <project-id>" first.');
                }

                // Check access
                const access = await cloudClient.checkAccess(cloudConfig.projectId);
                if (!access.hasAccess) {
                    error(`Access revoked: ${access.reason || 'Contact your admin'}`);
                }

                // Handle --pull: download from cloud
                if (options.pull) {
                    info('Pulling from cloud...');

                    const cloudManifest = await cloudClient.fetchManifest(cloudConfig.projectId);
                    if (!cloudManifest) {
                        error('Failed to pull manifest from cloud.');
                    }

                    await writeFile(MANIFEST_FILENAME, cloudManifest.encryptedData, 'utf8');

                    console.log();
                    success('Pulled from cloud!');
                    console.log('  Version:', cloudManifest.version);
                    console.log('  Updated:', new Date(cloudManifest.updatedAt).toLocaleString());
                    console.log();
                    return;
                }

                // Handle --push: push current manifest to cloud
                if (options.push) {
                    info('Pushing to cloud...');

                    const encryptedData = await readFile(MANIFEST_FILENAME, 'utf8');
                    const keyFingerprint = await manifest.getFingerprint();

                    const result = await cloudClient.uploadManifest(
                        cloudConfig.projectId,
                        encryptedData,
                        keyFingerprint
                    );

                    if (!result) {
                        error('Failed to sync to cloud.');
                    }

                    console.log();
                    success('Synced to cloud!');
                    console.log('  Version:', result.version);
                    console.log('  Project:', colors.cyan(cloudConfig.projectId));
                    console.log();
                    return;
                }

                // If specific file provided, import that file
                if (file) {
                    const scope = options.scope as 'development' | 'staging' | 'production';
                    await importEnvFile(file, service, scope);
                    return;
                }

                // Try to load sync config
                const syncConfig = await loadSyncConfig(process.cwd());

                if (syncConfig) {
                    // Use sync.yaml config
                    const enabledFiles = getEnabledFiles(syncConfig);

                    if (enabledFiles.length === 0) {
                        info('No files enabled in .dotset/axion/sync.yaml');
                        return;
                    }

                    info(`Syncing ${enabledFiles.length} file(s) from .dotset/axion/sync.yaml...`);
                    console.log();

                    let totalVars = 0;
                    for (const entry of enabledFiles) {
                        const fileService = entry.service ?? GLOBAL_SERVICE;
                        const imported = await importEnvFile(entry.path, fileService, entry.scope, true);
                        totalVars += imported;
                    }

                    // Push to cloud after importing
                    const currentManifest = await manifest.load();
                    await manifest.save(currentManifest);

                    console.log();
                    success(`Imported ${totalVars} variable(s) and synced to cloud.`);
                } else {
                    // No config - discover and prompt
                    info('No .dotset/axion/sync.yaml found. Discovering .env files...');
                    const discovered = await discoverEnvFiles(process.cwd());

                    if (discovered.length === 0) {
                        info('No .env files found in project.');
                        info('Create a .env file or use "axn set <key> <value>" to add secrets.');
                        return;
                    }

                    console.log();
                    console.log(formatDiscoveredFiles(discovered));
                    console.log();
                    info('Run "axn sync --init" to save this configuration.');
                    info('Or specify a file directly: axn sync .env.production --scope production');
                }
            } catch (err) {
                error((err as Error).message);
            }
        });

    /**
     * Helper: Import variables from an .env file
     */
    async function importEnvFile(
        filePath: string,
        service: string,
        scope: 'development' | 'staging' | 'production',
        quiet: boolean = false
    ): Promise<number> {
        const content = await readFile(filePath, 'utf8');
        const result = parseEnvFile(content);

        if (result.errors.length > 0 && !quiet) {
            console.log(colors.yellow('\n⚠️  Parsing warnings:'));
            for (const err of result.errors) console.log(`   Line ${err.line}: ${err.message}`);
        }

        if (result.variables.length === 0) {
            if (!quiet) info(`No variables found in ${filePath}`);
            return 0;
        }

        let imported = 0;
        for (const { key, value } of result.variables) {
            await manifest.setVariable(key, value, service, scope);
            imported++;
        }

        if (!quiet) {
            success(`Imported ${imported} variable(s) from ${filePath} → ${scope}`);
        } else {
            console.log(`  ${colors.green('✓')} ${filePath} → ${scope} (${imported} vars)`);
        }

        return imported;
    }
}
