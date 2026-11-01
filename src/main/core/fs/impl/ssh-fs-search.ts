import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { SearchMatch, SearchOptions, SearchResult } from '../types';
import { relativePath } from './ssh-fs-path';

export async function sshSearch(
  query: string,
  remotePath: string,
  exec: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  options?: SearchOptions
): Promise<SearchResult> {
  const searchPattern = options?.pattern || query;
  const basePath = remotePath;
  const maxResults = options?.maxResults || 10000;
  const caseFlag = options?.caseSensitive ? '' : '-i';

  const escapedPattern = quoteShellArg(searchPattern);

  let includeFilter = '';
  if (options?.fileExtensions && options.fileExtensions.length > 0) {
    const extensions = options.fileExtensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
    includeFilter = extensions.map((e) => `--include=${quoteShellArg(`*${e}`)}`).join(' ');
  }

  const command = `grep -rn ${caseFlag} ${includeFilter} -e ${escapedPattern} ${quoteShellArg(basePath)} 2>/dev/null | head -n ${maxResults}`;

  try {
    const result = await exec(command);

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { matches: [], total: 0, filesSearched: 0 };
    }

    const matches: SearchMatch[] = [];
    const lines = result.stdout.split('\n').filter((line) => line.trim());
    const seenFiles = new Set<string>();

    for (const line of lines) {
      const firstColon = line.indexOf(':');
      if (firstColon === -1) continue;

      const filePath = line.substring(0, firstColon);
      const rest = line.substring(firstColon + 1);

      const secondColon = rest.indexOf(':');
      if (secondColon === -1) continue;

      const lineNum = parseInt(rest.substring(0, secondColon), 10);
      const content = rest.substring(secondColon + 1);

      if (isNaN(lineNum)) continue;

      const relPath = relativePath(remotePath, filePath);

      if (options?.filePattern) {
        const patternRegex = new RegExp(options.filePattern);
        if (!patternRegex.test(relPath)) {
          continue;
        }
      }

      seenFiles.add(filePath);

      const searchPat = options?.caseSensitive ? searchPattern : searchPattern.toLowerCase();
      const column = content.indexOf(searchPat) + 1;

      matches.push({
        filePath: relPath,
        line: lineNum,
        column: column > 0 ? column : 1,
        content: content.trim(),
        preview: content.trim(),
      });
    }

    return {
      matches,
      total: matches.length,
      truncated: lines.length >= maxResults,
      filesSearched: seenFiles.size,
    };
  } catch (error) {
    log.error('Failed to search', { query, options, error });
    return { matches: [], total: 0, filesSearched: 0 };
  }
}

export async function sshListRecursive(
  remotePath: string,
  exec: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  options?: { includeDirs?: boolean; maxEntries?: number }
): Promise<{
  items: Array<{ path: string; type: 'file' | 'dir' }>;
  truncated: boolean;
}> {
  const includeDirs = options?.includeDirs ?? true;
  const maxEntries = options?.maxEntries ?? 5000;

  const pruneNames = [
    '.git',
    'node_modules',
    'dist',
    'build',
    '.next',
    'out',
    '.turbo',
    'coverage',
    '.nyc_output',
    '.cache',
    'tmp',
    'temp',
    '__pycache__',
    '.pytest_cache',
    'venv',
    '.venv',
    'target',
    '.terraform',
    '.serverless',
    'vendor',
    'bower_components',
    'worktrees',
    '.worktrees',
    '.DS_Store',
  ];

  const pruneExpr = pruneNames.map((name) => `-name ${quoteShellArg(name)}`).join(' -o ');

  const typeFilter = includeDirs ? '' : '-type f';
  const command = [
    `find ${quoteShellArg(remotePath)}`,
    `\\( ${pruneExpr} \\) -prune -o`,
    typeFilter ? `${typeFilter} -print` : '-print',
    `2>/dev/null`,
    `| head -n ${maxEntries + 1}`,
  ]
    .filter(Boolean)
    .join(' ');

  try {
    const result = await exec(command);

    const lines = result.stdout.split('\n').filter((line) => line.trim());

    const truncated = lines.length > maxEntries;
    const effectiveLines = truncated ? lines.slice(0, maxEntries) : lines;

    const items: Array<{ path: string; type: 'file' | 'dir' }> = [];

    for (const line of effectiveLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed === remotePath || trimmed === remotePath + '/') continue;

      const relPath = relativePath(remotePath, trimmed);
      if (!relPath) continue;

      const isDir = trimmed.endsWith('/');
      const cleanRel = relPath.replace(/\/$/, '');

      if (!cleanRel) continue;

      items.push({
        path: cleanRel,
        type: isDir ? 'dir' : 'file',
      });
    }

    const pathSet = new Set(items.map((i) => i.path));
    for (const item of items) {
      if (item.type === 'file') {
        const prefix = item.path + '/';
        for (const otherPath of pathSet) {
          if (otherPath.startsWith(prefix)) {
            item.type = 'dir';
            break;
          }
        }
      }
    }

    const finalItems = includeDirs ? items : items.filter((i) => i.type === 'file');

    return { items: finalItems, truncated };
  } catch {
    return { items: [], truncated: false };
  }
}
