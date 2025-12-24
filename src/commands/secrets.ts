import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { ManifestManager, GLOBAL_SERVICE } from '../core/manifest.js';
import { isValidVariableName, isValidServiceName } from '../core/parser.js';
import { loadConfig, isProtected } from '../core/config.js';

export function registerSecretsCommands(program: Command) {
    const manifest = new ManifestManager();

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
                    // Raw view
                    const manifestData = await manifest.load();
                    console.log(colors.yellow('Note: --all shows raw manifest values without scope resolution.'));
                    console.log(colors.bold(`\nListing all variables (raw storage):\n`));

                    for (const [serviceName, vars] of Object.entries(manifestData.services)) {
                        const displayName = serviceName === GLOBAL_SERVICE ? 'global' : serviceName;
                        console.log(colors.bold(`\n[${displayName}] (default)`));
                        // ... logic simplified from cli.ts but maintaining intent
                        for (const [key, value] of Object.entries(vars as any)) {
                            console.log(`  ${colors.cyan(key)}=${colors.dim('********')}`);
                        }
                    }
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
     * Export Command
     * Export variables to a file format
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
}
