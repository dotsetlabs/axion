import { Command } from 'commander';
import { colors, error } from '../utils/ui.js';
import { ManifestManager, GLOBAL_SERVICE } from '../core/manifest.js';
import { run } from '../core/injector.js';

export function registerRunCommands(program: Command) {
    const manifest = new ManifestManager();

    /**
     * Run Command
     * Executes a command with injected environment variables
     */
    program
        .command('run')
        .description('Run a command with injected environment variables')
        .argument('<command...>', 'Command and arguments to run')
        .option('--scope <env>', 'Environment scope (development, staging, production)', 'development')
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
                const [command, ...args] = commandArgs;

                if (!command) {
                    error('No command specified. Usage: axn run -- <command>');
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
}
