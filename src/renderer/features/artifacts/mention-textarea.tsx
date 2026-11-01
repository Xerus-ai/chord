import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { sharingApi, type Participant } from '@renderer/features/sharing/sharing-api';
import { useCommentMentionsEnabled } from './comment-mentions';

export interface MentionTextareaHandle {
  submit: () => void;
}

interface MentionTextareaProps {
  workItemId: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
  /** Submit on plain Enter (Shift+Enter always inserts a newline). */
  onSubmit: (text: string, mentionedUserIds: string[]) => void;
  onCancel?: () => void;
  /** Reports whether the field is empty so a parent submit button can disable. */
  onEmptyChange?: (empty: boolean) => void;
}

function participantLabel(p: Participant): string {
  return p.name ?? p.email.split('@')[0] ?? 'user';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Short-lived shared roster cache so opening several composers for the same
// work item doesn't refire GET /participants on every mount.
const ROSTER_TTL_MS = 30_000;
const rosterCache = new Map<string, { at: number; rows: Participant[] }>();
const rosterInflight = new Map<string, Promise<Participant[]>>();

function loadRoster(workItemId: string): Promise<Participant[]> {
  const cached = rosterCache.get(workItemId);
  if (cached && Date.now() - cached.at < ROSTER_TTL_MS) {
    return Promise.resolve(cached.rows);
  }
  const inflight = rosterInflight.get(workItemId);
  if (inflight) return inflight;

  const promise = sharingApi
    .getParticipants(workItemId)
    .then((rows) => {
      rosterCache.set(workItemId, { at: Date.now(), rows });
      rosterInflight.delete(workItemId);
      return rows;
    })
    .catch((e) => {
      rosterInflight.delete(workItemId);
      throw e;
    });
  rosterInflight.set(workItemId, promise);
  return promise;
}

/**
 * Comment textarea with `@people` mentions drawn from the work item's real
 * access roster (getParticipants). Selected mentions are tracked by id+label;
 * at submit only mentions whose `@label` still survives in the text resolve to
 * user ids, so deleting the text drops the tag.
 */
export const MentionTextarea = forwardRef<MentionTextareaHandle, MentionTextareaProps>(
  function MentionTextarea(
    {
      workItemId,
      placeholder = 'Add a comment…',
      rows = 2,
      className = '',
      autoFocus = false,
      onSubmit,
      onCancel,
      onEmptyChange,
    },
    ref
  ) {
    // Off for someone the artifact alone was shared with (comment-mentions.ts).
    const mentionsEnabled = useCommentMentionsEnabled();
    const [value, setValue] = useState('');
    const [participants, setParticipants] = useState<Participant[]>([]);
    // Tagged with the roster it belongs to, so switching work items never shows
    // another item's failure (and needs no reset inside the effect).
    const [rosterError, setRosterError] = useState<{ workItemId: string; message: string } | null>(
      null
    );
    const [query, setQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const mentionsRef = useRef<Map<string, string>>(new Map());
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      if (!mentionsEnabled) return;
      let cancelled = false;
      loadRoster(workItemId)
        .then((rows) => {
          if (!cancelled) setParticipants(rows);
        })
        .catch((e: unknown) => {
          // Plain commenting still works; the composer says mentions do not.
          console.error('[mentions] loading the work item roster failed:', e);
          if (cancelled) return;
          setRosterError({ workItemId, message: e instanceof Error ? e.message : String(e) });
        });
      return () => {
        cancelled = true;
      };
    }, [workItemId, mentionsEnabled]);

    useEffect(() => {
      if (autoFocus) setTimeout(() => textareaRef.current?.focus(), 50);
    }, [autoFocus]);

    const matches =
      query === null
        ? []
        : participants
            .filter((p) => participantLabel(p).toLowerCase().includes(query.toLowerCase()))
            .slice(0, 6);

    const detectQuery = useCallback(
      (text: string, caret: number) => {
        if (!mentionsEnabled) return;
        const before = text.slice(0, caret);
        const match = /(?:^|\s)@(\w*)$/.exec(before);
        setQuery(match ? (match[1] ?? '') : null);
        setActiveIndex(0);
      },
      [mentionsEnabled]
    );

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      detectQuery(e.target.value, e.target.selectionStart);
    };

    const pick = useCallback(
      (p: Participant) => {
        const el = textareaRef.current;
        if (!el) return;
        const caret = el.selectionStart;
        const before = value.slice(0, caret);
        const after = value.slice(caret);
        const label = participantLabel(p);
        const replaced = before.replace(/@(\w*)$/, `@${label} `);
        const next = replaced + after;
        mentionsRef.current.set(p.user_id, label);
        setValue(next);
        setQuery(null);
        requestAnimationFrame(() => {
          el.focus();
          el.selectionStart = el.selectionEnd = replaced.length;
        });
      },
      [value]
    );

    const resolveMentions = useCallback((text: string): string[] => {
      const ids: string[] = [];
      for (const [id, label] of mentionsRef.current.entries()) {
        // Token-exact: `@Anna` must not resolve a stale `@Ann` mention. The
        // negative lookahead rejects a longer label continuing past the tag.
        const pattern = new RegExp(`@${escapeRegExp(label)}(?!\\w)`);
        if (pattern.test(text)) ids.push(id);
      }
      return ids;
    }, []);

    const submit = () => {
      if (!value.trim()) return;
      onSubmit(value.trim(), resolveMentions(value));
      setValue('');
      mentionsRef.current.clear();
      setQuery(null);
    };

    useImperativeHandle(ref, () => ({ submit }));

    useEffect(() => {
      onEmptyChange?.(value.trim().length === 0);
    }, [value, onEmptyChange]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (query !== null && matches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % matches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          pick(matches[activeIndex]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setQuery(null);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
      if (e.key === 'Escape') onCancel?.();
    };

    return (
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={mentionsEnabled ? `${placeholder}  @ to mention` : placeholder}
          rows={rows}
          className={className}
        />
        {mentionsEnabled && rosterError?.workItemId === workItemId && (
          <p className="mt-1 text-tiny tracking-tiny text-text-passive">
            Mentions unavailable — {rosterError.message}
          </p>
        )}
        {query !== null && matches.length > 0 && (
          <div className="absolute bottom-[calc(100%+4px)] left-0 z-50 w-56 overflow-hidden rounded-lg border border-border-strong bg-surface-inset p-1 shadow-lg">
            {matches.map((p, i) => (
              <button
                key={p.user_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body tracking-body transition-colors ${
                  i === activeIndex
                    ? 'bg-surface-hover-solid text-text'
                    : 'text-text-muted hover:bg-surface-hover-solid'
                }`}
              >
                <span className="truncate">{participantLabel(p)}</span>
                <span className="ml-auto truncate text-tiny tracking-tiny text-text-passive">
                  {p.email}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);
