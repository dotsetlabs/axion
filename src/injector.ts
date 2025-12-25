/**
 * Axion Process Injector
 *
 * Handles spawning child processes with injected environment variables.
 * Provides signal forwarding to ensure graceful shutdown propagation.
 *
 * Key Features:
 * - Merges custom env vars with current process.env
 * - Forwards SIGINT, SIGTERM, SIGHUP to child process
 * - Returns child's exit code to preserve exit semantics
 * - Streams child's stdio to parent for real-time output
 */

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Options for the run function
 */
export interface RunOptions {
    /** Environment variables to merge with process.env */
    env?: Record<string, string>;
    /** Working directory for the child process */
    cwd?: string;
    /** Whether to use shell (useful for complex commands) */
    shell?: boolean;
}

/**
 * Signals to forward to child process
 */
const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Runs a command with injected environment variables
 *
 * This function:
 * 1. Spawns the command as a child process
 * 2. Merges the provided env vars with process.env
 * 3. Forwards standard I/O streams
 * 4. Sets up signal forwarding for graceful shutdown
 * 5. Returns a promise that resolves with the exit code
 *
 * @param command - The command to execute
 * @param args - Arguments to pass to the command
 * @param options - Run options including env vars and cwd
 * @returns Promise resolving to the child process exit code
 */
export function run(
    command: string,
    args: string[],
    options: RunOptions = {}
): Promise<number> {
    return new Promise((resolve, reject) => {
        // Merge environment: process.env as base, then overlay custom vars
        const mergedEnv = {
            ...process.env,
            ...options.env,
        };

        // Spawn the child process
        const child: ChildProcess = spawn(command, args, {
            env: mergedEnv,
            cwd: options.cwd ?? process.cwd(),
            stdio: 'inherit', // Inherit stdin/stdout/stderr from parent
            shell: options.shell ?? false,
        });

        // Signal handlers for forwarding to child
        const signalHandlers: Map<NodeJS.Signals, () => void> = new Map();

        /**
         * Sets up signal forwarding from parent to child process
         */
        function setupSignalForwarding(): void {
            for (const signal of FORWARDED_SIGNALS) {
                const handler = () => {
                    if (child.pid) {
                        // Forward signal to child process
                        child.kill(signal);
                    }
                };
                signalHandlers.set(signal, handler);
                process.on(signal, handler);
            }
        }

        /**
         * Removes all signal handlers to prevent memory leaks
         */
        function cleanupSignalHandlers(): void {
            for (const [signal, handler] of signalHandlers) {
                process.removeListener(signal, handler);
            }
            signalHandlers.clear();
        }

        // Set up signal forwarding
        setupSignalForwarding();

        // Handle spawn errors (e.g., command not found)
        child.on('error', (error) => {
            cleanupSignalHandlers();
            reject(new Error(`Failed to start command "${command}": ${error.message}`));
        });

        // Handle child process exit
        child.on('close', (code, signal) => {
            cleanupSignalHandlers();

            if (signal) {
                // Child was killed by a signal
                // Convention: exit code = 128 + signal number
                // For simplicity, we'll use 130 for SIGINT, 143 for SIGTERM
                const signalCodes: Record<string, number> = {
                    SIGINT: 130,
                    SIGTERM: 143,
                    SIGHUP: 129,
                };
                resolve(signalCodes[signal] ?? 128);
            } else {
                // Normal exit with code
                resolve(code ?? 0);
            }
        });
    });
}

/**
 * Convenience function to run a shell command string
 *
 * @param commandString - Full command string (e.g., "npm run dev")
 * @param options - Run options
 * @returns Promise resolving to exit code
 */
/**
 * Merges environment variables
 * (Exported for testing)
 */
export function inject(original: NodeJS.ProcessEnv, overrides: Record<string, string>): NodeJS.ProcessEnv {
    return { ...original, ...overrides };
}

export function runShell(
    commandString: string,
    options: Omit<RunOptions, 'shell'> = {}
): Promise<number> {
    // Determine the shell based on platform
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['/c', commandString] : ['-c', commandString];

    return run(shell, shellArgs, { ...options, shell: false });
}
