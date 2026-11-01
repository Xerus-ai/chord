import { err, ok, type Result } from '@shared/result';
import { log } from '@main/lib/logger';

export interface FeedbackAttachment {
  fileName: string;
  mimeType: string;
  /** Raw file bytes — structured-cloned across IPC from the renderer. */
  data: ArrayBuffer;
}

export interface SubmitFeedbackInput {
  content: string;
  attachments: FeedbackAttachment[];
}

export type SubmitFeedbackError =
  | { type: 'not_configured' }
  | { type: 'empty_content' }
  | { type: 'webhook_failed'; message: string };

function resolveWebhookUrl(): string | null {
  return process.env.CHORD_FEEDBACK_WEBHOOK_URL?.trim() || null;
}

function buildWebhookRequest(input: SubmitFeedbackInput): RequestInit {
  if (input.attachments.length === 0) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: input.content }),
    };
  }

  const formData = new FormData();
  formData.append('content', input.content);
  input.attachments.forEach((attachment, index) => {
    const blob = new Blob([attachment.data], { type: attachment.mimeType });
    formData.append(`file${index}`, blob, attachment.fileName);
  });
  return { method: 'POST', body: formData };
}

/**
 * Posts user feedback to the configured webhook. The URL is a secret and must
 * never reach the renderer — it is read from the main process environment only.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<Result<void, SubmitFeedbackError>> {
  const content = input.content.trim();
  if (!content) return err({ type: 'empty_content' as const });

  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) return err({ type: 'not_configured' as const });

  try {
    const response = await fetch(webhookUrl, buildWebhookRequest({ ...input, content }));
    if (!response.ok) {
      return err({
        type: 'webhook_failed' as const,
        message: `Feedback webhook returned ${response.status}`,
      });
    }
    return ok();
  } catch (e) {
    log.error('feedbackService.submitFeedback failed', { error: String(e) });
    return err({ type: 'webhook_failed' as const, message: String(e) });
  }
}
