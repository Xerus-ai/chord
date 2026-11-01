import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { cursorColorForUser } from '@renderer/utils/color-palettes';
import { fetchCollabToken } from './collab-token';
import { joinsCollabServer } from './document-seed';

const AUTH_RETRY_LIMIT = 5;
const AUTH_RETRY_DELAY_MS = 2000;

// VITE_COLLAB_WS_URL is a required build-time variable (AGENTS.md required_env)
// and Vite inlines it, so a build without it can never collaborate: the provider
// would be constructed against `undefined`, connect to nothing, and leave every
// artifact silently single-player while still looking editable. Boot fails
// instead, the same way the main process treats its own required env.
const COLLAB_WS_URL: string = import.meta.env.VITE_COLLAB_WS_URL;
if (!COLLAB_WS_URL) {
  throw new Error(
    'Missing required environment variable: VITE_COLLAB_WS_URL. Set it before building Chord.'
  );
}

interface CollaborationResult {
  ydoc: Y.Doc | null;
  provider: HocuspocusProvider | null;
  /** False until the account session has been read: whether to join is unknown until then. */
  sessionKnown: boolean;
  /** The room is on the collab server (see `joinsCollabServer`); otherwise it is local only. */
  joinsServer: boolean;
  /** The local copy (IndexedDB) has been replayed into `ydoc`. */
  localLoaded: boolean;
}

interface UseCollaborationOptions {
  roomId: string;
  /** The artifact exists in the cloud, so the server holds (or will create) its room. */
  hasCloudCopy: boolean;
  serverUrl?: string;
}

export function useCollaboration({
  roomId,
  hasCloudCopy,
  serverUrl = COLLAB_WS_URL,
}: UseCollaborationOptions): CollaborationResult {
  const { data: session } = useAccountSession();
  const userId = session?.user?.userId ?? null;
  const username = session?.user?.username ?? null;
  const sessionKnown = session !== undefined;
  const joinsServer = joinsCollabServer({ signedIn: userId !== null, hasCloudCopy });

  const providerRef = useRef<HocuspocusProvider | null>(null);
  // The retry counter is stamped with the room it belongs to and read back
  // through that stamp, so opening a different artifact starts from zero
  // retries without an effect that resets state during render.
  const [authRetry, setAuthRetry] = useState({ roomId, nonce: 0 });
  const authRetryNonce = authRetry.roomId === roomId ? authRetry.nonce : 0;

  // One Y.Doc (+ IndexedDB persistence) per room, stable across provider auth
  // retries: the Tiptap editor binds its Collaboration extension to this doc
  // at creation and is NOT recreated on retry — handing it a destroyed doc
  // silently drops every edit (frozen editor).
  const docState = useMemo(() => {
    if (!roomId) return null;
    const ydoc = new Y.Doc();
    const indexeddbProvider = new IndexeddbPersistence(`chord-${roomId}`, ydoc);
    return { ydoc, indexeddbProvider };
  }, [roomId]);

  // Stamped with the doc it belongs to, like the retry counter below, so a new
  // room starts unloaded without resetting state during render.
  const [loadedDoc, setLoadedDoc] = useState<Y.Doc | null>(null);
  useEffect(() => {
    if (!docState) return;
    let cancelled = false;
    void docState.indexeddbProvider.whenSynced.then(() => {
      if (!cancelled) setLoadedDoc(docState.ydoc);
    });
    return () => {
      cancelled = true;
    };
  }, [docState]);
  const localLoaded = docState !== null && loadedDoc === docState.ydoc;

  const provider = useMemo(() => {
    if (!docState || !roomId || !joinsServer || !userId || !username) return null;
    void authRetryNonce;

    const p = new HocuspocusProvider({
      url: serverUrl,
      name: roomId,
      document: docState.ydoc,
      token: fetchCollabToken,
    });

    p.setAwarenessField('user', { name: username, color: cursorColorForUser(userId) });

    return p;
  }, [docState, roomId, joinsServer, userId, username, serverUrl, authRetryNonce]);

  // Declared before the docState cleanup so the provider detaches from the
  // doc before the doc itself is destroyed (cleanups run in declaration order).
  useEffect(() => {
    providerRef.current = provider;

    return () => {
      if (provider) {
        provider.destroy();
      }
      providerRef.current = null;
    };
  }, [provider]);

  useEffect(() => {
    return () => {
      if (docState) {
        void docState.indexeddbProvider.destroy();
        docState.ydoc.destroy();
      }
    };
  }, [docState]);

  useEffect(() => {
    if (!provider) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const onAuthenticationFailed = () => {
      retryTimer = setTimeout(() => {
        setAuthRetry((prev) => {
          const nonce = prev.roomId === roomId ? prev.nonce : 0;
          return nonce < AUTH_RETRY_LIMIT ? { roomId, nonce: nonce + 1 } : { roomId, nonce };
        });
      }, AUTH_RETRY_DELAY_MS);
    };

    provider.on('authenticationFailed', onAuthenticationFailed);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      provider.off('authenticationFailed', onAuthenticationFailed);
    };
  }, [provider, roomId]);

  return { ydoc: docState?.ydoc ?? null, provider, sessionKnown, joinsServer, localLoaded };
}
