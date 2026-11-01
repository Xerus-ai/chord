import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  yCursorPlugin,
  yCursorPluginKey,
  yXmlFragmentToProseMirrorRootNode,
} from '@tiptap/y-tiptap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentUpdateBanner } from './agent-update-banner';
import { createArtifactExtensions } from './artifact-extensions';
import type { ArtifactSource } from './artifact-surface';
import { AskAgentPopover } from './ask-agent-popover';
import { useCollaboration } from './collaboration-provider';
import { useDocumentCommentBadges, type DocumentCommentBadges } from './document-comment-badges';
import { decideDocumentSeed, decideSeedTiming } from './document-seed';
import { DragHandle } from './drag-handle';
import { FloatingComposer } from './floating-composer';
import { FloatingToolbar } from './floating-toolbar';
import { RemotePointers } from './remote-pointers';
import { useAgentContentPush } from './use-agent-content-push';
import type { DocumentReplacement } from './use-artifact-restore';
import { useDocumentReplacement } from './use-document-replacement';

// How long to wait for the collab server before seeding from the file anyway.
// Without this, an unreachable/slow Hocuspocus server leaves a brand-new
// document permanently blank even though its file content is already loaded.
const SYNC_SEED_TIMEOUT_MS = 4000;

// Tiptap's Collaboration extension stores the document in this Y.Doc field.
const COLLAB_FIELD = 'default';

interface ArtifactEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  artifactId?: string;
  roomId?: string;
  /** The artifact exists in the cloud: only then is its room on the collab server. */
  hasCloudCopy: boolean;
  borderless?: boolean;
  workItemId?: string;
  onCommentCreate?: (data: {
    body: string;
    anchor_key: string | null;
    anchor_text: string | null;
    mentioned_user_ids: string[];
  }) => void;
  onAskAgent?: (data: { selection: string; instruction: string }) => void;
  /**
   * Called once, with the editor's HTML, when the document's true state is
   * known — the collab server's copy has arrived or the file seed is applied.
   * Until then `content` is only the file's seed, not what the document holds.
   */
  onDocumentReady?: (html: string) => void;
  /** Where the document is read from; only a local document records agent milestones. */
  source: ArtifactSource;
  /** Agent file writes flow into this editor (the author's own document). */
  pushAgentContent: boolean;
  /** The comments card's numbers, drawn at each comment's quoted text. */
  commentBadges?: DocumentCommentBadges;
  /** A restored version to put in the ready document (S7), and what the document then reads. */
  replacement?: DocumentReplacement | null;
  onReplaced?: (html: string) => void;
}

export function ArtifactEditor({
  content,
  onUpdate,
  placeholder = "Type '/' for commands…",
  editable = true,
  artifactId,
  roomId,
  hasCloudCopy,
  borderless = false,
  workItemId,
  onCommentCreate,
  onAskAgent,
  onDocumentReady,
  source,
  pushAgentContent,
  commentBadges,
  replacement,
  onReplaced,
}: ArtifactEditorProps) {
  const collabRoomId = roomId ? `artifact-${roomId}` : '';
  const {
    ydoc,
    provider: collabProvider,
    sessionKnown,
    joinsServer,
    localLoaded,
  } = useCollaboration({ roomId: collabRoomId, hasCloudCopy });

  // Set once the seed decision is made (see seedFromFileIfEmpty below).
  const seedDecided = useRef(false);
  const readyReported = useRef(false);
  const onDocumentReadyRef = useRef(onDocumentReady);
  useEffect(() => {
    onDocumentReadyRef.current = onDocumentReady;
  }, [onDocumentReady]);

  // Reports the document as ready the first time the editor holds its true
  // state. A synced fragment the editor has not rendered yet waits for the
  // update that renders it.
  const reportDocumentReady = useCallback(
    (editor: Editor) => {
      if (readyReported.current || !seedDecided.current) return;
      if (ydoc) {
        const synced = yXmlFragmentToProseMirrorRootNode(
          ydoc.getXmlFragment(COLLAB_FIELD),
          editor.schema
        );
        if (!synced.eq(editor.state.doc)) return;
      }
      readyReported.current = true;
      onDocumentReadyRef.current?.(editor.getHTML());
    },
    [ydoc]
  );

  const handleUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      onUpdate(editor.getHTML());
      reportDocumentReady(editor);
    },
    [onUpdate, reportDocumentReady]
  );

  const pointerThrottleRef = useRef(0);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!collabProvider) return;
      const now = Date.now();
      if (now - pointerThrottleRef.current < 33) return;
      pointerThrottleRef.current = now;
      const rect = e.currentTarget.getBoundingClientRect();
      collabProvider.setAwarenessField('pointer', {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [collabProvider]
  );

  const handleMouseLeave = useCallback(() => {
    if (!collabProvider) return;
    collabProvider.setAwarenessField('pointer', null);
  }, [collabProvider]);

  const collabExtensions = useMemo(() => {
    if (!ydoc) return [];
    return [Collaboration.configure({ document: ydoc, field: COLLAB_FIELD })];
  }, [ydoc]);

  // Only recreate the editor when the room changes (new ydoc). The Collaboration
  // extension is bound to ydoc from the first render so ySyncPlugin state is
  // always present. Cursor support is added dynamically via registerPlugin below
  // to avoid a second editor recreation that triggers the ySyncPlugin race.
  const editor = useEditor(
    {
      extensions: [
        ...createArtifactExtensions(placeholder, { collaborative: collabExtensions.length > 0 }),
        ...collabExtensions,
      ],
      content: ydoc ? undefined : content,
      editable,
      onUpdate: handleUpdate,
      editorProps: {
        attributes: {
          class: 'artifact-editor-content max-w-none focus:outline-none',
        },
      },
    },
    [collabRoomId]
  );
  useDocumentCommentBadges(editor, commentBadges);
  useDocumentReplacement(editor, replacement, onReplaced);

  // Register cursor plugin dynamically when the provider connects, avoiding
  // editor recreation (which triggers the ySyncPlugin init race in the library).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !collabProvider || !collabProvider.awareness) return;
    const plugin = yCursorPlugin(collabProvider.awareness);
    editor.registerPlugin(plugin);
    return () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(yCursorPluginKey);
      }
    };
  }, [editor, collabProvider]);

  // An agent write may replace the document only while it is genuinely empty AND
  // its true state is known. Before the collab server syncs, an empty local
  // document may just be one that has not loaded yet, and replacing it would
  // duplicate content the moment sync lands.
  const documentIsKnownEmpty = useCallback(() => {
    if (!editor || editor.isDestroyed) return false;
    if (!ydoc) return editor.isEmpty;
    if (!collabProvider?.isSynced) return false;
    return ydoc.getXmlFragment(COLLAB_FIELD).length === 0;
  }, [editor, ydoc, collabProvider]);

  const { pendingUpdate, applyPendingUpdate, dismissPendingUpdate } = useAgentContentPush(
    editor,
    artifactId,
    documentIsKnownEmpty,
    { enabled: pushAgentContent, source, workItemId, provider: collabProvider }
  );

  // Keep the editor's editable state in sync with the toolbar's Edit toggle.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // The collaborative document is the source of truth for artifact content. The
  // file is a seed only: it is applied once, and only to a document that is
  // genuinely empty. A document that already has content — whether typed here,
  // typed by a peer, or restored from the collab server — is never overwritten,
  // so reopening an artifact can no longer wipe everyone's edits.
  const fileSeedRef = useRef('');

  useEffect(() => {
    if (!fileSeedRef.current && content) fileSeedRef.current = content;
  }, [content]);

  const seedFromFileIfEmpty = useCallback(() => {
    if (seedDecided.current) return;
    if (!editor || editor.isDestroyed) return;
    const seed = fileSeedRef.current;
    seedDecided.current = true;

    // With collaboration on, read emptiness off the Y.Doc rather than the view:
    // the fragment is authoritative the moment 'synced' fires, while the editor
    // view may not have rendered the synced content yet. No seed at all (a
    // cloud document, an empty file) is still a decision: the document is
    // whatever the server holds, and it reports ready like any other.
    const documentEmpty = ydoc ? ydoc.getXmlFragment(COLLAB_FIELD).length === 0 : editor.isEmpty;
    if (decideDocumentSeed({ seed, documentEmpty }) === 'apply-seed') {
      editor.commands.setContent(seed);
    }
    reportDocumentReady(editor);
  }, [editor, ydoc, reportDocumentReady]);

  useEffect(() => {
    if (!editor || seedDecided.current) return;

    // Whether the room is on the server is unknown until the session is read,
    // and a server room's provider may not be built yet. Seeding either way
    // could write under a server copy that is still on its way — wait; the
    // failsafe timer below covers a session or provider that never arrives.
    if (ydoc && !sessionKnown) return;
    if (joinsServer && !collabProvider) return;

    const timing = decideSeedTiming({
      hasRoom: ydoc !== null,
      joinsServer,
      serverSynced: collabProvider?.isSynced ?? false,
      localLoaded,
    });
    if (timing === 'decide-now') {
      seedFromFileIfEmpty();
      return;
    }
    // A local-only room re-runs this effect when `localLoaded` flips.
    if (!collabProvider) return;

    const handler = ({ state }: { state: boolean }) => {
      if (!state) return;
      collabProvider.off('synced', handler);
      seedFromFileIfEmpty();
    };
    collabProvider.on('synced', handler);
    return () => {
      collabProvider.off('synced', handler);
    };
  }, [
    collabProvider,
    ydoc,
    editor,
    content,
    sessionKnown,
    joinsServer,
    localLoaded,
    seedFromFileIfEmpty,
  ]);

  // Read through a ref so the failsafe timer below is NOT scoped to the
  // provider: auth retries recreate the provider every ~2s, and a
  // provider-scoped timer would be reset on every retry — the editor would stay
  // blank through the whole retry window instead of showing the file content.
  const collabProviderRef = useRef(collabProvider);
  useEffect(() => {
    collabProviderRef.current = collabProvider;
  }, [collabProvider]);

  useEffect(() => {
    if (!editor || seedDecided.current) return;
    const timer = setTimeout(() => {
      // An authenticated provider will deliver the server's copy and fire
      // 'synced' on its own; seeding underneath it would duplicate that copy.
      // This failsafe is for the server never answering at all.
      if (collabProviderRef.current?.isAuthenticated) return;
      seedFromFileIfEmpty();
    }, SYNC_SEED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [editor, content, seedFromFileIfEmpty]);

  const [composerOpen, setComposerOpen] = useState(false);
  const [askAgentOpen, setAskAgentOpen] = useState(false);

  const handleCommentClick = useCallback(() => {
    setAskAgentOpen(false);
    setComposerOpen(true);
  }, []);

  const handleAskAgentClick = useCallback(() => {
    setComposerOpen(false);
    setAskAgentOpen(true);
  }, []);

  const handleAskAgentSubmit = useCallback(
    (data: { selection: string; instruction: string }) => {
      onAskAgent?.(data);
      setAskAgentOpen(false);
    },
    [onAskAgent]
  );

  const handleComposerSubmit = useCallback(
    (data: {
      body: string;
      anchor_key: string | null;
      anchor_text: string | null;
      mentioned_user_ids: string[];
    }) => {
      onCommentCreate?.(data);
      setComposerOpen(false);
    },
    [onCommentCreate]
  );

  const handleComposerCancel = useCallback(() => {
    setComposerOpen(false);
  }, []);

  if (!editor) return null;

  return (
    <div
      className={`artifact-editor relative flex flex-1 flex-col min-h-0 overflow-hidden ${borderless ? 'bg-surface' : 'rounded-lg border border-border bg-surface'}`}
    >
      {pendingUpdate && (
        <AgentUpdateBanner
          filePath={pendingUpdate.filePath}
          onApply={applyPendingUpdate}
          onDismiss={dismissPendingUpdate}
        />
      )}
      <div
        className={`relative flex-1 overflow-y-auto ${borderless ? 'w-full px-14 py-10' : 'px-12 py-6'}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {collabProvider && <RemotePointers provider={collabProvider} />}
        {/* Tiptap applies programmatic commands even to a non-editable view, so
            every block-mutating affordance is gated on `editable` rather than
            relying on the view to reject the write. */}
        {editable && <DragHandle editor={editor} />}
        <FloatingToolbar
          editor={editor}
          editable={editable}
          onComment={onCommentCreate ? handleCommentClick : undefined}
          onAskAgent={onAskAgent ? handleAskAgentClick : undefined}
        />
        {onCommentCreate && composerOpen && workItemId && (
          <FloatingComposer
            editor={editor}
            workItemId={workItemId}
            onSubmit={handleComposerSubmit}
            onCancel={handleComposerCancel}
          />
        )}
        {onAskAgent && askAgentOpen && (
          <AskAgentPopover
            editor={editor}
            onSubmit={handleAskAgentSubmit}
            onCancel={() => setAskAgentOpen(false)}
          />
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
