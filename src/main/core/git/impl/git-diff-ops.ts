import {
  HEAD_MODE,
  toRefString,
  type DiffLine,
  type DiffMode,
  type DiffResult,
  type GitObjectRef,
} from '@shared/git';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { CatFileBatch } from './cat-file-batch';
import {
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
  parseDiffLines,
  stripTrailingNewline,
} from './git-utils';

export async function getFileAtRef(
  ctx: IExecutionContext,
  getCatFile: () => CatFileBatch | null,
  filePath: string,
  ref: string
): Promise<string | null> {
  const cf = getCatFile();
  if (cf) {
    try {
      return await cf.read(`${ref}:${filePath}`);
    } catch {
      // Batch channel failed — fall back to one-shot git show.
    }
  }
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['show', `${ref}:${filePath}`], {
      maxBuffer: MAX_DIFF_CONTENT_BYTES,
    });
    return stripTrailingNewline(stdout);
  } catch {
    return null;
  }
}

export async function getFileAtIndex(
  ctx: IExecutionContext,
  getCatFile: () => CatFileBatch | null,
  filePath: string
): Promise<string | null> {
  const cf = getCatFile();
  if (cf) {
    try {
      return await cf.read(`:0:${filePath}`);
    } catch {
      // Fall back
    }
  }
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['show', `:0:${filePath}`], {
      maxBuffer: MAX_DIFF_CONTENT_BYTES,
    });
    return stripTrailingNewline(stdout);
  } catch {
    return null;
  }
}

export async function getFileDiff(
  ctx: IExecutionContext,
  fs: FileSystemProvider,
  filePath: string,
  base: DiffMode | GitObjectRef = HEAD_MODE
): Promise<DiffResult> {
  const diffArgs = (() => {
    switch (base.kind) {
      case 'staged':
        return ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath];
      case 'head':
        return ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath];
      default:
        return [
          'diff',
          '--no-color',
          '--unified=2000',
          `${toRefString(base)}...HEAD`,
          '--',
          filePath,
        ];
    }
  })();

  const isObjectRef = base.kind !== 'head' && base.kind !== 'staged';

  let diffStdout: string | undefined;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, diffArgs, {
      maxBuffer: MAX_DIFF_OUTPUT_BYTES,
    });
    diffStdout = stdout;
  } catch {}

  const originalRef = isObjectRef ? toRefString(base as GitObjectRef) : 'HEAD';

  const getOriginalContent = async (): Promise<string | undefined> => {
    try {
      const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['show', `${originalRef}:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return undefined;
    }
  };

  const getModifiedContent = async (): Promise<string | undefined> => {
    if (isObjectRef) {
      try {
        const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['show', `HEAD:${filePath}`], {
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    }
    try {
      const result = await fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
      if (result.truncated) return undefined;
      return stripTrailingNewline(result.content);
    } catch {
      return undefined;
    }
  };

  if (diffStdout !== undefined) {
    const { lines, isBinary } = parseDiffLines(diffStdout);
    if (isBinary) return { lines: [], isBinary: true };

    const [originalContent, modifiedContent] = await Promise.all([
      getOriginalContent(),
      getModifiedContent(),
    ]);

    if (lines.length === 0) {
      if (modifiedContent !== undefined) {
        return {
          lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
          modifiedContent,
        };
      }
      if (originalContent !== undefined) {
        return {
          lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
          originalContent,
        };
      }
      return { lines: [] };
    }
    return { lines, originalContent, modifiedContent };
  }

  const [originalContent, modifiedContent] = await Promise.all([
    getOriginalContent(),
    getModifiedContent(),
  ]);

  if (modifiedContent !== undefined) {
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      originalContent,
      modifiedContent,
    };
  }
  if (originalContent !== undefined) {
    return {
      lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
      originalContent,
    };
  }
  return { lines: [] };
}

export async function getCommitFileDiff(
  ctx: IExecutionContext,
  commitHash: string,
  filePath: string
): Promise<DiffResult> {
  const getContentAt = async (ref: string): Promise<string | undefined> => {
    try {
      const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['show', `${ref}:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return undefined;
    }
  };

  let hasParent = true;
  try {
    await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', `${commitHash}~1`]);
  } catch {
    hasParent = false;
  }

  if (!hasParent) {
    const modifiedContent = await getContentAt(commitHash);
    if (modifiedContent === undefined) return { lines: [] };
    if (modifiedContent === '') return { lines: [], modifiedContent };
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      modifiedContent,
    };
  }

  let diffStdout: string | undefined;
  try {
    const { stdout } = await ctx.exec(
      'git',
      ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
      { maxBuffer: MAX_DIFF_OUTPUT_BYTES }
    );
    diffStdout = stdout;
  } catch {}

  let diffLines: DiffLine[] = [];
  if (diffStdout !== undefined) {
    const { lines, isBinary } = parseDiffLines(diffStdout);
    if (isBinary) return { lines: [], isBinary: true };
    diffLines = lines;
  }

  const [originalContent, modifiedContent] = await Promise.all([
    getContentAt(`${commitHash}~1`),
    getContentAt(commitHash),
  ]);

  if (diffLines.length > 0) return { lines: diffLines, originalContent, modifiedContent };

  if (modifiedContent !== undefined && modifiedContent !== '') {
    return {
      lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      originalContent,
      modifiedContent,
    };
  }
  if (originalContent !== undefined) {
    return {
      lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
      originalContent,
      modifiedContent,
    };
  }
  return { lines: [], originalContent, modifiedContent };
}
