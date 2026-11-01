/* global window -- evaluate callbacks run in the app window */
/**
 * Round trip of the reads behind the main screens, timed from the renderer on
 * the heavy profile (`python scripts/perf/seed-heavy-history.py`), each the
 * median of REPEAT calls after boot settles, with its payload size:
 *   session-messages  chatMessages.getMessages(item, { sessionId, withoutTurns }), as a thread reads it
 *   session-messages-with-turns  the same with its agent_turn rows
 *   timeline-turns    chatMessages.getTimelineTurns({ workItemId })
 *   sidebar-summaries workItems.getSidebarSummaries(all ids)
 *   work-items        workItems.getAll()
 *   sessions          agentSessions.getAll(item)
 *
 *   node scripts/perf/bench-rpc.mjs <appDir> [label] [repeat=7]
 *
 * Results append to .e2e-runs/perf/rpc.jsonl.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchSeededApp, ROOT } from '../e2e/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const label = process.argv[3] ?? appDir;
const repeat = Number(process.argv[4] ?? 7);

const instance = await launchSeededApp({
  source: 'built',
  appDir,
  seedProfile: 'chord-perf-heavy',
  profilePrefix: 'chord-perf-rpc',
});
try {
  const { page, rpc } = instance;
  await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
  await page.waitForTimeout(5000);
  const itemList = (await rpc('workItems.getAll')).data.items;
  const heavy = itemList.find((w) => w.name === 'raghav');
  const sessionList = (await rpc('agentSessions.getAll', heavy.id)).data.sessions;
  const chat = sessionList.find((s) => s.title === 'raghav' && s.kind === 'chat');
  const calls = {
    // As the thread reads it (use-session-chat-messages.ts), and with turn rows.
    'session-messages': [
      'chatMessages.getMessages',
      heavy.id,
      { sessionId: chat.id, withoutTurns: true },
    ],
    'session-messages-with-turns': ['chatMessages.getMessages', heavy.id, { sessionId: chat.id }],
    'timeline-turns': ['chatMessages.getTimelineTurns', { workItemId: heavy.id }],
    'sidebar-summaries': ['workItems.getSidebarSummaries', itemList.map((w) => w.id)],
    'work-items': ['workItems.getAll'],
    sessions: ['agentSessions.getAll', heavy.id],
  };
  const summary = { label, repeat, at: new Date().toISOString() };
  for (const [name, [channel, ...args]] of Object.entries(calls)) {
    summary[name] = await page.evaluate(
      async ([c, a, n]) => {
        const times = [];
        let bytes = 0;
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          const result = await window.electronAPI.invoke(c, ...a);
          times.push(performance.now() - t0);
          bytes = JSON.stringify(result).length;
        }
        times.sort((x, y) => x - y);
        return { ms: Math.round(times[Math.floor(n / 2)] * 10) / 10, kb: Math.round(bytes / 1024) };
      },
      [channel, args, repeat]
    );
  }
  console.log('RESULT', JSON.stringify(summary));
  const outDir = join(ROOT, '.e2e-runs', 'perf');
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'rpc.jsonl'), JSON.stringify(summary) + '\n');
} finally {
  await instance.close();
}
