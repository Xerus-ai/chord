import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { detectTerminalShells } from './detect-terminal-shells';

export const terminalShellsController = createRPCController({
  /** Shells installed on this machine, default first — the `+` launcher's terminal list. */
  list: async () => {
    return ok({ shells: detectTerminalShells({ platform: process.platform, env: process.env }) });
  },
});
