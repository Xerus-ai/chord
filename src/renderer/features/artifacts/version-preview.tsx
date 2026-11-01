import { EditorContent, useEditor } from '@tiptap/react';
import { createArtifactExtensions } from './artifact-extensions';

/**
 * A document version shown in place of the live document. The file bar says
 * which version it is and offers Restore and Back to latest (S7).
 */
export function VersionPreview({ html }: { html: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex-1 overflow-y-auto">
        <div className="px-14 py-10">
          <VersionSnapshot html={html} />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a stored snapshot through the same read-only Tiptap pipeline the live
 * document uses. Parsing into the artifact schema is what makes this safe: nodes
 * and attributes the schema does not declare — scripts, event handlers, embedded
 * frames — are dropped instead of being injected into the page as raw HTML.
 */
export function VersionSnapshot({ html }: { html: string }) {
  const editor = useEditor(
    {
      extensions: createArtifactExtensions(),
      content: html,
      editable: false,
      editorProps: {
        attributes: {
          class: 'artifact-editor-content max-w-none focus:outline-none',
        },
      },
    },
    [html]
  );

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}
