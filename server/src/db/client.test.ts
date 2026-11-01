import { describe, expect, it } from 'vitest';
import { assertDatabaseConfigured } from './client.js';

/**
 * The boot-time guard behind the fail-open fix: a production server missing
 * DATABASE_URL must refuse to start, because without the DB there is nothing
 * to check authorization against.
 */
describe('assertDatabaseConfigured', () => {
  it('throws in production with no connection string', () => {
    expect(() =>
      assertDatabaseConfigured({
        hasConnectionString: false,
        isProduction: true,
        explicitDevMode: false,
        isTestRun: false,
      })
    ).toThrow(/DATABASE_URL is required when NODE_ENV=production/);
  });

  it('throws in production even when DEV_MODE=true — the opt-in never applies to production', () => {
    expect(() =>
      assertDatabaseConfigured({
        hasConnectionString: false,
        isProduction: true,
        explicitDevMode: true,
        isTestRun: false,
      })
    ).toThrow(/DATABASE_URL is required when NODE_ENV=production/);
  });

  it('throws outside production without the explicit DEV_MODE opt-in', () => {
    expect(() =>
      assertDatabaseConfigured({
        hasConnectionString: false,
        isProduction: false,
        explicitDevMode: false,
        isTestRun: false,
      })
    ).toThrow(/set DEV_MODE=true/);
  });

  it('allows DEV_MODE without a database outside production', () => {
    expect(() =>
      assertDatabaseConfigured({
        hasConnectionString: false,
        isProduction: false,
        explicitDevMode: true,
        isTestRun: false,
      })
    ).not.toThrow();
  });

  it('allows any environment when a connection string is present', () => {
    expect(() =>
      assertDatabaseConfigured({
        hasConnectionString: true,
        isProduction: true,
        explicitDevMode: false,
        isTestRun: false,
      })
    ).not.toThrow();
  });
});
