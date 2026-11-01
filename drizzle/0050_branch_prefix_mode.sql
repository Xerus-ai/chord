-- `localProject.branchPrefixMode` is new and defaults to `username` (Settings ›
-- Git). Settings rows hold only what the user changed, so a stored
-- `branchPrefix` is a choice they made: a cleared one meant no prefix, any other
-- a prefix of their own. Record that as the mode, so the new default only
-- reaches users who never chose.
UPDATE `app_settings`
SET `value` = json_set(
  `value`,
  '$.branchPrefixMode',
  CASE WHEN json_extract(`value`, '$.branchPrefix') = '' THEN 'none' ELSE 'custom' END
)
WHERE `key` = 'localProject'
  -- CASE, not AND: json_type raises on malformed JSON, and SQLite does not
  -- promise to short-circuit.
  AND (CASE WHEN json_valid(`value`) THEN json_type(`value`, '$.branchPrefix') END) = 'text';
