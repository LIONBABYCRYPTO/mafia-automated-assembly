-- Mafia Game - D1 Schema
-- Run: wrangler d1 execute mafia-game-db --file=schema.sql

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT UNIQUE NOT NULL,
  host_id TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'lobby',
  round INTEGER NOT NULL DEFAULT 1,
  phase_ends_at TEXT,
  winner TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_code) REFERENCES rooms(room_code) ON DELETE CASCADE,
  UNIQUE(room_code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_code);

CREATE TABLE IF NOT EXISTS player_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  room_code TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('villager', 'werewolf', 'seer', 'doctor')),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (room_code) REFERENCES rooms(room_code) ON DELETE CASCADE,
  UNIQUE(player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_roles_room ON player_roles(room_code);

CREATE TABLE IF NOT EXISTS night_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  round INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  target_id INTEGER,
  action_type TEXT NOT NULL CHECK (action_type IN ('kill', 'investigate', 'protect')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_code) REFERENCES rooms(room_code) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(room_code, round, player_id)
);

CREATE TABLE IF NOT EXISTS day_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  round INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_code) REFERENCES rooms(room_code) ON DELETE CASCADE,
  FOREIGN KEY (voter_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(room_code, round, voter_id)
);
