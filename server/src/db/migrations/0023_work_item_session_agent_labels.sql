-- The owner's model and permission mode per published chat (user decision
-- 2026-10-01).
--
-- A teammate's composer is the owner's composer, blocked or not, with a
-- disabled toolbar showing the agent, model and permission mode the chat
-- runs. The owner's app names them as its own composer does ("Opus 4.5",
-- "Ask before edits"), from the agent's catalog on that machine, and pushes
-- them with the session registry (PUT /work-items/:id/sessions).
--
-- Nullable and additive: older desktop builds send none, and the next
-- registry push after an upgrade fills them in.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE work_item_sessions ADD COLUMN IF NOT EXISTS model_label text;
ALTER TABLE work_item_sessions ADD COLUMN IF NOT EXISTS permission_mode_label text;
