import { describe, it, expect } from 'vitest';
import { parseEnvFile, formatEnvFile, isValidVariableName } from '../../src/parser.js';

describe('Parser Module', () => {
    describe('parseEnvFile', () => {
        it('should parse simple KEY=VALUE pairs', () => {
            const input = `
                DB_HOST=localhost
                PORT=3000
            `;
            const result = parseEnvFile(input);
            expect(result.variables).toHaveLength(2);
            expect(result.variables).toContainEqual({ key: 'DB_HOST', value: 'localhost', line: 2 });
            expect(result.variables).toContainEqual({ key: 'PORT', value: '3000', line: 3 });
        });

        it('should handle quoted values', () => {
            const input = 'MESSAGE="Hello World"';
            const result = parseEnvFile(input);
            expect(result.variables[0].value).toBe('Hello World');
        });

        it('should ignore comments', () => {
            const input = `
                # This is a comment
                KEY=value # Inline comment
            `;
            const result = parseEnvFile(input);
            expect(result.variables).toHaveLength(1);
            expect(result.variables[0].key).toBe('KEY');
            expect(result.variables[0].value).toBe('value');
        });

        it('should report errors for invalid lines', () => {
            const input = 'INVALID-LINE';
            const result = parseEnvFile(input);
            expect(result.errors).toHaveLength(1);
        });
    });

    describe('isValidVariableName', () => {
        it('should accept valid names', () => {
            expect(isValidVariableName('MY_VAR')).toBe(true);
            expect(isValidVariableName('valid_var_123')).toBe(true);
        });

        it('should reject invalid names', () => {
            expect(isValidVariableName('123_VAR')).toBe(false); // Starts with number
            expect(isValidVariableName('MY-VAR')).toBe(false);  // Hyphens not typically allowed in shell env vars (though debatable, strict parser says no)
        });
    });
});
