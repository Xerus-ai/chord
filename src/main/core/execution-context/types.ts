export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
  /**
   * Extra environment variables, layered over the inherited environment.
   * Pass secrets here, never in `args`: a failed command's error repeats its
   * arguments, and that error is shown in the app; over SSH the values travel
   * on stdin, out of the remote host's process list.
   */
  env?: Record<string, string>;
}

/**
 * An execution context represents a host + optional working directory where commands run.
 * Implementations abstract the transport (local spawn vs SSH exec) so consumers
 * have no knowledge of whether they are running locally or remotely.
 */
export interface IExecutionContext {
  /** The working directory all commands run in. Undefined/empty = no cwd constraint. */
  readonly root?: string;

  /**
   * True only for LocalExecutionContext. Used by GitService to decide
   * whether to use CatFileBatch (local spawn) or git-show fallback (SSH).
   */
  readonly supportsLocalSpawn: boolean;

  /** Run a command and buffer all output. Rejects on non-zero exit code. */
  exec(command: string, args?: string[], opts?: ExecOptions): Promise<ExecResult>;

  /**
   * Run a command and stream stdout chunks to `onChunk`.
   * Return false from `onChunk` to abort the process early (resolves normally).
   * Passing `signal` rejects with an AbortError when the signal fires.
   */
  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts?: { signal?: AbortSignal }
  ): Promise<void>;

  /**
   * Abort all in-flight exec/execStreaming calls and release resources.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}
