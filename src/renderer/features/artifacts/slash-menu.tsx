import { Extension, ReactRenderer, type Editor, type Range } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

interface SlashItem {
  title: string;
  description: string;
  icon: string;
  category: string;
  command: (editor: Editor, range: Range) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Text',
    description: 'Plain text paragraph',
    icon: 'Aa',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: '•',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: '1.',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: 'To-do List',
    description: 'Task checklist',
    icon: '☑',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: 'Quote',
    description: 'Block quote',
    icon: '❝',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: 'Divider',
    description: 'Horizontal line separator',
    icon: '—',
    category: 'Basic blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: 'Code',
    description: 'Code block with syntax highlighting',
    icon: '</>',
    category: 'Advanced',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: 'Callout',
    description: 'Highlighted notice block',
    icon: '💡',
    category: 'Advanced',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  // No 'Component' entry: inserting an mdxComponent needs a real .mdx path from
  // the work item's repo, and the entry that used to live here hardcoded a
  // `components/example.mdx` fixture that exists in no repo — every insertion
  // rendered the MDX bundler's "file not found" card.
];

const CATEGORY_ORDER = ['Basic blocks', 'Advanced'];

interface SlashMenuListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

function SlashMenuList({ items, command }: SlashMenuListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');
  const clampedIndex = Math.min(selectedIndex, items.length - 1);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectItem(clampedIndex);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [items.length, clampedIndex, selectItem]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selected = container.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const filtered = filter
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(filter.toLowerCase()) ||
          item.description.toLowerCase().includes(filter.toLowerCase())
      )
    : items;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: filtered.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  let globalIndex = 0;

  return (
    <div className="z-50 w-72 rounded-lg border border-border-strong bg-surface-inset shadow-lg">
      <div className="border-b border-border p-1.5">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter actions…"
          className="w-full rounded-md border-none bg-transparent px-2 py-1 text-body tracking-body text-text outline-none placeholder:text-text-passive"
        />
      </div>
      <div ref={containerRef} className="max-h-80 overflow-y-auto p-1">
        {grouped.length === 0 && (
          <div className="px-2 py-3 text-center text-tiny tracking-tiny text-text-passive">
            No results
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.category}>
            <div className="px-2 pb-1 pt-2 text-micro tracking-micro font-semibold uppercase text-text-passive">
              {group.category}
            </div>
            {group.items.map((item) => {
              const thisIndex = globalIndex++;
              const selected = thisIndex === clampedIndex;
              return (
                <button
                  key={item.title}
                  type="button"
                  data-selected={selected}
                  onClick={() => selectItem(thisIndex)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors ${
                    selected ? 'bg-surface-hover-solid' : 'hover:bg-surface-hover-solid'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-body tracking-body font-medium ${
                      selected
                        ? 'border-border-strong bg-surface-raised text-text'
                        : 'border-border bg-surface-raised text-text-passive'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={`text-body tracking-body ${selected ? 'text-text' : 'text-text-muted'}`}
                    >
                      {item.title}
                    </div>
                    <div className="truncate text-tiny tracking-tiny text-text-passive">
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-tiny tracking-tiny text-text-passive">Close menu</span>
        <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-micro tracking-micro font-medium text-text-passive">
          esc
        </kbd>
      </div>
    </div>
  );
}

function filterItems(query: string): SlashItem[] {
  if (!query) return SLASH_ITEMS;
  const lower = query.toLowerCase();
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(lower) || item.description.toLowerCase().includes(lower)
  );
}

const suggestion: Omit<SuggestionOptions<SlashItem>, 'editor'> = {
  char: '/',
  items: ({ query }) => filterItems(query),
  render: () => {
    let component: ReactRenderer<typeof SlashMenuList> | null = null;
    let popup: TippyInstance[] | null = null;

    return {
      onStart: (props) => {
        component = new ReactRenderer(SlashMenuList, {
          props: {
            items: props.items,
            command: (item: SlashItem) => {
              item.command(props.editor, props.range);
            },
          },
          editor: props.editor,
        });

        if (!props.clientRect) return;

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        });
      },

      onUpdate: (props) => {
        component?.updateProps({
          items: props.items,
          command: (item: SlashItem) => {
            item.command(props.editor, props.range);
          },
        });

        if (popup?.[0] && props.clientRect) {
          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        }
      },

      onKeyDown: (props) => {
        if (props.event.key === 'Escape') {
          popup?.[0]?.hide();
          return true;
        }
        if (['ArrowUp', 'ArrowDown', 'Enter'].includes(props.event.key)) {
          return true;
        }
        return false;
      },

      onExit: () => {
        popup?.[0]?.destroy();
        component?.destroy();
      },
    };
  },
};

export const SlashMenuExtension = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...suggestion,
      }),
    ];
  },
});
