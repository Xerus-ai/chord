import { useCallback, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { buildFeedbackContent, type FeedbackGithubUser } from './build-feedback-content';

interface FeedbackSubmitOptions {
  githubUser?: FeedbackGithubUser | null;
  appVersion?: string | null;
  onSuccess: () => void;
}

function describeSubmitFailure(error: { type: string }): string {
  switch (error.type) {
    case 'not_configured':
      return 'Feedback delivery is not configured for this build.';
    case 'empty_content':
      return 'Please enter some feedback before sending.';
    default:
      return 'Unable to send feedback. Please try again.';
  }
}

async function readAttachment(file: File) {
  return {
    fileName: file.name,
    mimeType: file.type,
    data: await file.arrayBuffer(),
  };
}

export function useFeedbackSubmit({ githubUser, appVersion, onSuccess }: FeedbackSubmitOptions) {
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const reset = useCallback(() => {
    setFeedbackDetails('');
    setContactEmail('');
    setSubmitting(false);
    setErrorMessage(null);
  }, []);

  const handleSubmit = useCallback(
    async (attachments: File[]) => {
      const trimmedFeedback = feedbackDetails.trim();
      if (!trimmedFeedback) {
        setErrorMessage('Please enter some feedback before sending.');
        return;
      }

      setSubmitting(true);
      setErrorMessage(null);

      const content = buildFeedbackContent({
        feedback: trimmedFeedback,
        contactEmail,
        githubUser,
        appVersion,
      });

      const failSubmit = (description: string) => {
        setErrorMessage(description);
        toast({
          title: 'Failed to send feedback',
          description,
          variant: 'destructive',
        });
      };

      try {
        const payloadAttachments = await Promise.all(attachments.map(readAttachment));
        const result = await rpc.feedback.submitFeedback({
          content,
          attachments: payloadAttachments,
        });

        if (!result.success) {
          log.error('Failed to submit feedback:', result.error);
          failSubmit(describeSubmitFailure(result.error));
          return;
        }

        onSuccess();
        toast({ title: 'Feedback sent', description: 'Thanks for your feedback!' });
      } catch (error) {
        log.error('Failed to submit feedback:', error);
        failSubmit('Unable to send feedback. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [appVersion, contactEmail, feedbackDetails, githubUser, onSuccess, toast]
  );

  return {
    feedbackDetails,
    setFeedbackDetails,
    contactEmail,
    setContactEmail,
    submitting,
    errorMessage,
    clearError,
    reset,
    handleSubmit,
    canSubmit: feedbackDetails.trim().length > 0 && !submitting,
  };
}
