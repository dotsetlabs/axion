import { Command } from 'commander';
import { colors, success, error } from '../utils/ui.js';
import { cloudClient } from '../cloud/client.js';
import { isAuthenticated, loadCloudConfig } from '../cloud/auth.js';

export function registerHistoryCommands(program: Command) {
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
}
