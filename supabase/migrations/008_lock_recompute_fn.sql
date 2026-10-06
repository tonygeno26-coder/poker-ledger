-- Lock recompute_standing_balances: deny client roles, service_role only
-- Project: gjbuwlsqobcmxyhosiku
--
-- Standing rule: every new SQL function must REVOKE EXECUTE FROM PUBLIC, anon,
-- and authenticated, and GRANT EXECUTE TO service_role, in the same migration
-- that creates the function.

REVOKE EXECUTE ON FUNCTION recompute_standing_balances(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_standing_balances(uuid[])
  TO service_role;
