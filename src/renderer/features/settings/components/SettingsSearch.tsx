import { Search, X } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import type { SettingsCardId } from '@renderer/features/settings/settings-card-ids';
import { searchSettingsCards } from '@renderer/features/settings/settings-cards';
import { cn } from '@renderer/utils/utils';

/**
 * Search across every registered settings card.
 *
 * The nav groups help someone who already knows the taxonomy; this is for
 * someone who does not. Cards carry their own search vocabulary in the
 * registry, so "api key" or "billing" reaches Team Pulse without the word
 * "pulse" appearing anywhere in the query.
 */
export function SettingsSearch({ onSelect }: { onSelect: (cardId: SettingsCardId) => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchSettingsCards(query), [query]);
  const isSearching = query.trim().length > 0;

  const select = (cardId: SettingsCardId) => {
    onSelect(cardId);
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    if (!hits.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[Math.min(activeIndex, hits.length - 1)];
      if (hit) select(hit.card.id);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-2 py-1.5 focus-within:border-selected-border">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-passive" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search settings"
          aria-label="Search settings"
          className="min-w-0 flex-1 bg-transparent text-tiny tracking-tiny text-text outline-none placeholder:text-text-passive"
        />
        {isSearching && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
            }}
            aria-label="Clear settings search"
            className="shrink-0 text-text-passive transition-colors hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isSearching && (
        <div className="flex flex-col gap-0.5 pb-1">
          {hits.length === 0 ? (
            <p className="px-2 py-1.5 text-micro tracking-micro text-text-passive">
              No settings match “{query.trim()}”.
            </p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={hit.card.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(hit.card.id)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised',
                  index === activeIndex && 'bg-surface-inset'
                )}
              >
                <span className="text-tiny tracking-tiny text-text">{hit.label}</span>
                <span className="text-micro tracking-micro text-text-passive">
                  {hit.breadcrumb}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
