import { AtSign, FileText, Hash } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sharingApi } from '@renderer/features/sharing/sharing-api';
import { rpc } from '@renderer/lib/ipc';
import { mentionTokenFor } from './chat-routing';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import type { MentionPerson } from './mention-access';

export type MentionKind = 'people' | 'work-items' | 'files';

export interface MentionOption {
  id: string;
  /** Primary text shown in the row */
  label: string;
  /** Secondary text (email, status) */
  detail?: string;
  /** Exact text spliced into the composer when picked */
  insert: string;
  /**
   * Present on a real person's row, which is drawn with their picture (or
   * their initial) instead of the section icon. Absent on `@agent`,
   * `@everyone`, work items and files, which have no face.
   */
  avatar?: { url: string | null; initial: string };
}

const MAX_VISIBLE = 50;

/**
 * The two routing tokens, ahead of the people list (mention-routing design
 * doc). They exist only on a SHARED item: with nobody else in the room there
 * is no audience to choose between, so a solo composer shows the plain people
 * list and routes everything to the agent as before.
 *
 * `detail` carries the literal token so typing "agent"/"everyone" filters to
 * them — the `@agent` row's label is the work item's provider name.
 */
function routingOptions(agentLabel: string): MentionOption[] {
  return [
    { id: 'mention-agent', label: agentLabel, detail: '@agent', insert: '@agent' },
    { id: 'mention-everyone', label: 'Everyone', detail: '@everyone', insert: '@everyone' },
  ];
}

const KIND_META: Record<MentionKind, { header: string; icon: typeof AtSign }> = {
  people: { header: 'People', icon: AtSign },
  'work-items': { header: 'Work items', icon: Hash },
  files: { header: 'Files', icon: FileText },
};

/**
 * A row's leading glyph: a teammate's picture where there is one, their
 * initial where there isn't, and the section icon for rows that aren't a
 * person. The initial is always drawn and the picture laid over it: a row
 * added to the menu while it was open showed an empty slot until its picture
 * loaded, and would have kept it had the picture failed (devstation-szo).
 */
function MentionRowGlyph({ option, icon: Icon }: { option: MentionOption; icon: typeof AtSign }) {
  const [pictureFailed, setPictureFailed] = useState(false);
  if (!option.avatar) return <Icon className="h-4 w-4 shrink-0 text-text-passive" />;
  return (
    <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-hover-solid text-avatar-lg font-semibold text-text-muted">
      {option.avatar.initial}
      {option.avatar.url && !pictureFailed && (
        <img
          src={option.avatar.url}
          alt=""
          onError={() => setPictureFailed(true)}
          className="absolute inset-0 h-5 w-5 rounded-full"
        />
      )}
    </div>
  );
}

/**
 * Caret-token mention suggestions for the composer: @ → work-item
 * participants (cloud), # → work items, + → repo files (git-visible paths).
 * Options load once per activation; typing filters locally.
 */
export function MentionMenu({
  kind,
  query,
  workItemId,
  agentLabel,
  onSelect,
  onClose,
  visible,
  roster,
}: {
  kind: MentionKind;
  query: string;
  workItemId?: string;
  /**
   * The owner's @ roster: the team, marked by who can see the work item
   * (mention-access.ts). Without it, the people with access are read here.
   */
  roster?: MentionPerson[];
  /** Display name for the `@agent` row — the work item's provider. */
  agentLabel: string;
  onSelect: (option: MentionOption) => void;
  onClose: () => void;
  visible: boolean;
}) {
  const [options, setOptions] = useState<MentionOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    let stale = false;

    const load = async (): Promise<MentionOption[]> => {
      if (kind === 'people') {
        if (!workItemId) return [];
        const participants: MentionPerson[] =
          roster ??
          (await sharingApi.getParticipants(workItemId)).map((p) => ({ ...p, hasAccess: true }));
        // Names are what people read, so names are what gets inserted —
        // mentionTokenFor falls back to the email for anyone whose display
        // name is missing or shared with a teammate, which is the only form
        // that still resolves to exactly one person.
        const people = participants.map((p) => ({
          id: p.user_id,
          label: p.name ?? p.email,
          detail: p.hasAccess ? p.email : `Can't see this yet · ${p.email}`,
          insert: `@${mentionTokenFor(p, participants)}`,
          avatar: {
            url: p.avatar_url,
            initial: (p.name ?? p.email)[0]?.toUpperCase() ?? '?',
          },
        }));
        if (people.length === 0) return people;
        return [...routingOptions(agentLabel), ...people];
      }
      if (kind === 'work-items') {
        // getAll only ever resolves Ok; a real failure rejects the promise and
        // lands in the catch below.
        const result = await rpc.workItems.getAll();
        return result.data.items.map((item) => ({
          id: item.id,
          label: item.name,
          detail: item.repoAlias ?? undefined,
          insert: `#${item.name}`,
        }));
      }
      if (!workItemId) return [];
      const result = await rpc.workItems.listRepoFiles(workItemId);
      if (!result.success) throw new Error(describeRpcFailure('Load repo files', result.error));
      return result.data.files.map((file) => ({ id: file, label: file, insert: file }));
    };

    load()
      .then((loaded) => {
        if (stale) return;
        setOptions(loaded);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        // An empty menu reads as "nothing matches"; a failed lookup has to say
        // so or the user retypes the mention forever.
        if (stale) return;
        setOptions([]);
        setLoadError(describeThrownFailure(`Load ${KIND_META[kind].header.toLowerCase()}`, e));
      });

    return () => {
      stale = true;
    };
  }, [kind, workItemId, agentLabel, visible, roster]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const matches = q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q)
        )
      : options;
    return matches.slice(0, MAX_VISIBLE);
  }, [query, options]);

  const clampedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // No matches → the menu is invisible and must not swallow keys; the
      // composer keeps normal Enter-to-send. stopPropagation on consumed keys
      // is what keeps the composer's own handler out while the menu shows.
      if (!visible) return;
      if (filtered.length === 0) {
        // The error row is the only thing on screen — Escape still dismisses
        // it, but nothing else may be swallowed.
        if (loadError && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(filtered[clampedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [visible, filtered, clampedIndex, loadError, onSelect, onClose]
  );

  useEffect(() => {
    if (!visible) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    const el = listRef.current?.children[clampedIndex + 1] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex]);

  if (!visible || (filtered.length === 0 && !loadError)) return null;

  const { header, icon: Icon } = KIND_META[kind];

  return (
    <div
      ref={listRef}
      className="floating-surface-solid absolute bottom-full left-0 mb-1.5 max-h-80 w-96 overflow-y-auto rounded-xl py-1.5"
    >
      <div className="px-3 py-1.5 text-micro tracking-micro font-semibold uppercase text-text-passive">
        {header}
      </div>
      {loadError && (
        <div role="alert" className="px-3 py-2 text-tiny tracking-tiny text-status-err">
          {loadError}
        </div>
      )}
      {filtered.map((option, i) => (
        <div
          key={option.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(option);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
          className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-body tracking-body transition-colors duration-[80ms] ${
            i === clampedIndex
              ? 'bg-surface-inset/60 text-text'
              : 'text-text-muted hover:bg-surface-inset/60'
          }`}
        >
          <MentionRowGlyph option={option} icon={Icon} />
          <span className="min-w-0 truncate font-semibold">{option.label}</span>
          {option.detail && (
            <span className="flex-1 truncate text-right text-tiny tracking-tiny text-text-passive">
              {option.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
