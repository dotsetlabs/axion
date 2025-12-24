import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { cloudClient } from '../cloud/client.js';
import { isAuthenticated, loadCloudConfig } from '../cloud/auth.js';

export function registerTokensCommands(program: Command) {
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
}
