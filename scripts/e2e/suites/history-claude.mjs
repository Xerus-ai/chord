/**
 * Live check of plan §Phase 5 with Claude (devstation-b4p.4): Reset, Fork to
 * new tab, Fork to new worktree, and Archive then Restore, through the real UI
 * with the user's own Claude login. See history/history-suite.mjs.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-history node scripts/e2e/suites/history-claude.mjs
 */
import { runHistorySuite } from '../lib/history/history-suite.mjs';

await runHistorySuite({ key: 'claude', providerId: 'claude', name: 'Claude Code' });
