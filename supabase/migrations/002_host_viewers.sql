-- Host viewer invites + optional game sync for read-only viewers
-- Project: gjbuwlsqobcmxyhosiku

-- Owner accounts remain role='owner'; invited viewers become role='host_viewer'
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS linked_owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('owner', 'host_viewer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_linked_owner_id_idx ON users (linked_owner_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

CREATE TABLE IF NOT EXISTS host_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_email TEXT NOT NULL,
  viewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, viewer_email)
);

CREATE INDEX IF NOT EXISTS host_viewers_owner_user_id_idx ON host_viewers (owner_user_id);
CREATE INDEX IF NOT EXISTS host_viewers_viewer_email_idx ON host_viewers (lower(viewer_email));
CREATE INDEX IF NOT EXISTS host_viewers_status_idx ON host_viewers (status);

-- Minimal game state sync so GET /game/current/:ownerUserId can return latest G JSON
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS games_owner_updated_at_idx
  ON games (owner_user_id, updated_at DESC);
