
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManifestManager } from '../../src/core/manifest';
import { cloudClient } from '../../src/cloud/client';
import { loadCloudConfig } from '../../src/cloud/auth';
import { encrypt, serializeEncrypted, generateProjectKey } from '../../src/core/crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

// Mock dependencies
vi.mock('../../src/cloud/client');
vi.mock('../../src/cloud/auth');

const TEST_DIR = '.test-axion-sync';

describe('Manifest Sync Logic', () => {
    let manager: ManifestManager;
    let projectKey: string;

    beforeEach(async () => {
        // Setup test directory
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
        await mkdir(TEST_DIR, { recursive: true });
        await mkdir(join(TEST_DIR, '.dotset', 'axion'), { recursive: true });

        // Generate key
        projectKey = generateProjectKey();
        await writeFile(join(TEST_DIR, '.dotset/axion/key'), projectKey);

        manager = new ManifestManager({ workDir: TEST_DIR });

        // Mock auth to return a project
        (loadCloudConfig as any).mockResolvedValue({ projectId: 'test-project' });
        (cloudClient.pulse as any).mockResolvedValue('token');
    });

    afterEach(() => {
        vi.clearAllMocks();
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should prefer local manifest if version is higher (fix for data loss)', async () => {
        // 1. Create LOCAL manifest (Version 2)
        const localManifest = {
            services: { _global: { RESULT: 'LOCAL_WIN' } },
            version: 2, // Logical version number
        };
        const localEncrypted = serializeEncrypted(await encrypt(JSON.stringify(localManifest), projectKey));
        await writeFile(join(TEST_DIR, '.dotset', 'axion', 'manifest.enc'), localEncrypted);

        // 2. Mock CLOUD manifest (Version 1 - Stale)
        const cloudManifest = {
            services: { _global: { RESULT: 'CLOUD_WIN' } },
            version: 1,
        };
        const cloudEncrypted = serializeEncrypted(await encrypt(JSON.stringify(cloudManifest), projectKey));

        // Mock cloud fetch
        (cloudClient.fetchManifest as any).mockResolvedValue({
            encryptedData: cloudEncrypted,
        });

        // 3. Load
        const loaded = await manager.load();

        // 4. Assert
        expect(loaded.services._global.RESULT).toBe('LOCAL_WIN');
        expect(loaded.version).toBe(2);
    });

    it('should prefer cloud manifest if version is higher', async () => {
        // 1. Create LOCAL manifest (Version 1)
        const localManifest = {
            services: { _global: { RESULT: 'LOCAL_LOSS' } },
            version: 1,
        };
        const localEncrypted = serializeEncrypted(await encrypt(JSON.stringify(localManifest), projectKey));
        await writeFile(join(TEST_DIR, '.dotset', 'axion', 'manifest.enc'), localEncrypted);

        // 2. Mock CLOUD manifest (Version 3 - Newer)
        const cloudManifest = {
            services: { _global: { RESULT: 'CLOUD_WIN' } },
            version: 3,
        };
        const cloudEncrypted = serializeEncrypted(await encrypt(JSON.stringify(cloudManifest), projectKey));

        (cloudClient.fetchManifest as any).mockResolvedValue({
            encryptedData: cloudEncrypted,
        });

        // 3. Load
        const loaded = await manager.load();

        // 4. Assert
        expect(loaded.services._global.RESULT).toBe('CLOUD_WIN');
        expect(loaded.version).toBe(3);
    });
});
