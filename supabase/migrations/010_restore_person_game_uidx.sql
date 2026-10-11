DROP INDEX IF EXISTS person_balance_entries_person_game_uidx;
CREATE UNIQUE INDEX person_balance_entries_person_game_uidx
  ON person_balance_entries (person_id, game_id);
