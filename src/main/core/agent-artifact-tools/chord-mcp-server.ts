import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import z, { type ZodRawShape } from 'zod';
import { AUTHORED_ARTIFACT_FORMATS, type PreferredArtifactFormat } from '@shared/artifact-formats';
import { log } from '@main/lib/logger';
import {
  buildPublishArtifactDescription,
  LIST_ARTIFACTS_DESCRIPTION,
} from './artifact-tool-guidance';
import { resolveArtifactToolSession } from './artifact-tool-sessions';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';
import {
  listPublishedArtifacts,
  publishArtifact,
  type PublishArtifactInput,
} from './publish-artifact';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * A tool as Chord declares it. The SDK's own `tool()` types a handler's
 * arguments with every schema key required (`InferShape` drops `.optional()`),
 * which misstates what the handler receives: the SDK validates against the zod
 * shape first, so optional arguments arrive absent. Declaring the precise
 * argument type here keeps the handlers honest.
 */
export interface ChordToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations?: { readOnlyHint?: boolean };
  /** publish_artifact's arguments; list_artifacts takes none and reads none. */
  handler: (args: PublishArtifactInput, extra: unknown) => Promise<ToolResult>;
}

function replyWith(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/**
 * A rejected call goes back to the agent as an MCP tool error — the protocol's
 * own failure channel — so it reads why and can correct the path or format.
 * Nothing is swallowed: the error text is the reply, and it is logged.
 */
function replyWithError(toolName: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  log.warn('chord-mcp: tool call rejected', { tool: toolName, error: message });
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The `chord` server's tools for one session. The token is the only link to a
 * work item; the preferred format from Settings › Agents › Artifacts is baked
 * into the description at session start, which is when the agent reads it.
 */
export function buildChordTools(
  token: string,
  preferredFormat: PreferredArtifactFormat
): ChordToolDefinition[] {
  return [
    {
      name: 'publish_artifact',
      description: buildPublishArtifactDescription(preferredFormat),
      inputSchema: {
        path: z.string().min(1).describe('Path of the file to publish, inside the workspace.'),
        title: z
          .string()
          .min(1)
          .optional()
          .describe('Title shown on the artifact. Defaults to the file name.'),
        format: z
          .enum(AUTHORED_ARTIFACT_FORMATS)
          .optional()
          .describe('Omit to derive it from the extension.'),
        sources: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Workspace files the artifact was written from. Omit on a republish to keep the list.'
          ),
      },
      handler: async (args) => {
        try {
          const session = resolveArtifactToolSession(token);
          const result = await publishArtifact(session, args);
          session.onPublished(result);
          return replyWith(result);
        } catch (error) {
          return replyWithError('publish_artifact', error);
        }
      },
    },
    {
      name: 'list_artifacts',
      description: LIST_ARTIFACTS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async () => {
        try {
          return replyWith(await listPublishedArtifacts(resolveArtifactToolSession(token)));
        } catch (error) {
          return replyWithError('list_artifacts', error);
        }
      },
    },
  ];
}

/** The in-process server handed to the Claude SDK's `query({ mcpServers })`. */
export async function createChordMcpServer(
  token: string,
  preferredFormat: PreferredArtifactFormat
): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: CHORD_MCP_SERVER_NAME,
    // Widened to the SDK's declaration; see ChordToolDefinition for why the
    // argument types differ.
    tools: buildChordTools(token, preferredFormat) as SdkMcpToolDefinition[],
  });
}
