import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  readGitAiField,
  type GitAiField,
  type GitAiLayer,
  type GitAiOverride,
  type GitAiSettings,
} from '@shared/git-ai';
import { GitAiModelSelect } from '@renderer/features/git-ai/git-ai-fields';
import { setGitAiOverrideField } from '@renderer/features/git-ai/git-ai-override';
import { useGitAiAgentOptions } from '@renderer/features/git-ai/use-git-ai-agent-options';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { useRepoSettings } from './use-repo-settings';

const LAYER_LABELS: Record<GitAiLayer, string> = {
  default: 'Default',
  you: 'You',
  justMe: 'Just me',
};

const LAYER_TITLES: Record<GitAiLayer, string> = {
  default: "Chord's built-in default.",
  you: 'Your own setting, from Settings › Git › AI.',
  justMe: 'Set for this repository, on this machine only.',
};

function Field({
  title,
  layer,
  onInherit,
  children,
}: {
  title: string;
  layer: GitAiLayer;
  onInherit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-body tracking-body text-text">{title}</span>
        <Badge variant="secondary" title={LAYER_TITLES[layer]}>
          {LAYER_LABELS[layer]}
        </Badge>
        {layer === 'justMe' && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            title="Drop this repository's value so your setting applies"
            onClick={onInherit}
          >
            Use my setting
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function TextField({
  title,
  value,
  layer,
  onSave,
  onInherit,
}: {
  title: string;
  value: string;
  layer: GitAiLayer;
  onSave: (value: string) => Promise<void>;
  onInherit: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field title={title} layer={layer} onInherit={onInherit}>
      {draft === null ? (
        <div className="flex items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap text-tiny tracking-tiny text-text-muted">
            {value || 'None'}
          </p>
          <Button variant="ghost" size="xs" onClick={() => setDraft(value)}>
            Edit
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={title}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="xs" onClick={() => void onSave(draft).then(() => setDraft(null))}>
              Save for me
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}

const FLAGS: readonly { field: GitAiField; title: string }[] = [
  { field: 'prDefaults.draft', title: 'Create as draft' },
  { field: 'prDefaults.useTemplate', title: "Use the repository's PR template" },
  { field: 'prDefaults.openAfterCreate', title: 'Open in browser after create' },
];

/**
 * Repository settings › Git AI: each Settings › Git › AI field as it applies
 * here, with where it comes from. Setting one makes it this repository's
 * (just me); every other field keeps following your setting.
 */
export function RepoGitAiSection({
  repoId,
  repo,
}: {
  repoId: string;
  repo: ReturnType<typeof useRepoSettings>;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['gitAi', 'repo', repoId],
    queryFn: async () => {
      // Its reads have no user-fixable failure: anything thrown is a bug.
      return (await rpc.gitAi.getRepoSettings(repoId)).data;
    },
  });
  const options = useGitAiAgentOptions(query.data?.resolved.value.agent);
  if (query.error) {
    return <p className="text-tiny tracking-tiny text-status-err">{query.error.message}</p>;
  }
  if (!query.data) return <p className="text-tiny tracking-tiny text-text-passive">Loading…</p>;
  const { resolved, override } = query.data;
  const value: GitAiSettings = resolved.value;

  const write = async (next: GitAiOverride | null) => {
    await repo.saveJustMe({ gitAi: next });
    await queryClient.invalidateQueries({ queryKey: ['gitAi'] });
  };
  const set = (field: GitAiField, fieldValue: unknown) =>
    write(setGitAiOverrideField(override, field, fieldValue));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-tiny tracking-tiny text-text-passive">
        Generate in the commit field and in Create PR uses your settings (Settings › Git › AI)
        unless this repository sets a field itself.
      </p>
      <Field
        title="Agent"
        layer={resolved.layers.agent}
        onInherit={() =>
          void write(
            setGitAiOverrideField(
              setGitAiOverrideField(override, 'agent', undefined) ?? {},
              'model',
              undefined
            )
          )
        }
      >
        <SegmentedControl
          size="xs"
          ariaLabel="Repository Git AI agent"
          options={options}
          value={value.agent}
          // A model belongs to one agent: a new agent here starts on its default.
          onChange={(agent) =>
            void write(
              setGitAiOverrideField(
                setGitAiOverrideField(override, 'agent', agent) ?? {},
                'model',
                null
              )
            )
          }
        />
      </Field>
      <Field
        title="Model"
        layer={resolved.layers.model}
        onInherit={() => void set('model', undefined)}
      >
        <div>
          <GitAiModelSelect
            agent={value.agent}
            value={value.model}
            disabled={false}
            onChange={(model) => void set('model', model)}
          />
        </div>
      </Field>
      {(['instructions.commit', 'instructions.pr'] as const).map((field) => (
        <TextField
          key={field}
          title={
            field === 'instructions.commit'
              ? 'Commit message instructions'
              : 'Pull request instructions'
          }
          value={readGitAiField(value, field) as string}
          layer={resolved.layers[field]}
          onSave={(text) => set(field, text)}
          onInherit={() => void set(field, undefined)}
        />
      ))}
      {FLAGS.map((flag) => (
        <Field
          key={flag.field}
          title={flag.title}
          layer={resolved.layers[flag.field]}
          onInherit={() => void set(flag.field, undefined)}
        >
          <Switch
            aria-label={flag.title}
            checked={readGitAiField(value, flag.field) as boolean}
            onCheckedChange={(checked) => void set(flag.field, checked)}
          />
        </Field>
      ))}
    </div>
  );
}
