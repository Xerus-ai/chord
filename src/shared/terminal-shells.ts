export type TerminalShellId =
  | 'cmd'
  | 'powershell'
  | 'pwsh'
  | 'git-bash'
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'sh';

/** A plain shell the `+` launcher can open as a terminal tab. */
export interface TerminalShell {
  id: TerminalShellId;
  label: string;
  command: string;
  args: string[];
}
