import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { ManifestManager, MANIFEST_FILENAME } from '../core/manifest.js';
import { cloudClient } from '../cloud/client.js';
import { isAuthenticated, saveCloudConfig } from '../cloud/auth.js';
import {
    saveSyncConfig,
    discoverEnvFiles,
    createEmptySyncConfig,
    toSyncEntries,
    formatDiscoveredFiles,
} from '../core/sync-config.js';
import { basename } from 'node:path';

export function registerInitCommand(program: Command) {
    const manifest = new ManifestManager();

    /**
     * Initialize Command
     * Sets up a new project with encryption key
     */
    program
        .command('init')
        .description('Initialize a new Axion project')
        .option('--cloud', 'Create project in cloud and auto-link')
        .option('--name <name>', 'Project name (required with --cloud)')
        .action(async (options: { cloud?: boolean; name?: string }) => {
            try {
                if (await manifest.isInitialized()) {
                    error('Project already initialized. Delete .dotset/axion/ to reinitialize.');
                }

                const key = await manifest.init();

                success('Project initialized successfully!');
                console.log();
                info('Your project key has been stored in .dotset/axion/key');

                // Create cloud project if requested
                if (options.cloud) {
                    if (!(await isAuthenticated())) {
                        console.log();
                        console.log(colors.red('✗ Cannot create cloud project: Not logged in.'));
                        console.log();
                        console.log('  To use the --cloud flag, you must first authenticate:');
                        console.log(`    ${colors.cyan('axn login')}`);
                        console.log();
                        console.log('  Then re-initialize with cloud support:');
                        console.log(`    ${colors.cyan('rm -rf .dotset/axion && axn init --cloud --name ' + (options.name || basename(process.cwd())))}`);
                        console.log();
                        error('Cloud project creation requires authentication. Run "axn login" first.');
                    } else {
                        const projectName = options.name || basename(process.cwd());
                        const fingerprint = await manifest.getFingerprint();

                        info(`Creating cloud project "${projectName}"...`);
                        const project = await cloudClient.createProject(projectName, fingerprint);

                        // Auto-link
                        await saveCloudConfig(process.cwd(), {
                            projectId: project.id,
                            apiUrl: process.env.AXION_API_URL || 'https://api.dotsetlabs.com',
                            linkedAt: new Date().toISOString(),
                        });

                        console.log();
                        success('Cloud project created and linked!');
                        console.log('  Project ID:', colors.cyan(project.id));
                    }
                }

                // Auto-discover .env files
                console.log();
                info('Looking for .env files...');
                const discovered = await discoverEnvFiles(process.cwd());

                if (discovered.length > 0) {
                    console.log(formatDiscoveredFiles(discovered));
                    console.log();

                    // Create sync config
                    const syncConfig = createEmptySyncConfig();
                    syncConfig.files = toSyncEntries(discovered);
                    await saveSyncConfig(syncConfig);

                    success(`Created .dotset/axion/sync.yaml with ${discovered.length} file(s)`);
                    console.log();
                    console.log(colors.bold('📥 Next steps:'));
                    console.log('   1. Run', colors.cyan('axn sync'), 'to import your .env files');
                    console.log('   2. Run', colors.cyan('axn run -- npm start'), 'to use secrets');
                } else {
                    console.log('   No .env files found.');
                    console.log();
                    console.log(colors.bold('📥 Add secrets using one of these methods:'));
                    console.log();
                    console.log('   ' + colors.cyan('Option A:'), 'Add secrets manually');
                    console.log('      axn set DATABASE_URL "postgres://..."');
                    console.log('      axn set API_KEY "sk-12345" --scope production');
                    console.log();
                    console.log('   ' + colors.cyan('Option B:'), 'Import from .env file');
                    console.log('      axn sync .env --scope development');
                    console.log('      axn sync .env.production --scope production');
                }

                console.log();
                console.log(colors.yellow('⚠️  Important:'));
                console.log('   Add the following to your .gitignore:');
                console.log(colors.dim('   .dotset/'));
                console.log(colors.dim(`   ${MANIFEST_FILENAME}`));
                console.log();
                console.log('   Back up your project key securely:');
                console.log(colors.bold(`   ${key}`));
            } catch (err) {
                error((err as Error).message);
            }
        });
}
