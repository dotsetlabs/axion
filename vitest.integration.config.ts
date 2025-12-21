import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/integration/**/*.{test,spec}.ts'],
        environment: 'node',
        // Integration tests need longer timeouts
        testTimeout: 30000,
        hookTimeout: 30000,
        // Run sequentially to avoid port conflicts
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
    },
});
