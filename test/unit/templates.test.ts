/**
 * Templates Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
    resolveTemplates,
    extractReferences,
    validateTemplate,
    hasTemplates,
    validateJson,
    isJsonValue,
    CircularReferenceError,
    MissingReferenceError,
} from '../../src/core/templates.js';

describe('Templates', () => {
    describe('resolveTemplates', () => {
        it('should resolve simple {{KEY}} templates', () => {
            const vars = {
                USER: 'myuser',
                PASS: 'secret',
                URL: 'postgres://{{USER}}:{{PASS}}@localhost/db',
            };

            const result = resolveTemplates(vars);

            expect(result.URL).toBe('postgres://myuser:secret@localhost/db');
            expect(result.USER).toBe('myuser');
            expect(result.PASS).toBe('secret');
        });

        it('should resolve legacy @ref:KEY syntax', () => {
            const vars = {
                DATABASE_URL: 'postgres://localhost/db',
                API_DATABASE_URL: '@ref:DATABASE_URL',
            };

            const result = resolveTemplates(vars);

            expect(result.API_DATABASE_URL).toBe('postgres://localhost/db');
        });

        it('should resolve mixed {{KEY}} and @ref:KEY in same variable', () => {
            const vars = {
                HOST: 'localhost',
                PORT: '5432',
                CONNECTION: 'host={{HOST}} port=@ref:PORT',
            };

            const result = resolveTemplates(vars);

            expect(result.CONNECTION).toBe('host=localhost port=5432');
        });

        it('should resolve nested templates', () => {
            const vars = {
                PROTOCOL: 'https',
                HOST: 'api.example.com',
                BASE_URL: '{{PROTOCOL}}://{{HOST}}',
                API_URL: '{{BASE_URL}}/v1',
            };

            const result = resolveTemplates(vars);

            expect(result.BASE_URL).toBe('https://api.example.com');
            expect(result.API_URL).toBe('https://api.example.com/v1');
        });

        it('should handle multiple references in one value', () => {
            const vars = {
                A: 'apple',
                B: 'banana',
                C: 'cherry',
                ALL: '{{A}}, {{B}}, {{C}}',
            };

            const result = resolveTemplates(vars);

            expect(result.ALL).toBe('apple, banana, cherry');
        });

        it('should detect circular references', () => {
            const vars = {
                A: '{{B}}',
                B: '{{A}}',
            };

            expect(() => resolveTemplates(vars)).toThrow(CircularReferenceError);
        });

        it('should detect self-reference', () => {
            const vars = {
                A: '{{A}}',
            };

            expect(() => resolveTemplates(vars)).toThrow(CircularReferenceError);
        });

        it('should throw on missing reference', () => {
            const vars = {
                URL: '{{MISSING_KEY}}',
            };

            expect(() => resolveTemplates(vars)).toThrow(MissingReferenceError);
        });

        it('should handle escaped braces', () => {
            const vars = {
                TEMPLATE: 'Use \\{{NAME}} for templates',
            };

            const result = resolveTemplates(vars);

            expect(result.TEMPLATE).toBe('Use {{NAME}} for templates');
        });

        it('should preserve values without templates', () => {
            const vars = {
                PLAIN: 'hello world',
                NUMBER: '12345',
                SPECIAL: 'a=b&c=d',
            };

            const result = resolveTemplates(vars);

            expect(result.PLAIN).toBe('hello world');
            expect(result.NUMBER).toBe('12345');
            expect(result.SPECIAL).toBe('a=b&c=d');
        });
    });

    describe('extractReferences', () => {
        it('should extract {{KEY}} references', () => {
            const refs = extractReferences('{{USER}}:{{PASS}}@{{HOST}}');
            expect(refs).toEqual(['USER', 'PASS', 'HOST']);
        });

        it('should extract @ref:KEY references', () => {
            const refs = extractReferences('@ref:DATABASE_URL');
            expect(refs).toEqual(['DATABASE_URL']);
        });

        it('should extract mixed references', () => {
            const refs = extractReferences('{{USER}}:@ref:PASS');
            expect(refs).toEqual(['USER', 'PASS']);
        });

        it('should return empty array for no references', () => {
            const refs = extractReferences('plain value');
            expect(refs).toEqual([]);
        });

        it('should deduplicate references', () => {
            const refs = extractReferences('{{KEY}}{{KEY}}');
            expect(refs).toEqual(['KEY']);
        });
    });

    describe('validateTemplate', () => {
        it('should return no errors for valid template', () => {
            const errors = validateTemplate('{{USER}}:{{PASS}}', ['USER', 'PASS']);
            expect(errors).toEqual([]);
        });

        it('should return errors for missing keys', () => {
            const errors = validateTemplate('{{USER}}:{{MISSING}}', ['USER']);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('MISSING');
        });
    });

    describe('hasTemplates', () => {
        it('should detect {{KEY}} templates', () => {
            expect(hasTemplates('{{KEY}}')).toBe(true);
            expect(hasTemplates('prefix {{KEY}} suffix')).toBe(true);
        });

        it('should detect @ref:KEY templates', () => {
            expect(hasTemplates('@ref:KEY')).toBe(true);
        });

        it('should return false for no templates', () => {
            expect(hasTemplates('plain value')).toBe(false);
            expect(hasTemplates('')).toBe(false);
        });
    });

    describe('validateJson', () => {
        it('should parse valid JSON object', () => {
            const result = validateJson('{"key":"value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('should parse valid JSON array', () => {
            const result = validateJson('[1,2,3]');
            expect(result).toEqual([1, 2, 3]);
        });

        it('should return null for invalid JSON', () => {
            expect(validateJson('not json')).toBeNull();
            expect(validateJson('{broken}')).toBeNull();
        });
    });

    describe('isJsonValue', () => {
        it('should detect JSON objects', () => {
            expect(isJsonValue('{"key":"value"}')).toBe(true);
            expect(isJsonValue(' { "key": "value" } ')).toBe(true);
        });

        it('should detect JSON arrays', () => {
            expect(isJsonValue('[1,2,3]')).toBe(true);
            expect(isJsonValue(' ["a", "b"] ')).toBe(true);
        });

        it('should return false for non-JSON', () => {
            expect(isJsonValue('plain string')).toBe(false);
            expect(isJsonValue('123')).toBe(false);
        });
    });
});
