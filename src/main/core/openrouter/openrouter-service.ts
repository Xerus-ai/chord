import { PRODUCT_URL } from '@shared/app-identity';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

const SECRET_KEY = 'chord-openrouter-api-key';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterService {
  private cachedKey: string | null | undefined = undefined;

  async saveKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
    const clean = apiKey.trim();
    if (!clean) {
      return { success: false, error: 'API key cannot be empty.' };
    }

    try {
      const res = await fetch(`${OPENROUTER_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${clean}` },
      });
      if (!res.ok) {
        return { success: false, error: 'Invalid API key — OpenRouter rejected the request.' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate API key.',
      };
    }

    try {
      await encryptedAppSecretsStore.setSecret(SECRET_KEY, clean);
      this.cachedKey = clean;
      capture('integration_connected', { provider: 'openrouter' });
      return { success: true };
    } catch (error) {
      log.error('Failed to store OpenRouter key:', error);
      return { success: false, error: 'Unable to store API key securely.' };
    }
  }

  async clearKey(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(SECRET_KEY);
      this.cachedKey = null;
      capture('integration_disconnected', { provider: 'openrouter' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear OpenRouter key:', error);
      return { success: false, error: 'Unable to remove API key.' };
    }
  }

  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    const key = await this.getKey();
    if (!key) return { connected: false };

    try {
      const res = await fetch(`${OPENROUTER_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return { connected: res.ok };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection check failed.',
      };
    }
  }

  async getKey(): Promise<string | null> {
    if (this.cachedKey !== undefined) return this.cachedKey;
    try {
      this.cachedKey = await encryptedAppSecretsStore.getSecret(SECRET_KEY);
      return this.cachedKey;
    } catch (error) {
      log.error('Failed to read OpenRouter key:', error);
      return null;
    }
  }

  async chatCompletion(
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    const key = await this.getKey();
    if (!key) throw new Error('OpenRouter API key not configured.');

    const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': PRODUCT_URL,
        'X-Title': 'Chord',
      },
      body: JSON.stringify({ model, messages, max_tokens: 300 }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${body || res.statusText}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices[0]?.message?.content ?? '';
  }
}

export const openRouterService = new OpenRouterService();
