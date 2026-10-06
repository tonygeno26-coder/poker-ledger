-- Enable RLS on app tables. Service role bypasses RLS; no policies means
-- anon/authenticated PostgREST access returns empty / denied.
-- Also revoke table privileges from anon and authenticated.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_balance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_viewers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE games FROM anon, authenticated;
REVOKE ALL ON TABLE people FROM anon, authenticated;
REVOKE ALL ON TABLE person_balance_entries FROM anon, authenticated;
REVOKE ALL ON TABLE promo_codes FROM anon, authenticated;
REVOKE ALL ON TABLE promo_redemptions FROM anon, authenticated;
REVOKE ALL ON TABLE host_viewers FROM anon, authenticated;
