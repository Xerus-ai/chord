import type { AcpSessionUpdate } from '@shared/acp-types';
import {
  resolvePermissionMode,
  type AgentControlCatalog,
  type CatalogSelection,
} from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { publishSessionCatalog } from '@main/core/agent-catalog/session-catalogs';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import {
  acpEffortTarget,
  acpModelTarget,
  acpModeTarget,
  acpSetRequest,
  applyCurrentModeUpdate,
  buildAcpCatalog,
  readAcpControls,
  type AcpControlsReply,
  type AcpSessionControls,
} from './acp-session-controls';

type SessionRequest = (method: string, params: Record<string, string>) => Promise<unknown>;

/**
 * One live ACP session's model, effort and mode, kept in step with what the
 * agent reports and switched in place — `session/set_config_option` (or the
 * legacy `set_model` / `set_mode`) — so a pick applies to the next turn
 * without restarting the conversation. Every change republishes the session's
 * catalog to the composer.
 */
export class AcpLiveControls {
  private controls: AcpSessionControls;
  private sessionCatalog: AgentControlCatalog;
  constructor(
    private readonly sessionId: string,
    private readonly providerId: AgentProviderId,
    reply: AcpControlsReply,
    private readonly request: SessionRequest,
    /** The agent switched mode by itself (a `current_mode_update` Chord did not ask for). */
    private readonly onModeReported: (modeId: string) => void
  ) {
    this.controls = readAcpControls(reply);
    this.sessionCatalog = buildAcpCatalog(providerId, this.controls, null);
    publishSessionCatalog(sessionId, this.sessionCatalog);
  }

  get catalog(): AgentControlCatalog {
    return this.sessionCatalog;
  }

  /** `config_option_update` / `current_mode_update` notifications. */
  handleUpdate(update: AcpSessionUpdate): void {
    if (update.sessionUpdate === 'config_option_update') {
      this.setControls(readAcpControls({ configOptions: update.configOptions }, this.controls));
    } else if (update.sessionUpdate === 'current_mode_update') {
      this.setControls(applyCurrentModeUpdate(this.controls, update.currentModeId));
      this.onModeReported(update.currentModeId);
    }
  }

  /**
   * Switches the session to the selection `resolve` derives from its catalog,
   * model first: switching models is what reveals the new model's effort
   * levels, so the selection is resolved again before effort is set. Returns
   * the selection the session now runs.
   */
  async applySelection(
    resolve: (catalog: AgentControlCatalog) => CatalogSelection
  ): Promise<CatalogSelection> {
    const model = acpModelTarget(this.controls, this.sessionCatalog, resolve(this.sessionCatalog));
    if (model !== null) await this.set('model', model);
    const selection = resolve(this.sessionCatalog);
    const effort = acpEffortTarget(this.controls, this.sessionCatalog, selection);
    if (effort !== null) await this.set('effort', effort);
    return selection;
  }

  /** Switches the session to the stored mode pick, resolved against its catalog (null = its default). */
  async applyPermissionMode(mode: ChatPermissionMode): Promise<void> {
    const model = this.controls.model?.currentValue ?? null;
    const resolved = resolvePermissionMode(this.sessionCatalog, model, mode);
    if (resolved === null) return;
    const target = acpModeTarget(this.controls, resolved.id);
    if (target !== null) await this.set('mode', target);
  }

  private async set(slot: keyof AcpSessionControls, value: string): Promise<void> {
    const control = this.controls[slot];
    if (!control) throw new Error(`ACP session ${this.sessionId} has no ${slot} control`);
    const { method, params } = acpSetRequest(control, value);
    const result = await this.request(method, params);
    const configOptions =
      typeof result === 'object' && result !== null && 'configOptions' in result
        ? (result.configOptions as unknown[])
        : null;
    // A config option reply carries the agent's full new state; a legacy
    // setter replies empty, having done exactly what was asked.
    this.setControls(
      configOptions
        ? readAcpControls({ configOptions }, this.controls)
        : { ...this.controls, [slot]: { ...control, currentValue: value } }
    );
  }

  private setControls(next: AcpSessionControls): void {
    this.controls = next;
    this.sessionCatalog = buildAcpCatalog(this.providerId, next, this.sessionCatalog);
    publishSessionCatalog(this.sessionId, this.sessionCatalog);
  }
}
