import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { openRouterService } from './openrouter-service';

interface WorkItemContext {
  name: string;
  status: string;
  workflow_phase: string | null;
  pr_number: number | null;
  pr_url: string | null;
  repo_name: string | null;
  branch_name: string | null;
}

interface MemberActivity {
  user_id: string;
  user_name: string | null;
  user_email: string;
  status: string;
  active_view: string | null;
  last_seen: string | null;
  work_items: WorkItemContext[];
}

interface PulseSummaryPayload {
  user_id: string;
  summary: string;
  pr_refs: Array<{ url: string; title: string }>;
  period_start: string;
  period_end: string;
}

function buildPrompt(member: MemberActivity): string {
  const displayName = member.user_name ?? member.user_email.split('@')[0] ?? 'Unknown';
  const lines: string[] = [];

  lines.push(`Write a 2-3 sentence activity summary for ${displayName}.`);

  if (member.work_items.length > 0) {
    lines.push('');
    lines.push('Their recent work:');
    for (const wi of member.work_items.slice(0, 8)) {
      const parts = [`- "${wi.name}"`];
      parts.push(`status: ${wi.status}`);
      if (wi.workflow_phase) parts.push(`phase: ${wi.workflow_phase}`);
      if (wi.pr_number) parts.push(`PR #${wi.pr_number}`);
      if (wi.repo_name) parts.push(`repo: ${wi.repo_name}`);
      lines.push(parts.join(', '));
    }
    if (member.work_items.length > 8) {
      lines.push(`  ...and ${member.work_items.length - 8} more items.`);
    }
  }

  if (member.last_seen) {
    lines.push(`\nPresence: ${member.status}, last seen ${member.last_seen}.`);
  } else {
    lines.push(`\nPresence: ${member.status}, no recent sessions.`);
  }

  lines.push('');
  lines.push('Rules:');
  lines.push(
    '- Describe WHAT they shipped, are working on, or are reviewing — name the feature, not the ticket.'
  );
  lines.push(
    '- Reference PRs inline as "PR #NUMBER" or just "#NUMBER" (e.g. "shipped the sidebar nav redesign (PR #2396)").'
  );
  lines.push('- Mention what they are currently doing: building, reviewing, debugging, away, PTO.');
  lines.push(
    '- If minimal/no activity, say so briefly (e.g. "Away since Thursday. Last worked on workspace templates.").'
  );
  lines.push('- Plain text only, no markdown, no bullet points. 2-3 natural sentences.');

  return lines.join('\n');
}

function extractPrRefs(items: WorkItemContext[]): Array<{ url: string; title: string }> {
  const refs: Array<{ url: string; title: string }> = [];
  for (const wi of items) {
    if (wi.pr_number && wi.pr_url) {
      refs.push({ url: wi.pr_url, title: `#${wi.pr_number}` });
    }
  }
  return refs;
}

export async function generateTeamPulse(
  orgId: string,
  cloudApiBase: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const key = await openRouterService.getKey();
  if (!key) {
    return { success: false, count: 0, error: 'OpenRouter API key not configured.' };
  }

  const token = await chordAccountService.getAccessToken();
  if (!token) {
    return { success: false, count: 0, error: 'Not signed in.' };
  }

  let members: MemberActivity[];
  try {
    const res = await fetch(`${cloudApiBase}/team-pulse/${orgId}/activity-context`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    members = (await res.json()) as MemberActivity[];
  } catch (error) {
    log.error('Failed to fetch team activity:', error);
    return {
      success: false,
      count: 0,
      error: `Failed to fetch team activity: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (members.length === 0) {
    return { success: true, count: 0 };
  }

  // A failed settings read throws — the renderer surfaces it rather than
  // silently summarizing with a model the user did not pick.
  const model = (await appSettingsService.get('teamPulse')).model;
  const now = new Date();
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = now.toISOString();

  const summaries: PulseSummaryPayload[] = [];
  let firstFailure: string | null = null;

  for (const member of members) {
    const displayName = member.user_name ?? member.user_email.split('@')[0] ?? 'Unknown';
    const prompt = buildPrompt(member);

    try {
      const summary = await openRouterService.chatCompletion(model, [
        {
          role: 'system',
          content:
            'You write concise developer activity summaries for a team dashboard. Output only plain text — no markdown, no headers, no bullets. Reference PRs inline as "PR #NUMBER" or "#NUMBER". Focus on what was shipped, what is in progress, and what is being reviewed. 2-3 sentences max.',
        },
        { role: 'user', content: prompt },
      ]);

      summaries.push({
        user_id: member.user_id,
        summary: summary.trim(),
        pr_refs: extractPrRefs(member.work_items),
        period_start: periodStart,
        period_end: periodEnd,
      });
    } catch (error) {
      log.error(`Failed to generate pulse for ${displayName}:`, error);
      firstFailure ??= error instanceof Error ? error.message : String(error);
    }
  }

  if (summaries.length === 0) {
    // Every member's completion failed — reporting success here is what made
    // the sidebar spin and then show nothing.
    return {
      success: false,
      count: 0,
      error: `Model ${model} failed for all ${members.length} teammate(s): ${firstFailure ?? 'no summary returned'}`,
    };
  }

  try {
    const res = await fetch(`${cloudApiBase}/team-pulse/${orgId}/summaries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ summaries }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status}: ${body}`);
    }
  } catch (error) {
    log.error('Failed to store pulse summaries:', error);
    return {
      success: false,
      count: 0,
      error: `Failed to store summaries: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { success: true, count: summaries.length };
}
