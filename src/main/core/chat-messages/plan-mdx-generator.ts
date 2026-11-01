export function generatePlanMdx(
  entries: Array<{ text: string; completed: boolean }>,
  title?: string,
  rationale?: string
): string {
  const lines: string[] = [];
  lines.push(`# ${title ?? 'Implementation Plan'}\n`);

  if (rationale) {
    lines.push(`> ${rationale}\n`);
  }

  lines.push('## Steps\n');
  for (let i = 0; i < entries.length; i++) {
    const marker = entries[i].completed ? '- [x]' : `- [ ]`;
    lines.push(`${marker} **${i + 1}.** ${entries[i].text}`);
  }
  lines.push('');

  return lines.join('\n');
}
