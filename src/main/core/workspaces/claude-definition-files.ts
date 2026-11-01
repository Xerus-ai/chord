import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Skill, subagent and slash-command files run code too, without asking
 * (code.claude.com/docs/en/skills, devstation-493):
 *   - frontmatter `hooks` run once the skill or agent is used, and keep
 *     running for the session; `mcpServers` start servers; `allowed-tools`
 *     lets the agent run commands without asking;
 *   - a `!` shell line (`` !`cmd` `` after whitespace, or a ```` ```! ````
 *     block) runs when the file is invoked, before the model sees it.
 * The exact text of those parts is what the user approves. Files are the
 * repository's: committed at a ref, or tracked in a checkout — at any depth,
 * as Claude Code also loads nested `<dir>/.claude/skills`.
 */

const DEFINITION_FILE =
  /(^|\/)\.claude\/(skills\/[^/]+\/SKILL\.md|agents\/.+\.md|commands\/.+\.md)$/;

const CODE_KEYS = new Set(['hooks', 'mcpServers', 'allowed-tools']);

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;
/** `!` must start the line or follow whitespace; `KEY=!`x`` is literal text. */
const INLINE_SHELL = /(?:^|[ \t])(!`[^`\n]+`)/gm;
const FENCED_SHELL = /^```!\n[\s\S]*?^```$/gm;

/** Each code key's line plus the lines nested under it, up to the next top-level key. */
function pickFrontmatterBlocks(frontmatter: string): string[] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of frontmatter.split('\n')) {
    const key = /^([^\s#][^:]*):/.exec(line)?.[1].trim();
    if (key !== undefined) {
      current = CODE_KEYS.has(key) ? [line] : null;
      if (current) blocks.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return blocks.map((block) => block.join('\n').trimEnd());
}

/** The parts of a definition file that run code, as written; null when there are none. */
export function pickDefinitionCode(content: string): string | null {
  const text = content.replace(/\r\n/g, '\n');
  const frontmatter = FRONTMATTER.exec(text);
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const parts = [
    ...(frontmatter ? pickFrontmatterBlocks(frontmatter[1]) : []),
    ...[...body.matchAll(INLINE_SHELL)].map((match) => match[1]),
    ...(body.match(FENCED_SHELL) ?? []),
  ];
  return parts.length > 0 ? parts.join('\n') : null;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout;
}

function definitionPaths(nulSeparated: string): string[] {
  return nulSeparated.split('\0').filter((file) => DEFINITION_FILE.test(file));
}

/** `read` returns null for a file that isn't there (tracked, but deleted in the checkout). */
async function collect(
  files: string[],
  read: (file: string) => Promise<string | null>
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of files) {
    const content = await read(file);
    const code = content === null ? null : pickDefinitionCode(content);
    if (code !== null) result[file] = code;
  }
  return result;
}

/** The definition files committed at `ref` that run code, by repository path. */
export async function readDefinitionCodeAtRef(
  repoPath: string,
  ref: string
): Promise<Record<string, string>> {
  const files = definitionPaths(await git(repoPath, ['ls-tree', '-r', '-z', '--name-only', ref]));
  return collect(files, (file) => git(repoPath, ['show', `${ref}:${file}`]));
}

/** The checkout's tracked definition files that run code, as they are in its working tree. */
export async function readDefinitionCode(checkoutPath: string): Promise<Record<string, string>> {
  const files = definitionPaths(await git(checkoutPath, ['ls-files', '-z']));
  return collect(files, async (file) => {
    const absolute = path.join(checkoutPath, file);
    return existsSync(absolute) ? readFile(absolute, 'utf8') : null;
  });
}
