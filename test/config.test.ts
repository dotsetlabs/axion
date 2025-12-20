import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, isProtected, validateSecret } from '../src/core/config.js';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config Module', () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = join(tmpdir(), 'axion-config-test-' + Math.random().toString(36).slice(2));
        await mkdir(workDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    describe('loadConfig', () => {
        it('should return default config if no file exists', async () => {
            const config = await loadConfig(workDir);
            expect(config).toBeNull();
        });

        it('should load axion.config.yaml', async () => {
            const yaml = `
project_id: test-project
validation:
  DB_URL: ^postgres://
`;
            await writeFile(join(workDir, 'axion.config.yaml'), yaml);
            const config = await loadConfig(workDir);
            expect(config?.project_id).toBe('test-project');
            expect(config?.validation?.DB_URL).toBe('^postgres://');
        });
    });

    describe('isProtected', () => {
        it('should return false by default', () => {
            expect(isProtected('ANY_VAR', null)).toBe(false);
        });

        it('should respect protected config', () => {
            const config = {
                protected_keys: ['SECRET_KEY']
            };
            expect(isProtected('SECRET_KEY', config)).toBe(true);
            expect(isProtected('OTHER_KEY', config)).toBe(false);
        });
    });

    describe('validateSecret', () => {
        it('should pass if no validation rules', () => {
            expect(() => validateSecret('TEST', 'val', null)).not.toThrow();
        });

        it('should validate against regex', () => {
            const config = {
                validation: {
                    EMAIL: '^.+@.+\\..+$'
                }
            };

            expect(() => validateSecret('EMAIL', 'test@example.com', config)).not.toThrow();
            expect(() => validateSecret('EMAIL', 'invalid-email', config)).toThrow();
        });
    });
});
