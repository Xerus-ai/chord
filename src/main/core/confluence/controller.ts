import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { listSpaces } from './confluence-client';
import {
  checkConfluenceConnection,
  clearConfluenceCredentials,
  requireConfluenceAuth,
  saveConfluenceCredentials,
} from './confluence-connection';
import {
  EditedInConfluenceError,
  publishArtifactToConfluence,
  readConfluenceStatus,
} from './publish-to-confluence';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Confluence publishing (plan 2026-09-23 §4 P5). Connection RPCs return the
 * `{ success, error }` shape the Integrations connect flow expects (same as
 * Jira's); publishing and status return Results, with a page edited in
 * Confluence as its own error so the UI can ask before overwriting it.
 */
export const confluenceController = createRPCController({
  saveCredentials: (args: { siteUrl: string; email: string; token: string }) =>
    saveConfluenceCredentials(args),

  clearCredentials: () => clearConfluenceCredentials(),

  checkConnection: () => checkConfluenceConnection(),

  listSpaces: async () => {
    try {
      return ok({ spaces: await listSpaces(await requireConfluenceAuth()) });
    } catch (error) {
      return err({ type: 'request_failed' as const, message: describe(error) });
    }
  },

  publishArtifact: async (args: {
    artifactId: string;
    documentHtml?: string;
    overwriteRemoteEdits?: boolean;
  }) => {
    try {
      return ok({ status: await publishArtifactToConfluence(args) });
    } catch (error) {
      if (error instanceof EditedInConfluenceError) {
        return err({
          type: 'edited_in_confluence' as const,
          status: error.status,
          message: error.message,
        });
      }
      return err({ type: 'publish_failed' as const, message: describe(error) });
    }
  },

  getStatus: async (args: { artifactId: string; documentHtml?: string }) => {
    try {
      return ok({ status: await readConfluenceStatus(args) });
    } catch (error) {
      return err({ type: 'status_failed' as const, message: describe(error) });
    }
  },
});
