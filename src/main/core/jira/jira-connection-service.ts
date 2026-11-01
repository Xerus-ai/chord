import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { capture } from '@main/lib/telemetry';
import { requestJira, type JiraAuth } from './jira-http';

type JiraCreds = { siteUrl: string; email: string };

interface JiraKVSchema extends Record<string, unknown> {
  creds: JiraCreds;
}

interface JiraUser {
  accountId?: string;
  displayName?: string;
  name?: string;
  errorMessages?: string[];
}

const jiraKV = new KV<JiraKVSchema>('jira');

export class JiraConnectionService {
  private readonly JIRA_TOKEN_SECRET_KEY = 'chord-jira-token';

  async saveCredentials(
    siteUrl: string,
    email: string,
    token: string
  ): Promise<{ success: boolean; displayName?: string; error?: string }> {
    try {
      const me = await this.getMyself(siteUrl, email, token);
      await encryptedAppSecretsStore.setSecret(this.JIRA_TOKEN_SECRET_KEY, token);
      await this.writeCreds({ siteUrl, email });
      capture('integration_connected', { provider: 'jira' });
      return { success: true, displayName: me?.displayName };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      try {
        await encryptedAppSecretsStore.deleteSecret(this.JIRA_TOKEN_SECRET_KEY);
      } catch {}
      try {
        await jiraKV.del('creds');
      } catch {}
      capture('integration_disconnected', { provider: 'jira' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const creds = await this.readCreds();
      if (!creds) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
        };
      }

      const token = await encryptedAppSecretsStore.getSecret(this.JIRA_TOKEN_SECRET_KEY);
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
        };
      }

      const me = await this.getMyself(creds.siteUrl, creds.email, token);
      return {
        connected: true,
        displayName: me?.displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,
      };
    }
  }

  /** The stored credentials, or null when Jira isn't connected. */
  async readAuth(): Promise<JiraAuth | null> {
    const creds = await this.readCreds();
    if (!creds) return null;
    const token = await encryptedAppSecretsStore.getSecret(this.JIRA_TOKEN_SECRET_KEY);
    return token ? { ...creds, token } : null;
  }

  private async readCreds(): Promise<JiraCreds | null> {
    try {
      const obj = await jiraKV.get('creds');
      const siteUrl = String(obj?.siteUrl || '').trim();
      const email = String(obj?.email || '').trim();
      if (!siteUrl || !email) return null;
      return { siteUrl, email };
    } catch {
      return null;
    }
  }

  private async writeCreds(creds: JiraCreds): Promise<void> {
    await jiraKV.set('creds', { siteUrl: creds.siteUrl, email: creds.email });
  }

  private async getMyself(siteUrl: string, email: string, token: string): Promise<JiraUser> {
    const result = await requestJira({ siteUrl, email, token }, '/rest/api/3/myself');
    if (!result.success) throw new Error(result.error.message);
    const data = result.data as JiraUser | null;
    if (!data || data.errorMessages) {
      throw new Error('Failed to verify Jira token.');
    }
    return data;
  }
}

export const jiraConnectionService = new JiraConnectionService();
