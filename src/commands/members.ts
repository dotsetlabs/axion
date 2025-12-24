import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { cloudClient } from '../cloud/client.js';
import { isAuthenticated, loadCloudConfig, isCloudLinked } from '../cloud/auth.js';

export function registerMembersCommands(program: Command) {
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
}
