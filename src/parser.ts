/**
 * Axion .env File Parser
 *
 * Parses standard .env file format for migration to Axion.
 *
 * Supports:
 * - KEY=value pairs
 * - Comments (lines starting with #)
 * - Quoted values (single and double quotes)
 * - Empty lines
 * - Export prefix (export KEY=value)
 * - Multiline values with quotes
 */

/**
 * Parsed environment variable entry
 */
export interface ParsedVariable {
    key: string;
    value: string;
    line: number;
}

/**
 * Parse result with variables and any errors
 */
export interface ParseResult {
    variables: ParsedVariable[];
    errors: Array<{ line: number; message: string }>;
}

/**
 * Parses a .env file content into key-value pairs
 *
 * @param content - The raw content of a .env file
 * @returns ParseResult with variables and any parsing errors
 */
export function parseEnvFile(content: string): ParseResult {
    const variables: ParsedVariable[] = [];
    const errors: Array<{ line: number; message: string }> = [];

    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        let line = lines[i].trim();

        // Skip empty lines and comments
        if (!line || line.startsWith('#')) {
            continue;
        }

        // Remove optional 'export ' prefix
        if (line.startsWith('export ')) {
            line = line.slice(7).trim();
        }

        // Find the first = sign
        const equalIndex = line.indexOf('=');
        if (equalIndex === -1) {
            errors.push({ line: lineNumber, message: 'Missing "=" in variable declaration' });
            continue;
        }

        const key = line.slice(0, equalIndex).trim();
        let value = line.slice(equalIndex + 1);

        // Validate key
        if (!isValidVariableName(key)) {
            errors.push({
                line: lineNumber,
                message: `Invalid variable name "${key}". Use only letters, numbers, and underscores.`,
            });
            continue;
        }

        // Handle quoted values
        value = parseValue(value);

        variables.push({ key, value, line: lineNumber });
    }

    return { variables, errors };
}

/**
 * Parses a value, handling quotes and escapes
 */
function parseValue(value: string): string {
    value = value.trim();

    // Double-quoted string
    if (value.startsWith('"') && value.endsWith('"')) {
        return value
            .slice(1, -1)
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }

    // Single-quoted string (no escape processing)
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1);
    }

    // Unquoted - strip inline comments
    const commentIndex = value.indexOf(' #');
    if (commentIndex !== -1) {
        value = value.slice(0, commentIndex);
    }

    return value.trim();
}

/**
 * Validates an environment variable name
 */
export function isValidVariableName(name: string): boolean {
    // Must start with letter or underscore, contain only alphanumeric and underscore
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Validates a service name
 */
export function isValidServiceName(name: string): boolean {
    // Allow alphanumeric, hyphens, and underscores; must start with letter
    return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) || name === '_global';
}

/**
 * Formats environment variables as .env file content
 *
 * @param variables - Record of key-value pairs
 * @returns Formatted .env file content
 */
export function formatEnvFile(variables: Record<string, string>): string {
    const lines: string[] = [];

    // Sort keys for consistent output
    const sortedKeys = Object.keys(variables).sort();

    for (const key of sortedKeys) {
        const value = variables[key];

        // Quote values that contain special characters
        const needsQuotes = /[\s#"'\\]/.test(value) || value.includes('\n');
        const formattedValue = needsQuotes ? `"${escapeValue(value)}"` : value;

        lines.push(`${key}=${formattedValue}`);
    }

    return lines.join('\n') + '\n';
}

/**
 * Escapes special characters in a value for .env format
 */
function escapeValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}
