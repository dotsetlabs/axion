import { Command } from 'commander';
import { colors, success, error, info } from '../utils/ui.js';
import { ManifestManager } from '../core/manifest.js';
import {
    encrypt,
    decrypt,
    serializeEncrypted,
    deserializeEncrypted
} from '../core/crypto.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function registerKeyCommands(program: Command) {
    const manifest = new ManifestManager();

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
                const keyPath = join(process.cwd(), '.dotset/axion/key');
                await mkdir(dirname(keyPath), { recursive: true });
                await writeFile(keyPath, key, 'utf8');

                success('Project key restored successfully!');
            } catch (err) {
                error(`Restore failed: ${(err as Error).message}`);
            }
        });
}
