import type { McpServerElicitationRequestParams } from './protocol/v2/McpServerElicitationRequestParams';
import type { PermissionsRequestApprovalParams } from './protocol/v2/PermissionsRequestApprovalParams';
import type { ToolRequestUserInputParams } from './protocol/v2/ToolRequestUserInputParams';

/**
 * Server requests captured from a live `codex app-server` (codex-cli 0.154.0)
 * on 2026-09-23, not written by hand. The MCP ones came from the reference
 * `@modelcontextprotocol/server-everything` server; the permissions request
 * needs the `request_permissions_tool` feature, off by default in 0.154.
 */

/** Codex asking to run an MCP tool: an elicitation with an empty form. */
export const MCP_TOOL_APPROVAL: McpServerElicitationRequestParams = {
  threadId: '01a0cf74-cfe7-7232-bd0d-3513d2d46a58',
  turnId: '01a0cf74-d024-7280-8cf9-991fe755c7f4',
  serverName: 'everything',
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    tool_title: 'Trigger URL Elicitation Tool',
    tool_description:
      "Trigger a URL elicitation so the client can direct the user to a browser flow. Supports two mechanisms: the request path (elicitation/create, default) which awaits the user's response, and the error path (UrlElicitationRequiredError, -32042) which signals the client to handle URL elicitation via the error response. Set errorPath=true to use the error path.",
    tool_params: {
      url: 'https://example.com',
      message: 'Open this example URL to test URL elicitation.',
    },
    tool_params_display: [
      {
        name: 'message',
        value: 'Open this example URL to test URL elicitation.',
        display_name: 'message',
      },
      {
        name: 'url',
        value: 'https://example.com',
        display_name: 'url',
      },
    ],
  },
  message: 'Allow the everything MCP server to run tool "trigger-url-elicitation"?',
  requestedSchema: {
    type: 'object',
    properties: {},
  },
};

/**
 * An MCP server's own form (`trigger-elicitation-request`). Cast because the
 * generated types say `bigint` for the schema's u64 fields (`minItems`,
 * `maxItems`) while the wire carries JSON numbers, as captured here.
 */
export const MCP_FORM_ELICITATION = {
  threadId: '01a0cf77-9d39-7e51-b1b6-17679fb8a367',
  turnId: '01a0cf77-9e3a-7263-94a1-33e58c13440e',
  serverName: 'everything',
  mode: 'form',
  _meta: null,
  message: 'Please provide inputs for the following fields:',
  requestedSchema: {
    type: 'object',
    properties: {
      birthdate: {
        type: 'string',
        title: 'String with date format',
        description: 'Your date of birth',
        format: 'date',
      },
      check: {
        type: 'boolean',
        title: 'Boolean',
        description: 'Agree to the terms and conditions',
      },
      email: {
        type: 'string',
        title: 'String with email format',
        description: 'Your email address (will be verified, and never shared with anyone else)',
        format: 'email',
      },
      firstLine: {
        type: 'string',
        title: 'String with default',
        description: 'Favorite first line of a story',
        default: 'It was a dark and stormy night.',
      },
      homepage: {
        type: 'string',
        title: 'String with uri format',
        description: 'Portfolio / personal website',
        format: 'uri',
      },
      integer: {
        type: 'integer',
        title: 'Integer',
        description:
          'Your favorite integer (do not give us your phone number, pin, or other sensitive info)',
        minimum: 1,
        maximum: 100,
        default: 42,
      },
      legacyTitledEnum: {
        type: 'string',
        title: 'Legacy Titled Single Select Enum',
        description: 'Choose your favorite type of pet',
        enum: ['pet-1', 'pet-2', 'pet-3', 'pet-4', 'pet-5'],
        enumNames: ['Cats', 'Dogs', 'Birds', 'Fish', 'Reptiles'],
        default: 'pet-1',
      },
      name: {
        type: 'string',
        title: 'String',
        description: 'Your full, legal name',
      },
      number: {
        type: 'number',
        title: 'Number in range 1-1000',
        description: 'Favorite number (there are no wrong answers)',
        minimum: 0,
        maximum: 1000,
        default: 3.14,
      },
      titledMultipleSelectEnum: {
        type: 'array',
        title: 'Titled Multiple Select Enum',
        description: 'Choose your favorite types of fish',
        minItems: 1,
        maxItems: 3,
        items: {
          anyOf: [
            {
              const: 'fish-1',
              title: 'Tuna',
            },
            {
              const: 'fish-2',
              title: 'Salmon',
            },
            {
              const: 'fish-3',
              title: 'Trout',
            },
          ],
        },
        default: ['fish-1'],
      },
      titledSingleSelectEnum: {
        type: 'string',
        title: 'Titled Single Select Enum',
        description: 'Choose your favorite hero',
        oneOf: [
          {
            const: 'hero-1',
            title: 'Superman',
          },
          {
            const: 'hero-2',
            title: 'Green Lantern',
          },
          {
            const: 'hero-3',
            title: 'Wonder Woman',
          },
        ],
        default: 'hero-1',
      },
      untitledMultipleSelectEnum: {
        type: 'array',
        title: 'Untitled Multiple Select Enum',
        description: 'Choose your favorite instruments',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'string',
          enum: ['Guitar', 'Piano', 'Violin', 'Drums', 'Bass'],
        },
        default: ['Guitar'],
      },
      untitledSingleSelectEnum: {
        type: 'string',
        title: 'Untitled Single Select Enum',
        description: 'Choose your favorite friend',
        enum: ['Monica', 'Rachel', 'Joey', 'Chandler', 'Ross', 'Phoebe'],
        default: 'Monica',
      },
    },
    required: ['name'],
  },
} as unknown as McpServerElicitationRequestParams;

export const PERMISSIONS_APPROVAL: PermissionsRequestApprovalParams = {
  threadId: '01a0cf77-e316-7803-b82a-ff26e2291a45',
  turnId: '01a0cf77-e364-7c90-bb77-0b04db32a020',
  itemId: 'exec-014a9261-5157-4f56-9343-466641531adb',
  environmentId: 'local',
  startedAtMs: 1790187141599,
  cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp',
  reason: 'May I access the network to fetch https://example.com?',
  permissions: {
    network: {
      enabled: true,
    },
    fileSystem: null,
  },
};

/**
 * A write request, captured 2026-09-24 with `--enable request_permissions_tool`:
 * the path comes both in the legacy `write` list and as an `entries` item.
 */
export const FILE_PERMISSIONS_APPROVAL: PermissionsRequestApprovalParams = {
  threadId: '01a0cfde-1f82-7882-9e8c-9f2a2c92a72b',
  turnId: '01a0cfde-1fc3-7380-bdbf-0157f6cf201b',
  itemId: 'exec-729a78ee-373d-4987-a131-cf243fdcb2eb',
  environmentId: 'local',
  startedAtMs: 1790193842070,
  cwd: 'C:\\Users\\dev',
  reason: null,
  permissions: {
    network: null,
    fileSystem: {
      read: null,
      write: ['C:\\Users\\dev\\chord-perm-check'],
      entries: [
        {
          path: { type: 'path', path: 'C:\\Users\\dev\\chord-perm-check' },
          access: 'write',
        },
      ],
    },
  },
};

/** A plan-mode clarifying question. */
export const USER_INPUT_REQUEST: ToolRequestUserInputParams = {
  threadId: '01a0cf73-1e82-7132-ad98-dbc36ee8f7d1',
  turnId: '01a0cf73-1ec2-7692-bb28-88b29d3c4784',
  itemId: 'call_j88fnrIO7jIM10REJ0DPfrTi',
  questions: [
    {
      id: 'language',
      header: 'Language',
      question: 'Which programming language should the greeting CLI use?',
      isOther: true,
      isSecret: false,
      options: [
        {
          label: 'Python (Recommended)',
          description: 'Simple implementation with minimal setup if Python is installed.',
        },
        {
          label: 'Go',
          description: 'Compiles into a standalone executable with straightforward distribution.',
        },
        {
          label: 'Rust',
          description: 'Compiles into a standalone executable with strong compile-time checks.',
        },
      ],
    },
  ],
  isBlocking: true,
  autoResolutionMs: null,
};
