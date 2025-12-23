/**
 * Axion CLI
 *
 * Command-line interface for the Axion secrets management service.
 *
 * Commands:
 *   init                   Initialize a new project with encryption key
 *   set <key> <value>      Set an environment variable
 *   get <key>              Get an environment variable value
 *   list                   List all environment variables
 *   run -- <command>       Run a command with injected environment
 *   login                  Authenticate with Axion cloud
 *   logout                 Clear local credentials
 *   link <project-id>      Link local project to cloud
 *   sync                   Sync manifest with cloud
 *   whoami                 Show current user and linked project
 *
 * Global Options:
 *   --service <name>       Scope operations to a specific service
 */

import { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { ManifestManager, GLOBAL_SERVICE } from './core/manifest.js';
import { run } from './core/injector.js';
import { parseEnvFile, isValidVariableName, isValidServiceName } from './core/parser.js';
import { cloudClient } from './cloud/client.js';
import {
    isAuthenticated,
    getCurrentUser,
    clearCredentials,
    saveCloudConfig,
    loadCloudConfig,
    isCloudLinked,
    unlinkCloud,
} from './cloud/auth.js';
import {
    encrypt,
    decrypt,
    serializeEncrypted,
    deserializeEncrypted
} from './core/crypto.js';
import { loadConfig, isProtected } from './core/config.js';
import {
    loadSyncConfig,
    saveSyncConfig,
    discoverEnvFiles,
    createEmptySyncConfig,
    toSyncEntries,
    formatDiscoveredFiles,
    getEnabledFiles,
} from './core/sync-config.js';
import { mkdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { execSync } from 'node:child_process';

const program = new Command();

// Create manifest manager instance
const manifest = new ManifestManager();

/**
 * Formats output with colors for better readability
 */
const colors = {
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

/**
 * Prints a success message
 */
function success(message: string): void {
    console.log(colors.green('✓'), message);
}

/**
 * Prints an error message and exits
 */
function error(message: string): never {
    console.error(colors.red('✗'), message);
    process.exit(1);
}

/**
 * Prints an info message
 */
function info(message: string): void {
    console.log(colors.cyan('ℹ'), message);
}

program
    .name('axn')
    .description('Zero-Disk Secret Plane for micro-services')
    .version('1.0.0')
    .option('-s, --service <name>', 'Scope operations to a specific service');

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
                error('Project already initialized. Delete .axion/ to reinitialize.');
            }

            const key = await manifest.init();

            success('Project initialized successfully!');
            console.log();
            info('Your project key has been stored in .axion/key');

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
                    console.log(`    ${colors.cyan('rm -rf .axion && axn init --cloud --name ' + (options.name || basename(process.cwd())))}`);
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

                success(`Created .axion/sync.yaml with ${discovered.length} file(s)`);
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
            console.log(colors.dim('   .axion/'));
            console.log(colors.dim('   .axion.env'));
            console.log();
            console.log('   Back up your project key securely:');
            console.log(colors.bold(`   ${key}`));
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Set Command
 * Adds or updates an environment variable
 */
program
    .command('set <key> <value>')
    .description('Set an environment variable')
    .option('--scope <env>', 'Environment scope (development, staging, production)')
    .option('--force', 'Suppress overwrite warning')
    .action(async (key: string, value: string, options: { scope?: string; force?: boolean }) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const scope = options.scope;

            // Validate variable name
            if (!isValidVariableName(key)) {
                error(`Invalid variable name "${key}". Use only letters, numbers, and underscores (must start with letter or underscore).`);
            }

            // Validate service name
            if (service !== GLOBAL_SERVICE && !isValidServiceName(service)) {
                error(`Invalid service name "${service}". Use only letters, numbers, hyphens, and underscores.`);
            }

            // Validate scope
            if (scope && !['development', 'staging', 'production'].includes(scope)) {
                error('Invalid scope. Must be one of: development, staging, production');
            }

            // Check if key already exists and warn
            const existingVars = await manifest.getVariables(service, (scope as any) ?? 'development');
            if (key in existingVars && !options.force) {
                console.log(colors.yellow(`⚠️  Overwriting existing value for ${colors.bold(key)}`));
            }

            await manifest.setVariable(key, value, service, scope as any);

            const scopeDisplay = scope ? `${scope}` : 'default';
            const serviceDisplay = service === GLOBAL_SERVICE ? 'global' : service;
            success(`Set ${colors.bold(key)} in ${colors.cyan(scopeDisplay)} scope for ${colors.dim(serviceDisplay)} service`);
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Get Command
 * Retrieves an environment variable value
 */
program
    .command('get <key>')
    .description('Get an environment variable value')
    .option('--scope <env>', 'Environment scope (development, staging, production)', 'development')
    .option('--reveal', 'Reveal the actual value (unmask)')
    .action(async (key: string, options) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const scope = options.scope;

            if (!['development', 'staging', 'production'].includes(scope)) {
                error('Invalid scope. Must be one of: development, staging, production');
            }

            const config = await loadConfig();
            if (options.reveal && isProtected(key, config)) {
                console.log(colors.red('🔒  This variable is protected (Write-Only) and cannot be revealed.'));
                return;
            }

            const vars = await manifest.getVariables(service, scope as any);

            if (key in vars) {
                const value = vars[key];
                if (options.reveal) {
                    console.log(value);
                } else {
                    console.log('********');
                }
            } else {
                error(`Variable "${key}" not found in ${scope} scope`);
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * List Command
 * Lists all environment variables
 */
program
    .command('list')
    .alias('ls')
    .description('List all environment variables')
    .option('-a, --all', 'Show all services separately')
    .option('--scope <env>', 'Environment scope (development, staging, production)', 'development')
    .option('--reveal', 'Reveal actual values')
    .action(async (options) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const scope = options.scope;

            if (!['development', 'staging', 'production'].includes(scope)) {
                error('Invalid scope. Must be one of: development, staging, production');
            }

            if (options.all) {
                // ... (Show raw manifest structure? Or just list all services for the scope?)
                // For MVP simplify: just list variables for the current scope/service context.
                // Raw dump might require more logic. Let's stick to getVariables view.
                const manifestData = await manifest.load();
                // This raw view doesn't show resolving logic. It's better to iterate services and resolve.
                console.log(colors.yellow('Note: --all shows raw manifest values without scope resolution.'));
                // ... existing implementation for --all ...
                // Actually, let's just warn:
                console.log(colors.bold(`\nListing all variables (raw storage):\n`));
                // (Existing logic prints manifest.services w/o scope overrides)
                // Just proceed with existing logic for --all but warn it doesn't show scope overrides.
                for (const [serviceName, vars] of Object.entries(manifestData.services)) {
                    const displayName = serviceName === GLOBAL_SERVICE ? 'global' : serviceName;
                    console.log(colors.bold(`\n[${displayName}] (default)`));
                    // ...
                }
                // Also list scopes
                if (manifestData.scopes) {
                    for (const [scopeName, scopeVars] of Object.entries(manifestData.scopes)) {
                        for (const [serviceName, vars] of Object.entries(scopeVars as any)) {
                            console.log(colors.bold(`\n[${serviceName}] (${scopeName})`));
                            for (const [key, value] of Object.entries(vars as any)) {
                                console.log(`  ${colors.cyan(key)}=${colors.dim('********')}`);
                            }
                        }
                    }
                }
            } else {
                // Show resolved variables
                const vars = await manifest.getVariables(service, scope as any);
                const config = await loadConfig();

                if (Object.keys(vars).length === 0) {
                    info(`No environment variables set for ${scope} scope.`);
                } else {
                    const params = service === GLOBAL_SERVICE ? 'global' : `service:${service}`;
                    console.log(colors.bold(`\nEnvironment variables (${params}, scope:${scope}):\n`));

                    for (const [key, value] of Object.entries(vars)) {
                        let displayValue = '********';
                        if (options.reveal) {
                            if (isProtected(key, config)) {
                                displayValue = '******** (Protected)';
                            } else {
                                displayValue = value;
                            }
                        }
                        console.log(`  ${colors.cyan(key)}=${colors.dim(displayValue)}`);
                    }
                    console.log();
                }
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Remove Command
 * Removes an environment variable
 */
program
    .command('rm <key>')
    .alias('remove')
    .description('Remove an environment variable')
    .option('--scope <env>', 'Environment scope (development, staging, production)')
    .action(async (key: string, options) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const scope = options.scope;

            if (scope && !['development', 'staging', 'production'].includes(scope)) {
                error('Invalid scope. Must be one of: development, staging, production');
            }

            const removed = await manifest.removeVariable(key, service, scope as any);

            if (removed) {
                const scopeInfo = scope ? ` from ${scope} scope` : ' (default)';
                success(`Removed ${colors.bold(key)}${scopeInfo}`);
            } else {
                error(`Variable "${key}" not found`);
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Run Command
 * Executes a command with injected environment variables
 */
program
    .command('run')
    .description('Run a command with injected environment variables')
    .argument('<command...>', 'Command and arguments to run')
    .option('--scope <env>', 'Environment scope (development, staging, production)', 'development')
    .option('--with-gluon', 'Enable Gluon runtime security monitoring')
    .allowUnknownOption()
    .action(async (commandArgs: string[], options) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const scope = options.scope;

            if (!['development', 'staging', 'production'].includes(scope)) {
                error('Invalid scope. Must be one of: development, staging, production');
            }

            const vars = await manifest.getVariables(service, scope as any);

            // Separate the command from its arguments
            let [command, ...args] = commandArgs;

            if (!command) {
                error('No command specified. Usage: axn run -- <command>');
            }

            // If --with-gluon is enabled, wrap command with gln run
            if (options.withGluon) {
                // Check if gluon is installed
                let gluonAvailable = false;
                try {
                    execSync('gln --version', { stdio: 'ignore' });
                    gluonAvailable = true;
                } catch {
                    // gluon not installed
                }

                if (gluonAvailable) {
                    info('Gluon runtime monitoring enabled');
                    // Wrap: gln run -- <original command>
                    args = ['run', '--', command, ...args];
                    command = 'gln';
                } else {
                    console.log(colors.yellow('⚠ Gluon not installed. Install with: npm install -g @dotsetlabs/gluon'));
                    console.log(colors.dim('  Continuing without Gluon monitoring...'));
                    console.log();
                }
            }

            // Run the command with injected environment
            const exitCode = await run(command, args, { env: vars });

            // Exit with the same code as the child process
            process.exit(exitCode);
        } catch (err) {
            error((err as Error).message);
        }
    });

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
 * Export Command
 * Export variables to .env or JSON
 */
program
    .command('export')
    .description('Export variables to a file format')
    .option('--format <type>', 'Output format (env, json)', 'env')
    .option('--scope <env>', 'Environment scope', 'development')
    .action(async (options: { format: string; scope: string }) => {
        try {
            const opts = program.opts();
            const service = opts.service ?? GLOBAL_SERVICE;
            const vars = await manifest.getVariables(service, options.scope as any);

            if (options.format === 'json') {
                console.log(JSON.stringify(vars, null, 2));
            } else {
                for (const [key, value] of Object.entries(vars)) {
                    console.log(`${key}=${value}`);
                }
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * History Command
 * View manifest version history
 */
program
    .command('history')
    .description('View manifest version history')
    .action(async () => {
        try {
            // Check auth & link
            if (!(await isAuthenticated())) error('Not logged in.');
            const config = await loadCloudConfig(process.cwd());
            if (!config) error('Project not linked.');

            const history = await cloudClient.fetchHistory(config.projectId);

            console.log(colors.bold(`\nVersion History for ${config.projectId}:\n`));

            // Sort Descending
            history.sort((a, b) => b.version - a.version);

            for (const entry of history) {
                console.log(`  ${colors.green('v' + entry.version)}  ${colors.dim(entry.updatedAt)}  by ${colors.cyan(entry.updatedBy)}`);
                console.log(`      Fingerprint: ${entry.keyFingerprint.substring(0, 8)}...`);
            }
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Rollback Command
 * Revert to a previous version
 */
program
    .command('rollback <version>')
    .description('Rollback to a specific version')
    .action(async (version: string) => {
        try {
            if (!(await isAuthenticated())) error('Not logged in.');
            const config = await loadCloudConfig(process.cwd());
            if (!config) error('Project not linked.');

            const ver = parseInt(version, 10);

            await cloudClient.rollback(config.projectId, ver);
            success(`Rolled back to version ${ver}. Run 'axn pull' to update local state.`);
        } catch (err) {
            error((err as Error).message);
        }
    });




/**
 * Exec Command (alias for run)
 * Executes a command with injected environment variables
 */
program
    .command('exec')
    .description('Execute a command with injected environment (alias for run)')
    .argument('<command...>', 'Command and arguments to run')
    .option('--dry-run', 'Show what would be injected without running')
    .allowUnknownOption()
    .action(async (commandArgs: string[], options: { dryRun?: boolean }) => {
        try {
            const opts = program.opts();
            const vars = await manifest.getVariables(opts.service);

            if (options.dryRun) {
                const scope = opts.service ? `service:${opts.service}` : 'all services';
                console.log(colors.bold(`\nEnvironment to be injected (${scope}):\n`));

                for (const [key, value] of Object.entries(vars)) {
                    console.log(`  ${colors.cyan(key)}=${colors.dim(value)}`);
                }
                console.log();
                console.log(colors.dim(`Command: ${commandArgs.join(' ')}`));
                console.log();
                return;
            }

            const [command, ...args] = commandArgs;

            if (!command) {
                error('No command specified. Usage: axn exec -- <command>');
            }

            const exitCode = await run(command, args, { env: vars });
            process.exit(exitCode);
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Key Command
 * Displays information about the encryption key
 */
program
    .command('key')
    .description('Display encryption key information')
    .option('--fingerprint', 'Show key fingerprint (safe to share)')
    .option('--show', 'Show the actual key (use with caution)')
    .action(async (options: { fingerprint?: boolean; show?: boolean }) => {
        try {
            if (!options.fingerprint && !options.show) {
                // Default to fingerprint if no option specified
                options.fingerprint = true;
            }

            if (options.fingerprint) {
                const fingerprint = await manifest.getFingerprint();
                console.log(colors.bold('\nKey Fingerprint:'), colors.cyan(fingerprint));
                console.log(colors.dim('(First 8 bytes of SHA-256 hash)\n'));
            }

            if (options.show) {
                console.log(colors.yellow('\n⚠️  Warning: This displays your secret key!\n'));
                const key = await manifest.showKey();
                console.log(colors.bold('Encryption Key:'), key);
                console.log();
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Rotate Command
 * Rotates the encryption key with backup and rollback support
 */
program
    .command('rotate')
    .description('Rotate the encryption key (re-encrypts all secrets)')
    .option('--new-key <key>', 'Use a specific new key instead of generating one')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: { newKey?: string; force?: boolean }) => {
        try {
            // Check if initialized
            if (!(await manifest.isInitialized())) {
                error('Project not initialized. Run "axn init" first.');
            }

            // Get current fingerprint
            const oldFingerprint = await manifest.getFingerprint();

            // Confirm unless --force
            if (!options.force) {
                console.log(colors.yellow('\n⚠️  Key Rotation Warning\n'));
                console.log('This will:');
                console.log('  1. Create a backup of your encrypted manifest');
                console.log('  2. Generate a new encryption key');
                console.log('  3. Re-encrypt all secrets with the new key');
                console.log('  4. Verify the new encryption works');
                console.log();
                console.log(colors.bold('Current key fingerprint:'), colors.cyan(oldFingerprint));
                console.log();
                console.log(colors.dim('Use --force to skip this prompt.'));
                console.log();

                // For now, require --force flag
                error('Confirmation required. Use --force to proceed with key rotation.');
            }

            info('Starting key rotation...');

            // Perform rotation
            const result = await manifest.rotateKey(options.newKey);

            console.log();
            success('Key rotation completed successfully!');
            console.log();
            console.log('  Old key:', colors.dim(result.oldKey.slice(0, 8) + '...'));
            console.log('  New key:', colors.bold(result.newKey));
            console.log();
            console.log(colors.yellow('⚠️  Important: Store your new key securely!'));
            console.log(colors.dim('   The old key has been replaced and is no longer valid.'));
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Recovery Command
 * Manage project key backups
 */
const recovery = program.command('recovery').description('Manage recovery options');

recovery
    .command('setup')
    .description('Create a secure recovery blob for your project key')
    .requiredOption('-p, --password <password>', 'Password to encrypt the recovery blob')
    .action(async (options) => {
        try {
            const key = await manifest.showKey();
            const encrypted = await encrypt(key, options.password);
            const blob = serializeEncrypted(encrypted);

            console.log(colors.green('✓ Recovery blob generated!'));
            console.log('Store this blob safely. You can restore your key using the password.');
            console.log();
            console.log(colors.bold(Buffer.from(blob).toString('base64')));
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

recovery
    .command('restore')
    .description('Restore project key from a recovery blob')
    .requiredOption('-p, --password <password>', 'Password used to encrypt the blob')
    .requiredOption('-b, --blob <blob>', 'The base64 recovery blob')
    .action(async (options) => {
        try {
            const json = Buffer.from(options.blob, 'base64').toString('utf8');
            const encryptedData = deserializeEncrypted(json);
            const key = await decrypt(encryptedData, options.password);

            // Restore key directly to disk
            const keyPath = join(process.cwd(), '.axion/key');
            await mkdir(dirname(keyPath), { recursive: true });
            await writeFile(keyPath, key, 'utf8');

            success('Project key restored successfully!');
        } catch (err) {
            error(`Restore failed: ${(err as Error).message}`);
        }
    });

/**
 * Login Command
 * Authenticate with Axion cloud using Device Code Flow (GitHub or Google SSO)
 */
program
    .command('login')
    .description('Authenticate with Axion cloud using GitHub or Google')
    .option('--google', 'Use Google instead of GitHub for authentication')
    .action(async (options: { google?: boolean }) => {
        try {
            const provider = options.google ? 'Google' : 'GitHub';
            console.log(colors.bold('\n🔐 Axion Cloud Login\n'));

            info(`Initiating authentication with ${provider}...`);

            // Step 1: Get device code from the appropriate provider
            const deviceResponse = options.google
                ? await cloudClient.initiateGoogleDeviceFlow()
                : await cloudClient.initiateDeviceFlow();

            console.log();
            console.log(colors.bold('  1. Open this URL in your browser:'));
            console.log(`     ${colors.cyan(deviceResponse.verificationUri)}`);
            console.log();
            console.log(colors.bold('  2. Enter this code:'));
            console.log(`     ${colors.green(colors.bold(deviceResponse.userCode))}`);
            console.log();
            console.log(colors.dim(`  Code expires in ${Math.floor(deviceResponse.expiresIn / 60)} minutes.`));
            console.log();

            // Step 2: Poll for authorization
            const pollFn = options.google
                ? cloudClient.pollGoogleDeviceFlow
                : cloudClient.pollDeviceFlow;
            const interval = Math.max(deviceResponse.interval, 5) * 1000; // Convert to ms, min 5s
            const maxAttempts = Math.ceil(deviceResponse.expiresIn / (interval / 1000));
            let attempts = 0;

            process.stdout.write(colors.dim('  Waiting for authorization'));

            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, interval));
                attempts++;
                process.stdout.write('.');

                try {
                    const pollResponse = await pollFn(deviceResponse.deviceCode);

                    if (pollResponse.status === 'complete') {
                        const user = await cloudClient.completeDeviceFlow(pollResponse);

                        console.log(colors.green(' ✓'));
                        console.log();
                        success('Logged in successfully!');
                        console.log();
                        console.log('  Email:', colors.cyan(user.email));
                        console.log('  Name:', user.name || colors.dim('(not set)'));
                        console.log('  Provider:', colors.dim(provider));
                        console.log();
                        return;
                    }

                    if (pollResponse.status === 'slow_down') {
                        // Increase interval
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                    // status === 'pending' - continue polling
                } catch (err) {
                    const message = (err as Error).message;
                    if (message.includes('expired') || message.includes('denied')) {
                        console.log(colors.red(' ✗'));
                        console.log();
                        error(message);
                    }
                    throw err;
                }
            }

            console.log(colors.red(' ✗'));
            console.log();
            error('Authorization timed out. Please try again.');
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Logout Command
 * Clear local credentials
 */
program
    .command('logout')
    .description('Clear local credentials')
    .action(async () => {
        try {
            await clearCredentials();
            success('Logged out successfully.');
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Destroy Command
 * Delete a project from Axion cloud (owner only)
 */
program
    .command('destroy')
    .argument('[project-id]', 'Cloud project ID to delete (optional if linked)')
    .description('Delete a project from Axion cloud (owner only)')
    .option('--force', 'Skip confirmation prompt (for scripting)')
    .action(async (projectIdArg: string | undefined, options: { force?: boolean }) => {
        try {
            console.log(colors.bold('\n🗑️  Axion Project Deletion\n'));

            // Check if authenticated
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            // Determine project ID
            let projectId = projectIdArg;
            if (!projectId) {
                // Try to get from linked project
                const cloudConfig = await loadCloudConfig(process.cwd());
                if (cloudConfig?.projectId) {
                    projectId = cloudConfig.projectId;
                    console.log('  Using linked project:', colors.cyan(projectId));
                } else {
                    error('No project ID provided and no linked project found.\n  Usage: axn destroy <project-id>');
                }
            }

            // Get project details for confirmation
            const projects = await cloudClient.listProjects();
            const project = projects.find(p => p.id === projectId);

            if (!project) {
                error(`Project not found: ${projectId}`);
            }

            // Show warning
            console.log(colors.red('⚠️  WARNING: This action is irreversible!'));
            console.log();
            console.log('  This will permanently delete:');
            console.log('  • All environment variables and secrets');
            console.log('  • All team member access');
            console.log('  • All service tokens');
            console.log('  • All audit log history');
            console.log();
            console.log('  Project:', colors.bold(project.name));
            console.log('  ID:', colors.dim(projectId));
            console.log();

            // Confirmation (unless --force)
            if (!options.force) {
                const readline = await import('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                const answer = await new Promise<string>((resolve) => {
                    rl.question(
                        `  Type "${colors.bold(project.name)}" to confirm deletion: `,
                        (ans) => {
                            rl.close();
                            resolve(ans);
                        }
                    );
                });

                if (answer !== project.name) {
                    console.log();
                    console.log(colors.yellow('  Deletion cancelled.'));
                    console.log();
                    process.exit(0);
                }
            }

            console.log();
            process.stdout.write('  Deleting project...');

            // Delete via API
            const result = await cloudClient.deleteProject(projectId);

            console.log(colors.green(' ✓'));
            console.log();
            success(result.message);
            console.log();
            console.log('  Side effects:');
            console.log(`    • ${result.sideEffects.membersRevoked} team members revoked`);
            console.log(`    • ${result.sideEffects.manifests} manifests archived`);
            console.log();

            // Clean up local config if this was the linked project
            const cloudConfig = await loadCloudConfig(process.cwd());
            if (cloudConfig?.projectId === projectId) {
                await unlinkCloud(process.cwd());
                console.log(colors.dim('  Local project unlinked.'));
                console.log();
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Link Command
 * Link local project to cloud project
 */
program
    .command('link')
    .argument('[project-id]', 'Cloud project ID to link')
    .description('Link local project to Axion cloud')
    .option('--create <name>', 'Create a new cloud project and link to it')
    .action(async (projectIdArg: string | undefined, options: { create?: string }) => {
        try {
            // Check if authenticated
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            // Check if project is initialized locally
            if (!(await manifest.isInitialized())) {
                error('Project not initialized. Run "axn init" first.');
            }

            const localFingerprint = await manifest.getFingerprint();
            let projectId = projectIdArg;

            // Handle creation
            if (options.create) {
                if (projectId) {
                    error('Cannot provide both project ID and --create');
                }

                info(`Creating cloud project "${options.create}"...`);
                // Create with local fingerprint
                const newProject = await cloudClient.createProject(options.create, localFingerprint);
                projectId = newProject.id;
                success(`Cloud project created: ${colors.bold(newProject.name)}`);
            }

            if (!projectId) {
                error('Project ID required under using --create\n  Usage: axn link <project-id> or axn link --create <name>');
                return; // TS satisfaction
            }

            // Check access to cloud project
            const access = await cloudClient.checkAccess(projectId);
            if (!access.hasAccess) {
                error(`Access denied: ${access.reason || 'Unknown error'}`);
            }

            // Fingerprint Sync: If remote has no fingerprint (e.g. created via UI), update it with local
            if (!access.project?.keyFingerprint && localFingerprint) {
                info('Setting project encryption key fingerprint...');
                await cloudClient.updateProject(projectId, { keyFingerprint: localFingerprint });
                success('Project encryption key synced.');
            }
            // Safety check: key mismatch
            else if (access.project?.keyFingerprint && access.project.keyFingerprint !== localFingerprint) {
                console.log(colors.yellow('⚠️  Fingerprint Mismatch'));
                console.log(`  Local:  ${localFingerprint}`);
                console.log(`  Remote: ${access.project.keyFingerprint}`);
                console.log('  This project uses a different encryption key than your local vault.');
                // We allow linking but warn, as they might want to overwrite local later or something.
                // But usually this means "wrong project".
            }

            // Save cloud config
            await saveCloudConfig(process.cwd(), {
                projectId,
                apiUrl: process.env.AXION_API_URL || 'https://api.dotsetlabs.com',
                linkedAt: new Date().toISOString(),
            });

            console.log();
            success(`Project linked to ${projectId}`);
            if (options.create) {
                console.log('  Role:', colors.bold('owner'));
            } else {
                console.log('  Role:', colors.bold(access.role || 'member'));
            }
            console.log();
            console.log(colors.dim('Run "axn sync" to upload your secrets.'));
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Unlink Command
 * Remove cloud link from project
 */
program
    .command('unlink')
    .description('Remove Axion cloud link from project')
    .action(async () => {
        try {
            if (!(await isCloudLinked(process.cwd()))) {
                error('Project is not linked to cloud.');
            }

            await unlinkCloud(process.cwd());
            success('Project unlinked from cloud.');
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Members Command
 * Manage project members
 */
const members = program
    .command('members')
    .description('Manage project members');

members
    .command('list')
    .description('List all project members')
    .action(async () => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            if (!(await isCloudLinked(process.cwd()))) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            const membersList = await cloudClient.getMembers(config!.projectId);

            if (membersList.length === 0) {
                info('No members in this project.');
                return;
            }

            console.log();
            console.log(colors.bold('Project Members:'));
            console.log();
            for (const m of membersList) {
                const status = m.revokedAt ? colors.red('(revoked)') : colors.green('(active)');
                console.log(`  ${m.userEmail} - ${colors.cyan(m.role)} ${status}`);
            }
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

members
    .command('add')
    .argument('<email>', 'Email of user to add')
    .option('--role <role>', 'Role: admin, member, or readonly', 'member')
    .description('Add a member to the project')
    .action(async (email: string, options: { role?: string }) => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            if (!(await isCloudLinked(process.cwd()))) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            const member = await cloudClient.addMember(config!.projectId, email, options.role || 'member');

            success(`Added ${member.userEmail} as ${member.role}`);
        } catch (err) {
            error((err as Error).message);
        }
    });

members
    .command('revoke')
    .argument('<email>', 'Email of member to revoke')
    .description('Revoke a member\'s access')
    .action(async (email: string) => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            if (!(await isCloudLinked(process.cwd()))) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            const membersList = await cloudClient.getMembers(config!.projectId);
            const member = membersList.find(m => m.userEmail === email);

            if (!member) {
                error(`Member "${email}" not found in project.`);
            }

            await cloudClient.revokeMember(config!.projectId, member!.userId);
            success(`Revoked access for ${email}`);
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Sync Command
 * Sync .env files with Axion cloud using hybrid approach:
 * 1. If sync.yaml exists, use it
 * 2. If specific file provided, sync that file
 * 3. Otherwise, auto-discover and prompt for selection
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
                success(`Sync config saved to .axion/sync.yaml with ${config.files.length} file(s)`);
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
                await writeFile('.axion.env', cloudManifest.encryptedData, 'utf8');

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

                const encryptedData = await readFile('.axion.env', 'utf8');
                const keyFingerprint = await manifest.getFingerprint();

                const result = await cloudClient.uploadManifest(
                    cloudConfig.projectId,
                    encryptedData,
                    keyFingerprint
                );

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
                    info('No files enabled in .axion/sync.yaml');
                    return;
                }

                info(`Syncing ${enabledFiles.length} file(s) from .axion/sync.yaml...`);
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
                info('No .axion/sync.yaml found. Discovering .env files...');
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

/**
 * Whoami Command
 * Show current user and linked project
 */
program
    .command('whoami')
    .description('Show current user and linked project')
    .action(async () => {
        try {
            console.log(colors.bold('\n📋 Axion Status\n'));

            // Authentication status
            if (await isAuthenticated()) {
                const user = await getCurrentUser();
                console.log('  Logged in as:', colors.cyan(user.email));
            } else {
                console.log('  Auth:', colors.dim('Not logged in'));
            }

            // Cloud link status
            const config = await loadCloudConfig(process.cwd());
            if (config) {
                console.log('  Cloud project:', colors.cyan(config.projectId));
                console.log('  Linked at:', new Date(config.linkedAt).toLocaleString());
            } else {
                console.log('  Cloud project:', colors.dim('Not linked'));
            }

            // Local status
            if (await manifest.isInitialized()) {
                const fingerprint = await manifest.getFingerprint();
                console.log('  Key fingerprint:', colors.cyan(fingerprint));
            } else {
                console.log('  Local project:', colors.dim('Not initialized'));
            }

            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

// Parse CLI arguments
/**
 * Audit Command
 * View project audit logs
 */
program
    .command('audit')
    .description('View project audit logs')
    .option('--limit <number>', 'Limit number of entries', '50')
    .action(async (options: { limit?: string }) => {
        try {
            // Check if authenticated
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            // Check if linked
            const config = await loadCloudConfig(process.cwd());
            if (!config) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            info(`Fetching audit logs for project ${config.projectId}...`);

            const logs = await cloudClient.fetchAuditLogs(config.projectId);

            if (logs.length === 0) {
                info('No audit logs found.');
                return;
            }

            console.log(colors.bold('\nAudit Logs:\n'));

            const limit = parseInt(options.limit ?? '50', 10);
            const displayLogs = logs.slice(0, limit);

            for (const log of displayLogs) {
                const date = new Date(log.createdAt).toLocaleString();
                const user = log.userEmail || log.userId;
                console.log(`  ${colors.dim(date)}  ${colors.cyan(log.action)}  ${colors.bold(user)}`);
                console.log(`    ${colors.dim('IP:')} ${log.ipAddress}  ${colors.dim('ID:')} ${log.id}`);
                console.log();
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Tokens Command
 * Manage service tokens for CI/CD
 */
const tokensCommand = program
    .command('tokens')
    .description('Manage service tokens for CI/CD');

tokensCommand
    .command('create')
    .description('Create a new service token')
    .requiredOption('--name <name>', 'Token name (e.g., "github-actions")')
    .option('--scope <scopes...>', 'Token scopes: read, write, admin', ['read'])
    .option('--expires <days>', 'Token expiration in days')
    .action(async (options: { name: string; scope: string[]; expires?: string }) => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            if (!config) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            const expiresInDays = options.expires ? parseInt(options.expires, 10) : undefined;

            info(`Creating token "${options.name}"...`);

            const result = await cloudClient.createToken(
                config.projectId,
                options.name,
                options.scope,
                expiresInDays
            );

            console.log();
            success('Token created successfully!');
            console.log();
            console.log(colors.yellow('⚠️  Copy this token now - it will NOT be shown again!'));
            console.log();
            console.log(colors.bold('  Token: ') + colors.cyan(result.token));
            console.log();
            console.log('  Name:', result.name);
            console.log('  Scopes:', result.scopes.join(', '));
            if (result.expiresAt) {
                console.log('  Expires:', new Date(result.expiresAt).toLocaleDateString());
            }
            console.log();
            console.log(colors.dim('Add this to your CI/CD secrets as AXION_TOKEN'));
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

tokensCommand
    .command('list')
    .description('List all service tokens')
    .action(async () => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            if (!config) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            info('Fetching tokens...');

            const tokens = await cloudClient.listTokens(config.projectId);

            if (tokens.length === 0) {
                info('No tokens found. Create one with "axn tokens create --name <name>"');
                return;
            }

            console.log(colors.bold('\nService Tokens:\n'));

            for (const token of tokens) {
                const status = token.isActive
                    ? colors.green('● Active')
                    : colors.red('○ Revoked');

                console.log(`  ${status}  ${colors.bold(token.name)}`);
                console.log(`    Prefix: ${colors.dim(token.tokenPrefix + '...')}`);
                console.log(`    Scopes: ${token.scopes.join(', ')}`);
                console.log(`    Created by: ${token.createdBy}`);
                if (token.lastUsedAt) {
                    console.log(`    Last used: ${new Date(token.lastUsedAt).toLocaleString()}`);
                }
                if (token.expiresAt) {
                    console.log(`    Expires: ${new Date(token.expiresAt).toLocaleDateString()}`);
                }
                console.log(`    ID: ${colors.dim(token.id)}`);
                console.log();
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

tokensCommand
    .command('revoke <token-id>')
    .description('Revoke a service token')
    .action(async (tokenId: string) => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            const config = await loadCloudConfig(process.cwd());
            if (!config) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            info(`Revoking token ${tokenId}...`);

            await cloudClient.revokeToken(config.projectId, tokenId);

            console.log();
            success('Token revoked successfully!');
            console.log();
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Drift Command
 * Detect differences between local and cloud secrets
 */
program
    .command('drift')
    .description('Detect drift between local and cloud secrets')
    .option('--json', 'Output as JSON')
    .option('--ci', 'Exit with code 1 if drift detected (for CI)')
    .action(async (options: { json?: boolean; ci?: boolean }) => {
        try {
            if (!(await isAuthenticated())) {
                error('Not logged in. Run "axn login" first.');
            }

            if (!(await isCloudLinked(process.cwd()))) {
                error('Project not linked. Run "axn link <project-id>" first.');
            }

            info('Comparing local and cloud secrets...');

            const drift = await manifest.detectDrift();

            if (options.json) {
                console.log(JSON.stringify(drift, null, 2));
            } else {
                console.log();

                if (!drift.hasDrift) {
                    success('No drift detected! Local and cloud are in sync.');
                    console.log();
                    return;
                }

                console.log(colors.yellow(`⚠️  Drift detected: ${drift.summary.total} difference(s)`));
                console.log();

                // Local only (not pushed)
                if (drift.localOnly.length > 0) {
                    console.log(colors.bold(colors.green('+ Local only (not pushed):')));
                    for (const item of drift.localOnly) {
                        const serviceBadge = item.service === '_global' ? '' : colors.dim(` [${item.service}]`);
                        console.log(colors.green(`  + ${item.key}${serviceBadge}`));
                    }
                    console.log();
                }

                // Cloud only (not pulled)
                if (drift.cloudOnly.length > 0) {
                    console.log(colors.bold(colors.red('− Cloud only (not pulled):')));
                    for (const item of drift.cloudOnly) {
                        const serviceBadge = item.service === '_global' ? '' : colors.dim(` [${item.service}]`);
                        console.log(colors.red(`  − ${item.key}${serviceBadge}`));
                    }
                    console.log();
                }

                // Modified (different values)
                if (drift.modified.length > 0) {
                    console.log(colors.bold(colors.yellow('~ Modified (different values):')));
                    for (const item of drift.modified) {
                        const serviceBadge = item.service === '_global' ? '' : colors.dim(` [${item.service}]`);
                        console.log(colors.yellow(`  ~ ${item.key}${serviceBadge}`));
                        console.log(colors.dim(`      local:  ${maskValue(item.localValue)}`));
                        console.log(colors.dim(`      cloud:  ${maskValue(item.cloudValue)}`));
                    }
                    console.log();
                }

                console.log(colors.dim('Run "axn sync --push" to push local changes to cloud.'));
                console.log(colors.dim('Run "axn sync --pull" to pull cloud changes to local.'));
                console.log();
            }

            // CI mode: exit 1 if drift detected
            if (options.ci && drift.hasDrift) {
                process.exit(1);
            }
        } catch (err) {
            error((err as Error).message);
        }
    });

/**
 * Masks a secret value for display (shows first/last 2 chars)
 */
function maskValue(value: string): string {
    if (value.length <= 8) {
        return '****';
    }
    return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

program.parse();
