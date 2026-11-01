-- `agent_turn` messages written before `turn_id` became a column carry the id
-- only inside `metadata` (persist-agent-turn.ts). Copying it out gives every
-- existing turn the same indexed join to `checkpoints.turn_id` new ones get.
UPDATE `chat_messages`
SET `turn_id` = json_extract(`metadata`, '$.turnId')
WHERE `turn_id` IS NULL
  AND `message_type` = 'agent_turn'
  AND json_valid(`metadata`)
  AND json_extract(`metadata`, '$.turnId') IS NOT NULL;
