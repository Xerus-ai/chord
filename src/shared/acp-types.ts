export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type AcpToolCallKind = 'read' | 'edit' | 'execute';

export interface AcpToolContent {
  type: 'text' | 'diff';
  text?: string;
  diff?: string;
}

export interface AcpFileLocation {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface AcpPermissionRequest {
  requestId: string;
  name: string;
  kind: string;
  title?: string;
  input?: Record<string, unknown>;
  options: AcpPermissionOption[];
}

export type AcpSessionUpdate =
  | {
      sessionUpdate: 'agent_message_chunk';
      content: { type: 'text'; text: string };
      messageId?: string;
    }
  | {
      sessionUpdate: 'agent_thought_chunk';
      content: { type: 'text'; text: string };
    }
  | {
      sessionUpdate: 'tool_call';
      toolCallId: string;
      status: AcpToolCallStatus;
      title?: string;
      kind?: AcpToolCallKind;
      rawInput?: Record<string, unknown>;
      content?: AcpToolContent[];
      locations?: AcpFileLocation[];
    }
  | {
      sessionUpdate: 'tool_call_update';
      toolCallId: string;
      status: AcpToolCallStatus;
      rawInput?: Record<string, unknown>;
      content?: AcpToolContent[];
    }
  | {
      sessionUpdate: 'plan';
      entries: { text: string; status: string }[];
    }
  | {
      /** The agent's full set of config options after any change. */
      sessionUpdate: 'config_option_update';
      configOptions: AcpConfigOption[];
    }
  | {
      sessionUpdate: 'current_mode_update';
      currentModeId: string;
    }
  | {
      /** Context fill (`used` of `size` tokens) and the session's running cost. */
      sessionUpdate: 'usage_update';
      used: number;
      size: number;
      cost?: { amount: number; currency: string } | null;
    }
  | {
      sessionUpdate: 'available_commands_update';
      commands: { name: string; description: string }[];
    }
  | {
      sessionUpdate: 'user_message_chunk';
      content: { type: 'text'; text: string };
    };

export interface AcpSelectChoice {
  value: string;
  name: string;
  description?: string | null;
}

/** A `session/new` / `session/set_config_option` config option (ACP schema). */
export type AcpConfigOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
} & (
  | {
      type: 'select';
      currentValue: string;
      options: AcpSelectChoice[] | { group: string; name: string; options: AcpSelectChoice[] }[];
    }
  | { type: 'boolean'; currentValue: boolean }
);
