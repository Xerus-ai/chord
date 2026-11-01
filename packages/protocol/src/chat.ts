import { z } from 'zod';

/**
 * Wire shapes for cloud chat messages — the `chat_messages` row as REST and
 * the socket carry it, plus the request bodies that write it. snake_case:
 * these are wire payloads, not app models.
 */

export const CloudChatSenderTypeSchema = z.enum(['human', 'agent', 'system']);

/** Every message_type the local writer has ever produced for durable rows. */
export const CloudChatMessageTypeSchema = z.enum([
  'text',
  'code',
  'system',
  'commit',
  'agent_turn',
]);

/**
 * A cloud chat_messages row as REST GET and the chat_message_received
 * broadcast carry it. message_type stays an open string here (not the enum):
 * the column is written by several producers and readers must tolerate a
 * value this client predates.
 */
export const CloudChatMessageSchema = z.object({
  id: z.string(),
  work_item_id: z.string(),
  /** The local agent_sessions.id that produced this message, or null. */
  session_id: z.string().nullable(),
  sender_id: z.string().nullable(),
  sender_type: CloudChatSenderTypeSchema,
  sender_name: z.string().nullable(),
  content: z.string(),
  message_type: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

/** One row of the creator-only PUT /messages/bulk body. */
export const CloudChatBulkMessageSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  /** The local agent_sessions.id that produced this message, or null. */
  session_id: z.string().nullable().optional(),
  sender_type: CloudChatSenderTypeSchema,
  sender_name: z.string().nullable().optional(),
  message_type: CloudChatMessageTypeSchema,
  /** UTC ISO with offset — naive strings land in the server's timezone. */
  created_at: z.iso.datetime({ offset: true }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ChatBulkPutBodySchema = z.object({
  messages: z.array(CloudChatBulkMessageSchema).min(1).max(500),
});

/** Body of POST /work-items/:id/messages (a single participant send). */
export const CreateChatMessageBodySchema = z.object({
  id: z.uuid().optional(),
  content: z.string().min(1),
  session_id: z.string().nullable().optional(),
  message_type: z.enum(['text', 'code', 'system']).default('text'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const HydrateChatMessagesBodySchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
});

export type CloudChatSenderType = z.infer<typeof CloudChatSenderTypeSchema>;
export type CloudChatMessageType = z.infer<typeof CloudChatMessageTypeSchema>;

/** Row shapes are what the server EMITS — the parsed (output) side. */
export type CloudChatMessage = z.infer<typeof CloudChatMessageSchema>;

/**
 * Request bodies are what a client BUILDS — the input side, so a field the
 * schema defaults or leaves optional stays optional for the producer.
 */
export type CloudChatBulkMessage = z.input<typeof CloudChatBulkMessageSchema>;
export type ChatBulkPutBody = z.input<typeof ChatBulkPutBodySchema>;
export type CreateChatMessageBody = z.input<typeof CreateChatMessageBodySchema>;
