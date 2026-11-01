import { Check, Link2, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ArtifactType } from '@shared/stream-items';
import { useWorkItemArtifacts } from '@renderer/features/artifacts/use-work-item-artifacts';
import { useWorkItems } from '@renderer/lib/hooks/use-work-items';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SharePeopleTab } from './share-people-tab';
import { SharePublishTab } from './share-publish-tab';
import { scopeFor, shareLinkUrl, shareScopeOptions, type ShareScope } from './share-scope';

const SERVER_URL = import.meta.env.VITE_CLOUD_API_URL;

type ShareTab = 'share' | 'publish';

export type ShareModalProps = {
  workItemId: string;
  /** Read from this machine's list when the caller does not have it (a file bar). */
  workItemName?: string;
  /** The artifact tab that was open: preselected under "What". */
  artifactId?: string;
  /** Which tab opens: Publish from the file bar's Confluence chip. */
  tab?: ShareTab;
};

const TABS = [
  { value: 'share', label: 'Share' },
  { value: 'publish', label: 'Publish' },
] as const;

/**
 * The one Share dialog (shared-items design §5), the owner's: "What" picks
 * the whole work item or one of its artifacts, then who has access to it.
 * Only artifacts already in the cloud can be shared.
 */
export function ShareModal({
  workItemId,
  workItemName,
  artifactId,
  tab: initialTab = 'share',
}: ShareModalProps & BaseModalProps) {
  const [tab, setTab] = useState<ShareTab>(initialTab);
  const { items } = useWorkItems();
  const itemName = workItemName ?? items.find((item) => item.id === workItemId)?.name ?? '';
  const artifactsQuery = useWorkItemArtifacts(workItemId);
  const allArtifacts = artifactsQuery.data;
  const shareable = useMemo(
    () =>
      (allArtifacts ?? [])
        .filter((artifact) => artifact.syncedAt !== null)
        .map((artifact) => ({
          id: artifact.id,
          name: artifact.name,
          type: artifact.type as ArtifactType,
        })),
    [allArtifacts]
  );
  const [chosen, setChosen] = useState<string | null>(null);

  if (!allArtifacts) {
    return (
      <div className="flex items-center justify-center bg-surface-inset p-8">
        <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
      </div>
    );
  }

  // An artifact tab whose artifact has not reached the cloud yet cannot be
  // shared: the dialog opens on the whole work item and says so.
  const requested = artifactId ?? null;
  const requestedSyncing =
    requested !== null && !shareable.some((artifact) => artifact.id === requested);
  const { options, initial } = shareScopeOptions(shareable, requestedSyncing ? null : requested);
  const scope = chosen === null ? initial : scopeFor(shareable, chosen);
  const scopeValue = scope.kind === 'work_item' ? 'work_item' : scope.artifactId;
  const syncingName = requestedSyncing
    ? allArtifacts.find((artifact) => artifact.id === requested)?.name
    : undefined;

  return (
    <div className="flex flex-col gap-4 bg-surface-inset p-5" data-testid="share-dialog">
      <h2 className="truncate text-title font-semibold tracking-title text-text">
        Share {scope.kind === 'artifact' ? scope.name : itemName}
      </h2>

      <label className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-tiny font-medium tracking-tiny text-text-passive">
          What
        </span>
        <Select value={scopeValue} onValueChange={(value) => setChosen(value as string)}>
          <SelectTrigger
            aria-label="What to share"
            className="min-w-0 flex-1"
            data-testid="share-scope"
          >
            <SelectValue>
              {(value: string) => options.find((option) => option.value === value)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {requestedSyncing && (
        <p className="text-tiny tracking-tiny text-text-passive">
          {syncingName ?? 'This artifact'} is still syncing; you can share it once it is.
        </p>
      )}

      <SegmentedControl
        options={TABS}
        value={tab}
        onChange={(next) => setTab(next)}
        ariaLabel="Share or publish"
      />

      {tab === 'share' ? (
        <>
          <SharePeopleTab
            key={scopeValue}
            workItemId={workItemId}
            scope={scope}
            onOpenArtifact={(id) => setChosen(id)}
          />
          <CopyLinkButton workItemId={workItemId} scope={scope} />
        </>
      ) : (
        <SharePublishTab
          key={scopeValue}
          workItemId={workItemId}
          scope={scope}
          artifactType={
            scope.kind === 'artifact'
              ? (shareable.find((artifact) => artifact.id === scope.artifactId)?.type ?? null)
              : null
          }
        />
      )}
    </div>
  );
}

/** Copies the link people with access open it by (shareLinkUrl). */
function CopyLinkButton({ workItemId, scope }: { workItemId: string; scope: ShareScope }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      data-testid="share-copy-link"
      onClick={() => {
        void navigator.clipboard.writeText(shareLinkUrl(SERVER_URL, workItemId, scope)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check /> : <Link2 />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}
