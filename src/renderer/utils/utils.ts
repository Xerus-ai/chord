import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Every font-size token in `index.css` and `styles/tokens.css`.
 *
 * tailwind-merge cannot tell a custom font size from a custom text colour —
 * both spell `text-*`, and neither name is in its built-in scale — so it files
 * them in one conflict group and keeps only the last. `cn('text-body',
 * 'text-text')` therefore returned `text-text` alone, and the
 * element silently fell back to the inherited body size. That is quiet: the
 * class is in the source, the rule is in the built CSS, and only the rendered
 * size disagrees, which is how the sidebar's type scale drifted back to 14px
 * everywhere its size and colour were set in the same call.
 *
 * Listing the sizes here restores the distinction. A new `--text-*` token has
 * to be added to this list, or it will be dropped the same way.
 */
const FONT_SIZE_TOKENS = [
  'display',
  'title',
  'body',
  'content',
  'tiny',
  'micro',
  'code',
  'doc-body',
  'doc-h1',
  'doc-h2',
  'doc-h3',
  'avatar-sm',
  'avatar-md',
  'avatar-lg',
  'list-row',
  'list-meta',
  'list-badge',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZE_TOKENS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
