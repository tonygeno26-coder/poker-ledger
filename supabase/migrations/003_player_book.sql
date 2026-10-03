-- Persistent player book (Step 1 — no balance carryover)
-- Project: gjbuwlsqobcmxyhosiku

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tag TEXT,
  notes TEXT,
  last_role TEXT,
  last_played_at TIMESTAMPTZ,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per owner on uppercase name + coalesce(tag,'')
CREATE UNIQUE INDEX IF NOT EXISTS people_owner_name_tag_uidx
  ON people (owner_user_id, name, coalesce(tag, ''));

CREATE INDEX IF NOT EXISTS people_owner_user_id_idx
  ON people (owner_user_id);
