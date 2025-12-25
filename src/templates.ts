/**
 * Axion Secret Templating
 *
 * Provides inline variable interpolation using mustache-style {{KEY}} syntax.
 * Supports nested references and circular dependency detection.
 *
 * Syntax:
 * - {{KEY}} - Interpolate the value of KEY inline
 * - \{{ - Escaped literal (outputs {{)
 *
 * Example:
 *   PG_USER=myuser
 *   PG_PASS=secret
 *   DATABASE_URL=postgres://{{PG_USER}}:{{PG_PASS}}@localhost/db
 *   → postgres://myuser:secret@localhost/db
 */

/**
 * Template reference pattern: {{KEY}}
 * Captures the key name between double braces
 */
const TEMPLATE_REGEX = /\{\{([A-Za-z0-9_]+)\}\}/g;

/**
 * Legacy reference pattern: @ref:KEY
 * For backwards compatibility
 */
const REF_REGEX = /@ref:([A-Za-z0-9_]+)/g;

/**
 * Escape sequence for literal braces: \{{
 */
const ESCAPE_PLACEHOLDER = '\x00ESCAPED_BRACE\x00';

/**
 * Extracts all template references from a value
 *
 * @param value - The value to scan for references
 * @returns Array of referenced key names
 */
export function extractReferences(value: string): string[] {
    if (typeof value !== 'string') return [];

    const refs = new Set<string>();

    // Find {{KEY}} references
    let match = TEMPLATE_REGEX.exec(value);
    while (match) {
        refs.add(match[1]);
        match = TEMPLATE_REGEX.exec(value);
    }
    TEMPLATE_REGEX.lastIndex = 0; // Reset regex state

    // Find @ref:KEY references (legacy)
    match = REF_REGEX.exec(value);
    while (match) {
        refs.add(match[1]);
        match = REF_REGEX.exec(value);
    }
    REF_REGEX.lastIndex = 0; // Reset regex state

    return Array.from(refs);
}

/**
 * Validates template syntax and returns any errors
 *
 * @param value - The value to validate
 * @param availableKeys - Keys that are available for reference
 * @returns Array of error messages (empty if valid)
 */
export function validateTemplate(value: string, availableKeys: string[]): string[] {
    const errors: string[] = [];
    const refs = extractReferences(value);

    for (const ref of refs) {
        if (!availableKeys.includes(ref)) {
            errors.push(`Referenced key "${ref}" does not exist`);
        }
    }

    return errors;
}

/**
 * Error thrown when a circular reference is detected
 */
export class CircularReferenceError extends Error {
    constructor(public chain: string[]) {
        super(`Circular reference detected: ${chain.join(' → ')}`);
        this.name = 'CircularReferenceError';
    }
}

/**
 * Error thrown when a referenced key doesn't exist
 */
export class MissingReferenceError extends Error {
    constructor(public key: string, public referencedIn: string) {
        super(`Referenced key "${key}" not found (used in ${referencedIn})`);
        this.name = 'MissingReferenceError';
    }
}

/**
 * Resolves all template references in a set of variables
 *
 * Handles both {{KEY}} inline templates and @ref:KEY full replacements.
 * Detects circular references and missing keys.
 *
 * @param vars - Record of variable key-value pairs
 * @returns New record with all templates resolved
 * @throws CircularReferenceError if circular references are detected
 * @throws MissingReferenceError if a referenced key doesn't exist
 */
export function resolveTemplates(vars: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    const resolving = new Set<string>();
    const resolved = new Set<string>();

    /**
     * Recursively resolves a single value
     */
    function resolveValue(key: string, value: string, chain: string[] = []): string {
        if (typeof value !== 'string') return value;

        // Circular reference check
        if (resolving.has(key)) {
            throw new CircularReferenceError([...chain, key]);
        }

        // Already resolved
        if (resolved.has(key) && key in result) {
            return result[key];
        }

        resolving.add(key);
        const currentChain = [...chain, key];

        // Handle escape sequences: \{{ → placeholder
        let processedValue = value.replace(/\\\{\{/g, ESCAPE_PLACEHOLDER);

        // Replace {{KEY}} templates
        processedValue = processedValue.replace(TEMPLATE_REGEX, (match, refKey) => {
            if (!(refKey in vars)) {
                throw new MissingReferenceError(refKey, key);
            }

            // Recursively resolve the referenced value
            if (!resolved.has(refKey)) {
                return resolveValue(refKey, vars[refKey], currentChain);
            }

            return result[refKey] ?? vars[refKey];
        });

        // Replace @ref:KEY references (legacy - full value replacement)
        processedValue = processedValue.replace(REF_REGEX, (match, refKey) => {
            if (!(refKey in vars)) {
                throw new MissingReferenceError(refKey, key);
            }

            // Recursively resolve the referenced value
            if (!resolved.has(refKey)) {
                return resolveValue(refKey, vars[refKey], currentChain);
            }

            return result[refKey] ?? vars[refKey];
        });

        // Restore escaped braces
        processedValue = processedValue.replace(new RegExp(ESCAPE_PLACEHOLDER, 'g'), '{{');

        resolving.delete(key);
        resolved.add(key);
        result[key] = processedValue;

        return processedValue;
    }

    // Resolve all variables
    for (const key of Object.keys(vars)) {
        if (!resolved.has(key)) {
            resolveValue(key, vars[key]);
        }
    }

    return result;
}

/**
 * Checks if a value contains any template references
 *
 * @param value - The value to check
 * @returns true if the value contains templates
 */
export function hasTemplates(value: string): boolean {
    if (typeof value !== 'string') return false;

    TEMPLATE_REGEX.lastIndex = 0;
    REF_REGEX.lastIndex = 0;

    return TEMPLATE_REGEX.test(value) || REF_REGEX.test(value);
}

/**
 * Validates that a value is valid JSON
 *
 * @param value - The value to validate
 * @returns Parsed JSON object if valid, null if invalid
 */
export function validateJson(value: string): unknown | null {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Checks if a value appears to be JSON (object or array)
 *
 * @param value - The value to check
 * @returns true if value looks like JSON
 */
export function isJsonValue(value: string): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'));
}
