import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { cloudClient } from '../cloud/client.js';
import { ManifestManager, MANIFEST_FILENAME } from '../core/manifest.js';
import { isAuthenticated, loadCloudConfig, isCloudLinked, saveCloudConfig, unlinkCloud } from '../cloud/auth.js';

export function registerProjectCommands(program: Command) {
    const manifest = new ManifestManager();

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
}
