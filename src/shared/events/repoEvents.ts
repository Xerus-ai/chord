import { defineEvent } from '@shared/ipc/events';

/**
 * Fired by main after icon auto-detection settles for a repo — on add, and for
 * each repo the startup backfill gets to. Detection is deliberately not on the
 * add-repo RPC's critical path, so this is what tells the renderer to re-read
 * the repo list instead of the icon appearing on the next window reload.
 */
export const repoIconDetectedChannel = defineEvent<{ repoId: string }>('repo:icon-detected');
