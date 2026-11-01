import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';
import { batchFileInvocation, isWindowsBatchFile } from './windows-batch';

const execFileAsync = promisify(execFile);

/** What to spawn for `command args`: a Windows batch file runs through cmd.exe. */
function spawnTarget(
  command: string,
  args: string[]
): { file: string; args: string[]; verbatim: boolean } {
  if (!isWindowsBatchFile(command)) return { file: command, args, verbatim: false };
  return { ...batchFileInvocation(command, args), verbatim: true };
}

/**
 * Node reports a missing working folder exactly like a missing program
 * ("spawn git ENOENT"), so a deleted repository read as git not being
 * installed (devstation-lq9d). When the folder is what is missing, say so.
 */
function explainSpawnFailure(error: unknown, root: string): unknown {
  if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT' || !root || existsSync(root)) {
    return error;
  }
  return new Error(`The folder ${root} does not exist`, { cause: error });
}

export class LocalExecutionContext implements IExecutionContext {
  readonly root: string;
  readonly supportsLocalSpawn = true;

  private readonly _lifetime = new AbortController();

  constructor(opts: { root?: string } = {}) {
    this.root = opts.root ?? '';
  }

  private _signal(callerSignal?: AbortSignal): AbortSignal {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    return AbortSignal.any(signals);
  }

  exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { timeout, maxBuffer, env } = opts;
    const target = spawnTarget(command, args);
    return execFileAsync(target.file, target.args, {
      cwd: this.root || undefined,
      env: env ? { ...process.env, ...env } : undefined,
      timeout,
      maxBuffer,
      signal: this._signal(opts.signal),
      windowsVerbatimArguments: target.verbatim,
    }).catch((error: unknown) => {
      throw explainSpawnFailure(error, this.root);
    }) as Promise<ExecResult>;
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this._signal(opts.signal);

      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      const target = spawnTarget(command, args);
      const child = spawn(target.file, target.args, {
        cwd: this.root || undefined,
        windowsVerbatimArguments: target.verbatim,
      });

      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (settled) return;
        if (!onChunk(chunk)) {
          child.kill('SIGTERM');
        }
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(explainSpawnFailure(err, this.root));
        }
      });

      child.on('close', () => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  }

  dispose(): void {
    this._lifetime.abort();
  }
}
