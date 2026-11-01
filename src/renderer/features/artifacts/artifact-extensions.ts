import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { MdxExtension } from './mdx';
import { MermaidExtension } from './mermaid';
import { SlashMenuExtension } from './slash-menu';

const lowlight = createLowlight(common);

interface ArtifactExtensionOptions {
  /**
   * True when a Y.Doc drives the editor. Collaboration brings its own
   * Yjs-aware undo history, so StarterKit's undoRedo must be off — running
   * both makes undo skip or replay remote edits (tiptap warns about the
   * conflict).
   */
  collaborative?: boolean;
}

/**
 * The artifact document schema. Shared by the live collaborative editor and the
 * read-only version snapshot, so stored HTML is always parsed through the same
 * ProseMirror schema — nodes and attributes outside the schema are dropped
 * rather than injected into the page.
 *
 * Link and underline come from StarterKit, which already bundles both;
 * registering the standalone extensions alongside it produced duplicate
 * extension names, so they are configured here instead of re-added.
 */
export function createArtifactExtensions(
  placeholder = '',
  { collaborative = false }: ArtifactExtensionOptions = {}
): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      undoRedo: collaborative ? false : {},
      link: {
        openOnClick: false,
        // Underline carries the affordance, so the link takes the top text
        // step. --action-bg is a surface value: as text it is 1.36:1 on dark.
        HTMLAttributes: { class: 'text-text underline cursor-pointer' },
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder }),
    SlashMenuExtension,
    MdxExtension,
    MermaidExtension,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: true }),
  ];
}
