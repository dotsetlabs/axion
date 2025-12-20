import { describe, it, expect, vi } from 'vitest';
import { run, inject } from '../src/core/injector.js';
import * as child_process from 'node:child_process';

vi.mock('node:child_process');

describe('Injector Module', () => {
    describe('inject', () => {
        it('should merge environment variables', () => {
            const originalEnv = { EXISTING: 'true' };
            const newVars = { NEW_VAR: '123' };

            const result = inject(originalEnv, newVars);

            expect(result).toEqual({
                EXISTING: 'true',
                NEW_VAR: '123'
            });
        });

        it('should override existing variables', () => {
            const originalEnv = { VAR: 'old' };
            const newVars = { VAR: 'new' };

            const result = inject(originalEnv, newVars);

            expect(result.VAR).toBe('new');
        });
    });

    describe('run', () => {
        it('should spawn a child process with injected env', async () => {
            const mockSpawn = vi.spyOn(child_process, 'spawn');
            const mockChild: any = {
                on: vi.fn(),
                stdout: { on: vi.fn(), pipe: vi.fn() },
                stderr: { on: vi.fn(), pipe: vi.fn() },
                kill: vi.fn()
            };

            // Should resolve on exit
            mockChild.on.mockImplementation((event: string, cb: Function) => {
                if (event === 'close') cb(0);
            });

            mockSpawn.mockReturnValue(mockChild);

            const vars = { INJECTED: 'true' };
            await run('echo', ['hello'], { env: vars });

            expect(mockSpawn).toHaveBeenCalled();
            const callArgs = mockSpawn.mock.calls[0];
            const envArg = (callArgs[2] as any).env;

            expect(envArg).toMatchObject({
                ...process.env,
                INJECTED: 'true'
            });
        });
    });
});
