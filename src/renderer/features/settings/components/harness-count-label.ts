/**
 * What a CLI agent row's expander says it holds: the skills and commands
 * found in the agent's own folder. A bare count beside the version read as
 * part of it (devstation-nj4).
 */
export function describeHarnessCount(skills: number, commands: number): string {
  return [countOf(skills, 'skill'), countOf(commands, 'command')]
    .filter((part): part is string => part !== null)
    .join(', ');
}

function countOf(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
