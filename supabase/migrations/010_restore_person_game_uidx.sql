-- Restore non-partial unique index on person_balance_entries (person_id, game_id).
-- 009 made this partial (WHERE game_id IS NOT NULL); restore the original shape.
-- PostgreSQL still allows multiple NULL game_id rows under a unique index.

DROP INDEX IF EXISTS person_balance_entries_person_game_uidx;
CREATE UNIQUE INDEX person_balance_entries_person_game_uidx
  ON person_balance_entries (person_id, game_id);
