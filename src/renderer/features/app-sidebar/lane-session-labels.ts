import { labelAgentSession } from '@shared/agent-session-label';
import type { SidebarLiveSessionSummary } from '@shared/sidebar-summaries';
import { distinguishLabels } from '@renderer/lib/distinguishing-labels';

/**
 * A lane's live sessions with the name each goes by and, side by side in the
 * sidebar, the name it shows: sessions titled alike start where they differ
 * (devstation-6w3p).
 */
export function labelLaneSessions(
  sessions: readonly SidebarLiveSessionSummary[]
): { session: SidebarLiveSessionSummary; label: string; shownLabel: string }[] {
  const labels = sessions.map((session) =>
    labelAgentSession({
      kind: session.kind,
      title: session.title,
      agentProviderId: session.providerId,
    })
  );
  const shown = distinguishLabels(labels);
  return sessions.map((session, index) => ({
    session,
    label: labels[index],
    shownLabel: shown[index],
  }));
}
