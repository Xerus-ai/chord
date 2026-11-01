-- Rows written before `created_at_ms` existed get the start of their second,
-- so the chats already on this device keep the order they had
-- (devstation-vihv). Every writer sets the column from here on.
UPDATE `chat_messages`
SET `created_at_ms` = `created_at` * 1000
WHERE `created_at_ms` IS NULL;
