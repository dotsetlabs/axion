import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { cloudClient } from '../cloud/client.js';
import {
    isAuthenticated,
    getCurrentUser,
    clearCredentials,
    loadCloudConfig,
} from '../cloud/auth.js';
import { ManifestManager } from '../core/manifest.js';

export function registerAuthCommands(program: Command) {
    const manifest = new ManifestManager();

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
}
