import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

/**
 * Settings › Agents & models › Open agents in (devstation-0nu): what an agent
 * row in a work item's + menu opens. Chat stays the default, so nobody's menu
 * changes until they choose Terminal.
 */
describe('agentLaunch setting', () => {
  it('defaults to opening a chat', () => {
    expect(getDefaultForKey('agentLaunch')).toEqual({ openAgentsIn: 'chat' });
  });

  it('accepts chat or terminal, and nothing else', () => {
    const schema = appSettingsSchema.shape.agentLaunch;
    expect(schema.parse({ openAgentsIn: 'terminal' })).toEqual({ openAgentsIn: 'terminal' });
    expect(schema.safeParse({ openAgentsIn: 'browser' }).success).toBe(false);
  });
});
