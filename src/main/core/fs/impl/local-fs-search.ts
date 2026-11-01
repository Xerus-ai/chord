import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import ignore from 'ignore';
import type { SearchMatch, SearchOptions, SearchResult } from '../types';

const BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.o',
  '.a',
]);

const SEARCH_IGNORES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.parcel-cache',
]);

export async function localSearch(
  projectPath: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const pattern = options.pattern || query;
  const matches: SearchMatch[] = [];
  const maxResults = options.maxResults || 10000;
  const fileExtensions = options.fileExtensions;
  const caseSensitive = options.caseSensitive ?? false;

  let filesSearched = 0;
  let truncated = false;

  let gitIgnore: ReturnType<typeof ignore> | undefined;
  try {
    const gitIgnorePath = join(projectPath, '.gitignore');
    const content = await fs.readFile(gitIgnorePath, 'utf-8');
    gitIgnore = ignore().add(content);
  } catch {}

  const searchDir = async (dirPath: string) => {
    let items;
    try {
      items = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }

      const itemPath = join(dirPath, item.name);

      if (item.isDirectory()) {
        // The ignore package only accepts POSIX paths — backslashes silently
        // fail to match, which disabled gitignore filtering on Windows.
        const relPath = relative(projectPath, itemPath).replace(/\\/g, '/');
        if (gitIgnore && gitIgnore.ignores(relPath)) continue;
        if (!SEARCH_IGNORES.has(item.name) && !item.name.startsWith('.')) {
          await searchDir(itemPath);
        }
      } else if (item.isFile()) {
        if (BINARY_EXTENSIONS.has(extname(itemPath).toLowerCase())) continue;

        if (fileExtensions && fileExtensions.length > 0) {
          const ext = extname(item.name).toLowerCase();
          if (
            !fileExtensions.some((e) => ext === e.toLowerCase() || ext === `.${e.toLowerCase()}`)
          ) {
            continue;
          }
        }

        if (options.filePattern) {
          const filePatternRegex = new RegExp(options.filePattern.replace(/\*/g, '.*'));
          if (!filePatternRegex.test(item.name)) continue;
        }

        filesSearched++;

        try {
          const fileStream = createReadStream(itemPath, { encoding: 'utf-8' });
          const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

          let lineNum = 0;
          for await (const line of rl) {
            lineNum++;

            if (line.includes('\0')) {
              fileStream.destroy();
              break;
            }

            const matchResult = caseSensitive
              ? line.includes(pattern)
              : line.toLowerCase().includes(pattern.toLowerCase());

            if (matchResult) {
              const column =
                (caseSensitive
                  ? line.indexOf(pattern)
                  : line.toLowerCase().indexOf(pattern.toLowerCase())) + 1;

              matches.push({
                filePath: relative(projectPath, itemPath).replace(/\\/g, '/'),
                line: lineNum,
                column,
                content: line.trim(),
                preview: line.trim().substring(0, 200),
              });

              if (matches.length >= maxResults) {
                fileStream.destroy();
                truncated = true;
                return;
              }
            }
          }
        } catch {}
      }
    }
  };

  await searchDir(projectPath);

  return { matches, total: matches.length, truncated, filesSearched };
}
