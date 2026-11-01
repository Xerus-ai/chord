import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { log } from '@main/lib/logger';

const resolvedPathCache = new Map<string, string>();

export async function resolveAgentExecutable(opts: {
  providerId: string;
  cli: string | undefined;
}): Promise<string> {
  if (opts.cli) {
    const cached = resolvedPathCache.get(opts.providerId);
    if (cached) return cached;

    const ctx = new LocalExecutionContext();
    const resolved = await resolveCommandPath(opts.cli, ctx);
    if (resolved) {
      resolvedPathCache.set(opts.providerId, resolved);
      return resolved;
    }

    return opts.cli;
  }

  log.warn('resolveAgentExecutable: no cli configured, using providerId as binary name', {
    providerId: opts.providerId,
  });
  return opts.providerId;
}
