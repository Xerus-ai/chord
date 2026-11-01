import { err, ok, type Result } from '@shared/result';

export interface JiraAuth {
  siteUrl: string;
  email: string;
  token: string;
}

/** `status` is null when no response came back (DNS, refused, TLS…). */
export type JiraHttpError = { status: number | null; message: string };

function describeJiraError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    const messages = [
      ...(parsed.errorMessages ?? []),
      ...Object.values(parsed.errors ?? {}),
    ].filter(Boolean);
    if (messages.length > 0) return `Jira API error ${status}: ${messages.join('; ')}`;
  } catch {
    // Not JSON: the raw body below says what Jira said.
  }
  const snippet = body.slice(0, 200);
  return `Jira API error ${status}${snippet ? `: ${snippet}` : ''}`;
}

/**
 * The Jira provider's one transport. `path` is appended to the site URL as
 * given (a site behind a path prefix keeps it). A non-2xx answer is an error
 * carrying Jira's own messages.
 */
export async function requestJira(
  auth: JiraAuth,
  path: string,
  options: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {}
): Promise<Result<unknown, JiraHttpError>> {
  const url = new URL(`${auth.siteUrl.replace(/\/+$/, '')}${path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const basic = Buffer.from(`${auth.email}:${auth.token}`).toString('base64');

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    return err({ status: null, message: error instanceof Error ? error.message : String(error) });
  }

  const text = await response.text();
  if (!response.ok) {
    return err({ status: response.status, message: describeJiraError(response.status, text) });
  }
  try {
    return ok(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    return err({
      status: response.status,
      message: `Jira answered ${url.pathname} with something that is not JSON: ${text.slice(0, 200)}`,
    });
  }
}
