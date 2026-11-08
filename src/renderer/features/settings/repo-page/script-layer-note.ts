import type { ConfigLayer } from '@shared/repo-config';

/**
 * Repo › Run & test: what a script field says about running it, from where
 * its value comes — the user's own runs without asking (their run scripts
 * replacing the team's whole), the team file's asks first, and with no
 * script anywhere (`default`) there is nothing to say.
 */
export function describeScriptLayer(layer: ConfigLayer, script: 'single' | 'run'): string | null {
  if (layer === 'justMe') {
    return script === 'run'
      ? "Yours: runs without asking, in place of the team file's run scripts."
      : 'Yours: runs without asking.';
  }
  if (layer === 'team') return "From the team file: asks before it runs, until you've approved it.";
  return null;
}
