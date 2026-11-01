import { createRPCController } from '@shared/ipc/rpc';
import { submitFeedback, type FeedbackAttachment } from './feedback-service';

export const feedbackController = createRPCController({
  submitFeedback: (args: { content: string; attachments?: FeedbackAttachment[] }) =>
    submitFeedback({ content: args.content, attachments: args.attachments ?? [] }),
});
