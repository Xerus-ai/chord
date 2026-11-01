import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export interface MessageInput {
  push: (message: SDKUserMessage) => void;
  end: () => void;
  iterable: AsyncIterable<SDKUserMessage>;
}

// The prompt is a pushable stream, not a one-shot string: the query must stay
// alive across turns so completed turns are not process exits (a completed
// turn only emits a `result` message; the stream ends when we close it).
export function createMessageInput(): MessageInput {
  const queue: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let ended = false;

  return {
    push(message: SDKUserMessage): void {
      queue.push(message);
      notify?.();
    },
    end(): void {
      ended = true;
      notify?.();
    },
    iterable: {
      async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
        while (true) {
          while (queue.length > 0) {
            yield queue.shift() as SDKUserMessage;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
      },
    },
  };
}

export function toUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}
