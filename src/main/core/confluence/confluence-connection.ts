import type { ConfluenceConnectionStatus } from '@shared/confluence';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { capture } from '@main/lib/telemetry';
import { fetchCurrentUser, type ConfluenceAuth } from './confluence-client';

/**
 * The Confluence connection on this device: site and email in the KV store,
 * the API token encrypted in the app secrets store — the same split the Jira
 * connection uses (per device, API token; P5 decision 2026-09-24).
 */

interface ConfluenceKVSchema extends Record<string, unknown> {
  creds: { siteUrl: string; email: string };
}

const confluenceKV = new KV<ConfluenceKVSchema>('confluence');
const TOKEN_SECRET_KEY = 'chord-confluence-token';

/**
 * Accepts what people paste — the site, a `/wiki` URL, or a page link — and
 * keeps the origin. Only Atlassian Cloud over HTTPS is supported.
 */
export function normalizeConfluenceSiteUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" is not a URL. Use your site, e.g. https://acme.atlassian.net`);
  }
  if (url.protocol !== 'https:') throw new Error('The Confluence site must use https.');
  return url.origin;
}

export async function saveConfluenceCredentials(input: {
  siteUrl: string;
  email: string;
  token: string;
}): Promise<{ success: true; displayName: string } | { success: false; error: string }> {
  try {
    const auth = {
      siteUrl: normalizeConfluenceSiteUrl(input.siteUrl),
      email: input.email.trim(),
      token: input.token.trim(),
    };
    if (!auth.email || !auth.token) throw new Error('Email and API token are required.');
    const user = await fetchCurrentUser(auth);
    await encryptedAppSecretsStore.setSecret(TOKEN_SECRET_KEY, auth.token);
    await confluenceKV.set('creds', { siteUrl: auth.siteUrl, email: auth.email });
    capture('integration_connected', { provider: 'confluence' });
    return { success: true, displayName: user.displayName };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function clearConfluenceCredentials(): Promise<{ success: true }> {
  await encryptedAppSecretsStore.deleteSecret(TOKEN_SECRET_KEY);
  await confluenceKV.del('creds');
  capture('integration_disconnected', { provider: 'confluence' });
  return { success: true };
}

/** The stored credentials, or null when this device has no Confluence connection. */
async function readConfluenceAuth(): Promise<ConfluenceAuth | null> {
  const creds = await confluenceKV.get('creds');
  if (!creds) return null;
  const token = await encryptedAppSecretsStore.getSecret(TOKEN_SECRET_KEY);
  if (!token) return null;
  return { siteUrl: creds.siteUrl, email: creds.email, token };
}

export async function requireConfluenceAuth(): Promise<ConfluenceAuth> {
  const auth = await readConfluenceAuth();
  if (!auth) {
    throw new Error('Confluence is not connected. Connect it in Settings › Integrations.');
  }
  return auth;
}

export async function checkConfluenceConnection(): Promise<ConfluenceConnectionStatus> {
  const auth = await readConfluenceAuth();
  if (!auth) return { connected: false };
  try {
    const user = await fetchCurrentUser(auth);
    return { connected: true, siteUrl: auth.siteUrl, displayName: user.displayName };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) };
  }
}
