import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useConfluenceConnection } from '@renderer/features/confluence/use-confluence';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { useIntegrationsContext } from './integrations-provider';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';

type IntegrationType = 'linear' | 'jira' | 'confluence';

type IntegrationSetupModalArgs = {
  integration: IntegrationType;
};

type Props = BaseModalProps<void> & IntegrationSetupModalArgs;

const descriptions: Record<IntegrationType, { title: string; subtitle: string }> = {
  linear: {
    title: 'Connect Linear',
    subtitle: 'Enter your Linear API key to connect your workspace.',
  },
  jira: {
    title: 'Connect Jira',
    subtitle: 'Enter your Jira site URL, email, and API token to connect.',
  },
  confluence: {
    title: 'Connect Confluence',
    subtitle: 'Enter your Atlassian site URL, email, and API token to publish artifacts.',
  },
};

export function IntegrationSetupModal({ integration, onSuccess, onClose }: Props) {
  const { connectLinear, connectJira, isLinearLoading, isJiraLoading } = useIntegrationsContext();
  const confluence = useConfluenceConnection();

  const [linearKey, setLinearKey] = useState('');

  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  const [error, setError] = useState<string | null>(null);

  const isLoading =
    (integration === 'linear' && isLinearLoading) ||
    (integration === 'jira' && isJiraLoading) ||
    (integration === 'confluence' && confluence.connect.isPending);

  // Jira and Confluence take the same Atlassian site, email and API token.
  const canSubmit =
    (integration === 'linear' && !!linearKey.trim()) ||
    (integration !== 'linear' && !!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim()));

  const handleSubmit = useCallback(async () => {
    setError(null);
    try {
      switch (integration) {
        case 'linear':
          await connectLinear(linearKey.trim());
          break;
        case 'jira':
          await connectJira({
            siteUrl: jiraSite.trim(),
            email: jiraEmail.trim(),
            token: jiraToken.trim(),
          });
          break;
        case 'confluence':
          await confluence.connect.mutateAsync({
            siteUrl: jiraSite.trim(),
            email: jiraEmail.trim(),
            token: jiraToken.trim(),
          });
          break;
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message || 'Failed to connect.');
    }
  }, [
    integration,
    linearKey,
    jiraSite,
    jiraEmail,
    jiraToken,
    connectLinear,
    connectJira,
    confluence.connect,
    onSuccess,
  ]);

  const { title, subtitle } = descriptions[integration];

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-tiny tracking-tiny">{subtitle}</DialogDescription>
      </DialogHeader>
      <DialogContentArea>
        {integration === 'linear' && (
          <LinearSetupForm apiKey={linearKey} onChange={setLinearKey} error={error} />
        )}
        {integration !== 'linear' && (
          <JiraSetupForm
            site={jiraSite}
            email={jiraEmail}
            token={jiraToken}
            onChange={(u) => {
              if (typeof u.site === 'string') setJiraSite(u.site);
              if (typeof u.email === 'string') setJiraEmail(u.email);
              if (typeof u.token === 'string') setJiraToken(u.token);
            }}
            error={error}
          />
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!canSubmit || isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
