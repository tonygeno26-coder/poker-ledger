const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      nickname TEXT,
      telegram_id BIGINT UNIQUE,
      telegram_username TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      location TEXT,
      date DATE,
      game_type TEXT,
      stakes TEXT,
      status TEXT DEFAULT 'active',
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS game_players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      player_id UUID REFERENCES players(id),
      player_name TEXT,
      buyin_cash NUMERIC DEFAULT 0,
      buyin_marker NUMERIC DEFAULT 0,
      addons JSONB DEFAULT '[]',
      total_in NUMERIC DEFAULT 0,
      cash_out NUMERIC DEFAULT 0,
      marker_out NUMERIC DEFAULT 0,
      total_out NUMERIC DEFAULT 0,
      result NUMERIC DEFAULT 0,
      pay_in NUMERIC DEFAULT 0,
      pay_out NUMERIC DEFAULT 0,
      paid_in NUMERIC DEFAULT 0,
      paid_out NUMERIC DEFAULT 0,
      owes NUMERIC DEFAULT 0,
      owed NUMERIC DEFAULT 0,
      notified BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      from_player_id UUID REFERENCES players(id),
      from_name TEXT,
      to_player_id UUID REFERENCES players(id),
      to_name TEXT,
      amount NUMERIC,
      paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      base NUMERIC DEFAULT 0,
      tips NUMERIC DEFAULT 0,
      misc NUMERIC DEFAULT 0,
      gross NUMERIC DEFAULT 0,
      comm_pct NUMERIC DEFAULT 0,
      commission NUMERIC DEFAULT 0,
      net NUMERIC DEFAULT 0,
      paid NUMERIC DEFAULT 0,
      owed NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES games(id) ON DELETE CASCADE,
      name TEXT,
      pct NUMERIC DEFAULT 0,
      share NUMERIC DEFAULT 0,
      paid NUMERIC DEFAULT 0,
      owed NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS telegram_registrations (
      telegram_id BIGINT PRIMARY KEY,
      player_id UUID REFERENCES players(id),
      registered_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Database initialized');
}

module.exports = { pool, initDB };
