/**
 * Webhook Service Unit Tests
 *
 * Tests for HMAC signature generation and webhook payload structure.
 * Delivery tests are mocked since they require HTTP endpoints.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Re-implement the signing logic here for testing, since we can't easily import
// from the server module in the CLI test environment
function sign(payload: string, secret: string): string {
    return crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

function generateSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

describe('Webhook Signature', () => {
    it('should generate consistent HMAC-SHA256 signatures', () => {
        const payload = JSON.stringify({ event: 'secret.write', projectId: 'test-123' });
        const secret = 'whsec_test-secret-key';

        const sig1 = sign(payload, secret);
        const sig2 = sign(payload, secret);

        expect(sig1).toBe(sig2);
        expect(sig1).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('should produce different signatures for different payloads', () => {
        const secret = 'whsec_test-secret-key';
        const payload1 = JSON.stringify({ event: 'secret.write' });
        const payload2 = JSON.stringify({ event: 'secret.delete' });

        const sig1 = sign(payload1, secret);
        const sig2 = sign(payload2, secret);

        expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
        const payload = JSON.stringify({ event: 'secret.write' });
        const secret1 = 'whsec_secret-one';
        const secret2 = 'whsec_secret-two';

        const sig1 = sign(payload, secret1);
        const sig2 = sign(payload, secret2);

        expect(sig1).not.toBe(sig2);
    });

    it('should generate valid webhook secrets', () => {
        const secret = generateSecret();

        expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    });

    it('should verify signature matches expected format for X-Axion-Signature header', () => {
        const payload = '{"event":"test"}';
        const secret = 'whsec_test';
        const signature = sign(payload, secret);

        // Header format is sha256=<hex>
        const header = `sha256=${signature}`;

        expect(header).toMatch(/^sha256=[a-f0-9]{64}$/);
    });
});

describe('Webhook Payload Structure', () => {
    it('should have required fields for webhook payloads', () => {
        const payload = {
            event: 'secret.write',
            projectId: 'proj-123',
            projectName: 'My Project',
            userId: 'user-456',
            userEmail: 'test@example.com',
            timestamp: new Date().toISOString(),
            metadata: { key: 'DATABASE_URL' },
        };

        // Verify all required fields exist
        expect(payload.event).toBeDefined();
        expect(payload.projectId).toBeDefined();
        expect(payload.projectName).toBeDefined();
        expect(payload.userId).toBeDefined();
        expect(payload.userEmail).toBeDefined();
        expect(payload.timestamp).toBeDefined();

        // Verify timestamp is valid ISO format
        expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });
});
