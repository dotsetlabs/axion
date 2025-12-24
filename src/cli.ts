/**
 * Axion CLI
 *
 * Command-line interface for the Axion secrets management service.
 * Refactored to use modular command structure.
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerSecretsCommands } from './commands/secrets.js';
import { registerRunCommands } from './commands/run.js';
import { registerKeyCommands } from './commands/key.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerProjectCommands } from './commands/project.js';
import { registerMembersCommands } from './commands/members.js';
import { registerSyncCommands } from './commands/sync.js';
import { registerHistoryCommands } from './commands/history.js';
import { registerTokensCommands } from './commands/tokens.js';
import { registerDriftCommands } from './commands/drift.js';

const program = new Command();

program
    .name('axn')
    .description('Zero-Disk Secret Plane for micro-services')
    .version('1.0.0')
    .option('-s, --service <name>', 'Scope operations to a specific service');

// Register all command modules
registerInitCommand(program);
registerSecretsCommands(program);
registerRunCommands(program);
registerKeyCommands(program);
registerAuthCommands(program);
registerProjectCommands(program);
registerMembersCommands(program);
registerSyncCommands(program);
registerHistoryCommands(program);
registerTokensCommands(program);
registerDriftCommands(program);

program.parse();
