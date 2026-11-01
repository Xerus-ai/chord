import type { Octokit } from '@octokit/rest';
import { githubConnectionService } from './github-connection-service';

let cachedOctokit: Octokit | null = null;
let cachedToken: string | null = null;

export async function getOctokit(): Promise<Octokit> {
  const octokit = await readConnectedOctokit();
  if (!octokit) throw new Error('Not authenticated');
  return octokit;
}

/** The signed-in client, or null when GitHub isn't connected (lookups name that as `not_connected`). */
export async function readConnectedOctokit(): Promise<Octokit | null> {
  const token = await githubConnectionService.getToken();
  if (!token) return null;
  if (token !== cachedToken) {
    const { Octokit } = await import('@octokit/rest');
    cachedOctokit = new Octokit({ auth: token });
    cachedToken = token;
  }
  return cachedOctokit;
}

export function clearOctokitCache(): void {
  cachedOctokit = null;
  cachedToken = null;
}
