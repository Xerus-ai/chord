function requireMainEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const CHORD_RELEASES_URL = requireMainEnv('CHORD_RELEASES_URL');
export const CHORD_DOCS_URL = requireMainEnv('CHORD_DOCS_URL');
export const CHORD_TERMS_URL = requireMainEnv('CHORD_TERMS_URL');
export const CHORD_PRIVACY_URL = requireMainEnv('CHORD_PRIVACY_URL');
export const CHORD_ISSUES_URL = requireMainEnv('CHORD_ISSUES_URL');
export const CHORD_SYNC_URL = requireMainEnv('CHORD_CLOUD_API_URL');
