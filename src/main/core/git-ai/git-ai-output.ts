/**
 * The agent's answer, read into the field. An answer that is not usable
 * throws; the caller shows why and what the agent said, and leaves the field
 * as it was. Nothing is invented in its place.
 */
export class GitAiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitAiOutputError';
  }
}

/** The body of an answer wrapped in one code fence (``` or ```lang), else the answer. */
function unwrapFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return fenced ? (fenced[1] ?? '') : trimmed;
}

export function parseCommitMessage(raw: string): string {
  const message = unwrapFence(raw).trim();
  if (!message) throw new GitAiOutputError('The answer was empty.');
  return message;
}

export function parsePullRequestFields(raw: string): { title: string; body: string } {
  const text = unwrapFence(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new GitAiOutputError('The answer is not the JSON object with a title and body.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new GitAiOutputError(`The answer is not valid JSON: ${(error as Error).message}`);
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.title !== 'string' || !record.title.trim()) {
    throw new GitAiOutputError('The answer has no title.');
  }
  if (typeof record.body !== 'string') {
    throw new GitAiOutputError('The answer has no body text.');
  }
  return { title: record.title.trim(), body: record.body.replace(/\s+$/, '') };
}
