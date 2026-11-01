import { describe, expect, it } from 'vitest';
import { resolveInstallCommand } from './agent-provider-registry';
import { AGENT_PROVIDERS, getProvider } from './agent-providers';

/**
 * Install commands follow the platform and the vendor's own installer
 * (devstation-fez). Claude's was `curl … | bash`, which cannot run on
 * Windows, and Codex's was npm-only while Codex ships a standalone
 * installer (it is how Codex is installed on the machine that found this).
 * Each Windows installer below was fetched from its vendor on 2026-10-06 and
 * read: none asks a question, except Codex's, which is told not to.
 */
const pipesIntoAShell = /\|\s*(bash|sh)\b/;

describe('resolveInstallCommand', () => {
  it('never hands Windows a command that pipes into bash or sh', () => {
    for (const provider of AGENT_PROVIDERS) {
      const command = resolveInstallCommand(provider, 'win32');
      expect(command === null || !pipesIntoAShell.test(command), provider.id).toBe(true);
    }
  });

  it("installs Claude Code with Anthropic's installer for the platform", () => {
    const claude = getProvider('claude')!;
    expect(resolveInstallCommand(claude, 'darwin')).toBe(
      'curl -fsSL https://claude.ai/install.sh | bash'
    );
    expect(resolveInstallCommand(claude, 'win32')).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'
    );
  });

  it("installs Codex with OpenAI's standalone installer, without its closing question", () => {
    const codex = getProvider('codex')!;
    expect(resolveInstallCommand(codex, 'linux')).toBe(
      'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'
    );
    expect(resolveInstallCommand(codex, 'win32')).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CODEX_NON_INTERACTIVE=\'1\'; irm https://chatgpt.com/codex/install.ps1 | iex"'
    );
  });

  it('offers no command on Windows where the vendor publishes no Windows installer', () => {
    expect(resolveInstallCommand(getProvider('goose')!, 'win32')).toBeNull();
    expect(resolveInstallCommand(getProvider('goose')!, 'darwin')).toMatch(pipesIntoAShell);
  });

  it('keeps a package-manager command on every platform', () => {
    const gemini = getProvider('gemini')!;
    expect(resolveInstallCommand(gemini, 'win32')).toBe('npm install -g @google/gemini-cli');
    expect(resolveInstallCommand(gemini, 'linux')).toBe('npm install -g @google/gemini-cli');
  });
});
