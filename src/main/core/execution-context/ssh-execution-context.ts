import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { isValidEnvVarName, quoteShellArg } from '@main/utils/shellEscape';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

/**
 * Builds the full shell command string to send over SSH.
 * When `root` is provided the command runs inside `cd root &&`.
 * Args are shell-escaped for safe remote execution.
 */
export function buildSshCommand(root: string | undefined, command: string, args: string[]): string {
  return `bash -l -c ${quoteShellArg(buildSshBody(root, command, args))}`;
}

function buildSshBody(root: string | undefined, command: string, args: string[]): string {
  const escaped = args.map(quoteShellArg).join(' ');
  const inner = args.length ? `${command} ${escaped}` : command;
  return root ? `cd ${quoteShellArg(root)} && ${inner}` : inner;
}

/**
 * Exports each `KEY=value` line read from stdin, up to a blank line. `export`
 * is a builtin: no process ever carries a value in its arguments.
 */
const EXPORT_ENV_FROM_STDIN =
  'while IFS= read -r chord_env && [ -n "$chord_env" ]; do export "$chord_env"; done;';

/** What to run over SSH, and what to write to its stdin (then close it). */
export interface SshInvocation {
  command: string;
  stdin: string | null;
}

/**
 * `buildSshCommand`, plus `env` for the command. The values travel on the
 * command's stdin, never in the command line — which the remote host lists
 * in its process table for every user to see.
 */
export function buildSshInvocation(
  root: string | undefined,
  command: string,
  args: string[],
  env: Record<string, string> = {}
): SshInvocation {
  const entries = Object.entries(env);
  if (entries.length === 0) return { command: buildSshCommand(root, command, args), stdin: null };
  const lines = entries.map(([key, value]) => {
    if (!isValidEnvVarName(key)) throw new Error(`Invalid environment variable name: ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`Environment variable ${key} contains a line break`);
    return `${key}=${value}\n`;
  });
  const body = `${EXPORT_ENV_FROM_STDIN} ${buildSshBody(root, command, args)}`;
  return { command: `bash -l -c ${quoteShellArg(body)}`, stdin: `${lines.join('')}\n` };
}

export class SshExecutionContext implements IExecutionContext {
  readonly root?: string;
  readonly supportsLocalSpawn = false;

  private readonly _lifetime = new AbortController();

  constructor(
    private readonly proxy: SshClientProxy,
    opts: { root?: string } = {}
  ) {
    this.root = opts.root;
  }

  exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { signal, env } = opts;
    const invocation = buildSshInvocation(this.root, command, args, env);
    const combined = this._signal(signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      this.proxy.client.exec(invocation.command, (execErr, stream) => {
        if (execErr) return reject(execErr);
        if (invocation.stdin !== null) stream.end(invocation.stdin);

        let stdout = '';
        let stderr = '';
        let settled = false;

        const onAbort = () => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        combined.addEventListener('abort', onAbort, { once: true });

        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });

        stream.on('close', (code: number | null) => {
          combined.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          if ((code ?? 0) === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(
              Object.assign(new Error(stderr || `Process exited with code ${code}`), {
                stdout,
                stderr,
              })
            );
          }
        });

        stream.on('error', (err: Error) => {
          combined.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    });
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const { signal } = opts;
    const full = buildSshCommand(this.root, command, args);
    const combined = this._signal(signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      this.proxy.client.exec(full, (execErr, stream) => {
        if (execErr) return reject(execErr);

        let settled = false;

        const onAbort = () => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        combined.addEventListener('abort', onAbort, { once: true });

        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          if (settled) return;
          if (!onChunk(chunk)) {
            stream.destroy();
          }
        });

        stream.on('close', () => {
          combined.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            resolve();
          }
        });

        stream.on('error', (err: Error) => {
          combined.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    });
  }

  dispose(): void {
    this._lifetime.abort();
  }

  private _signal(callerSignal?: AbortSignal): AbortSignal {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    return AbortSignal.any(signals);
  }
}
