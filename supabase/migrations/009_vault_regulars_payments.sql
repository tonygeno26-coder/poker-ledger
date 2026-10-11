-- The Vault: people.regular + settle-between-games payments
-- Project: gjbuwlsqobcmxyhosiku
--
-- Standing rule: every new SQL function must REVOKE EXECUTE FROM PUBLIC, anon,
-- and authenticated, and GRANT EXECUTE TO service_role, in the same migration
-- that creates/replaces the function.
--
-- Do NOT wipe server data.

-- ★ Regulars flag on people
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS regular BOOLEAN NOT NULL DEFAULT FALSE;

-- Payment / adjustment entries (settle between games)
ALTER TABLE person_balance_entries
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'game',
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Allow payment rows with no game
ALTER TABLE person_balance_entries
  ALTER COLUMN game_id DROP NOT NULL;

-- Unique (person_id, game_id) only when a game is linked
DROP INDEX IF EXISTS person_balance_entries_person_game_uidx;
CREATE UNIQUE INDEX person_balance_entries_person_game_uidx
  ON person_balance_entries (person_id, game_id)
  WHERE game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS person_balance_entries_kind_idx
  ON person_balance_entries (kind);

CREATE INDEX IF NOT EXISTS people_regular_idx
  ON people (owner_user_id, regular)
  WHERE regular = TRUE;

-- Recompute must return the new regular column so clients keep it in sync.
-- DROP first: CREATE OR REPLACE cannot change OUT/RETURNS TABLE shape.
DROP FUNCTION IF EXISTS recompute_standing_balances(uuid[]);

CREATE FUNCTION recompute_standing_balances(p_person_ids uuid[])
RETURNS TABLE (
  id uuid,
  owner_user_id uuid,
  name text,
  tag text,
  notes text,
  last_role text,
  last_played_at timestamptz,
  archived boolean,
  regular boolean,
  created_at timestamptz,
  updated_at timestamptz,
  standing_balance numeric,
  balance_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := NOW();
BEGIN
  IF p_person_ids IS NULL OR array_length(p_person_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE people p
  SET
    standing_balance = COALESCE((
      SELECT ROUND(SUM(e.delta)::numeric, 2)
      FROM person_balance_entries e
      WHERE e.person_id = p.id
    ), 0),
    balance_updated_at = now_ts,
    updated_at = now_ts
  WHERE p.id = ANY (p_person_ids);

  RETURN QUERY
  SELECT
    p.id,
    p.owner_user_id,
    p.name,
    p.tag,
    p.notes,
    p.last_role,
    p.last_played_at,
    p.archived,
    p.regular,
    p.created_at,
    p.updated_at,
    p.standing_balance,
    p.balance_updated_at
  FROM people p
  WHERE p.id = ANY (p_person_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION recompute_standing_balances(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_standing_balances(uuid[])
  TO service_role;
