-- `provision_error` became typed JSON (shared/work-item-provision-error.ts), read
-- back by a parser that throws on anything else. Errors written before that are
-- plain sentences: they keep their text as a `legacy` error, so every row holds
-- the one shape and no reader has to guess.
UPDATE `work_items`
SET `provision_error` = json_object('type', 'legacy', 'message', `provision_error`)
WHERE `provision_error` IS NOT NULL
  -- CASE, not AND: json_type raises on malformed JSON, and SQLite does not
  -- promise to short-circuit. IS NOT also catches valid JSON with no `type`.
  AND (CASE WHEN json_valid(`provision_error`) THEN json_type(`provision_error`, '$.type') END)
    IS NOT 'text';
