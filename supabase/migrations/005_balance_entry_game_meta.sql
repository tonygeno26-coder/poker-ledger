-- Game date + location on balance entries (book History label)
-- Project: gjbuwlsqobcmxyhosiku

ALTER TABLE person_balance_entries
  ADD COLUMN IF NOT EXISTS game_date TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT;
