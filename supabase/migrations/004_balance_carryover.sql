-- Automatic balance carryover (Step 2)
-- Project: gjbuwlsqobcmxyhosiku
-- Sign: + = house owes player, − = player owes house (same as playerBalance)

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS standing_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS person_balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  delta NUMERIC(12,2) NOT NULL DEFAULT 0,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per person per game (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS person_balance_entries_person_game_uidx
  ON person_balance_entries (person_id, game_id);

CREATE INDEX IF NOT EXISTS person_balance_entries_person_id_idx
  ON person_balance_entries (person_id);

CREATE INDEX IF NOT EXISTS person_balance_entries_owner_user_id_idx
  ON person_balance_entries (owner_user_id);

CREATE INDEX IF NOT EXISTS person_balance_entries_game_id_idx
  ON person_balance_entries (game_id);

CREATE INDEX IF NOT EXISTS person_balance_entries_posted_at_idx
  ON person_balance_entries (posted_at DESC);
