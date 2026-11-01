import { createContext, useContext, type ReactNode } from 'react';
import { isDocumentTab, type CenterTab, type DocumentTab, type PathMode } from './center-tab';
import type { SessionTabModel } from './session-tab-model';
import type { WorkItemCapabilities } from './work-item-access';

/**
 * Which documents a viewer can open, from their capabilities: a commit and a
 * plain file need the checkout (a teammate gets a file only as its pushed
 * diff); artifacts are all of them, or only those shared with an
 * artifacts-only viewer (`sharedArtifactIds`, required exactly then).
 */
export function offersDocumentTo(
  capabilities: Pick<WorkItemCapabilities, 'files' | 'changes' | 'artifactTabs'>,
  sharedArtifactIds: ReadonlySet<string> | null
): (tab: DocumentTab) => boolean {
  if ((capabilities.artifactTabs === 'shared') !== (sharedArtifactIds !== null)) {
    throw new Error(
      'The shared artifacts are needed exactly when artifact tabs are limited to them'
    );
  }
  return (tab) => {
    if (tab.kind === 'commit') return capabilities.files;
    if (tab.artifactId !== undefined) {
      return sharedArtifactIds === null || sharedArtifactIds.has(tab.artifactId);
    }
    return capabilities.files || (capabilities.changes && tab.mode === 'diff');
  };
}

/** Session tabs and the launcher: the owner's agents and terminals, or a teammate's view of the chats. */
export interface PaneSessions {
  byId: ReadonlyMap<string, SessionTabModel>;
  /** The owner ends the session (its tab closes with it); a teammate only closes the tab. */
  close: (sessionId: string) => void;
  /** The strip's `+`: the owner starts sessions and opens files; a teammate reopens a chat. */
  renderLauncher: (focusedWorktreeId: string | null) => ReactNode;
  /** What a pane with no tabs says, pointing at the `+`. */
  emptyLabel: string;
}

export interface DocumentBodyContext {
  /** Typing, commenting or saving in the document promotes its preview tab. */
  onDocumentTouched: () => void;
  /** Closes the tab in its pane. */
  onClose: () => void;
  /** Switches a path tab's mode (Diff · Preview · Edit); the tab remembers it. */
  onModeChange: (mode: PathMode) => void;
}

/**
 * What one view puts in the shared pane host: where its layout persists, which
 * tab kinds it offers, and the body for each document. The Room and session
 * bodies come from the view's `RetainedBodyHost`.
 */
export interface PaneHost {
  /** Store key for this view's layout, distinct per view for the same work item. */
  layoutKey: string;
  offersDocument: (tab: DocumentTab) => boolean;
  /** Null when the view has no local sessions: no session tabs, no launcher. */
  sessions: PaneSessions | null;
  renderDocument: (tab: DocumentTab, context: DocumentBodyContext) => ReactNode;
  /** Artifacts deleted while their tab was open. */
  missingArtifactIds: ReadonlySet<string>;
}

/**
 * Whether a view offers this tab: sessions and the Work item chat only with
 * sessions to show, documents per the view.
 */
export function isTabOffered(
  host: Pick<PaneHost, 'offersDocument' | 'sessions'>,
  tab: CenterTab
): boolean {
  if (!isDocumentTab(tab)) return host.sessions !== null;
  return host.offersDocument(tab);
}

/** The body for a pane's active tab when it is a document the view offers, else null. */
export function selectDocumentBody(
  host: Pick<PaneHost, 'offersDocument' | 'sessions' | 'renderDocument'>,
  tab: CenterTab,
  context: DocumentBodyContext
): ReactNode {
  if (!isDocumentTab(tab) || !isTabOffered(host, tab)) return null;
  return host.renderDocument(tab, context);
}

/** The participant view's layout key, so an owner and a participant layout never share an entry. */
export function participantLayoutKey(workItemId: string): string {
  return `participant:${workItemId}`;
}

const PaneHostContext = createContext<PaneHost | null>(null);

export const PaneHostProvider = PaneHostContext.Provider;

export function usePaneHost(): PaneHost {
  const host = useContext(PaneHostContext);
  if (!host) throw new Error('usePaneHost must be rendered inside PaneHostProvider');
  return host;
}
