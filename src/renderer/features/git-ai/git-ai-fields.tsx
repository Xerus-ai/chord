import { useState } from 'react';
import type { GitAiAgent } from '@shared/git-ai';
import { useAgentCatalog } from '@renderer/features/composer-controls/use-agent-catalog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';

/** The select's value for "the agent's own default model" (stored as null). */
const AGENT_DEFAULT = '__agent-default__';

/** A model from `agent`'s own catalog, or its default. */
export function GitAiModelSelect({
  agent,
  value,
  onChange,
  disabled,
}: {
  agent: GitAiAgent;
  value: string | null;
  onChange: (model: string | null) => void;
  disabled: boolean;
}) {
  const { catalog } = useAgentCatalog(agent);
  const models = catalog?.models ?? [];
  const items = [
    { value: AGENT_DEFAULT, label: 'Agent default' },
    ...models.map((model) => ({ value: model.id, label: model.label })),
    // A saved model the catalog no longer lists stays visible as what is set.
    ...(value && !models.some((model) => model.id === value) ? [{ value, label: value }] : []),
  ];
  return (
    <Select
      value={value ?? AGENT_DEFAULT}
      items={items}
      disabled={disabled}
      onValueChange={(next) => onChange(next === AGENT_DEFAULT ? null : (next as string))}
    >
      <SelectTrigger aria-label="Git AI model" className="w-auto shrink-0 gap-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-max">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Free-text instructions for the agent, saved when the field loses focus. */
export function InstructionsTextarea({
  label,
  value,
  placeholder,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // A saved value that changes (this save, or another window's) replaces the draft.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setDraft(value);
  }
  return (
    <Textarea
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft);
      }}
      className="min-h-16"
    />
  );
}
