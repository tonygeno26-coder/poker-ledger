-- Batched standing_balance recompute for POST /games/:gameId/post-balances
-- Project: gjbuwlsqobcmxyhosiku
-- standing = sum(deltas) over person_balance_entries (same as prior per-person path)

CREATE OR REPLACE FUNCTION recompute_standing_balances(p_person_ids uuid[])
RETURNS TABLE (
  id uuid,
  owner_user_id uuid,
  name text,
  tag text,
  notes text,
  last_role text,
  last_played_at timestamptz,
  archived boolean,
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
    p.created_at,
    p.updated_at,
    p.standing_balance,
    p.balance_updated_at
  FROM people p
  WHERE p.id = ANY (p_person_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_standing_balances(uuid[]) TO service_role;
