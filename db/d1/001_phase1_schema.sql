CREATE TABLE IF NOT EXISTS ledger_posts (
  post_id TEXT PRIMARY KEY,
  expert_handle TEXT NOT NULL,
  trust_layer TEXT NOT NULL CHECK (trust_layer IN ('canonical','gray','quarantined','pending')),
  fetched_via TEXT NOT NULL CHECK (fetched_via IN ('x_ppu','apify','twscrape','scrapfly','manual','fixture')),
  is_rt_only INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rt_only_archive (
  post_id TEXT PRIMARY KEY,
  expert_handle TEXT NOT NULL,
  retweeted_post_id TEXT,
  self_rt INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context_units (
  unit_id TEXT PRIMARY KEY,
  expert_handle TEXT NOT NULL,
  original_text TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  canonical_status TEXT NOT NULL CHECK (canonical_status IN ('pending','verified','quarantined')),
  rt_only_excluded INTEGER NOT NULL DEFAULT 0,
  structural_basis_json TEXT NOT NULL DEFAULT '[]',
  triage_decision TEXT,
  triage_grade TEXT,
  triage_score INTEGER,
  triage_rationale_json TEXT,
  triage_sent_at TEXT,
  triage_message_id INTEGER,
  internalization_state TEXT
);

CREATE INDEX IF NOT EXISTS idx_context_units_triage
ON context_units(canonical_status, rt_only_excluded, triage_decision, triage_sent_at, completed_at);

CREATE TABLE IF NOT EXISTS internalized_context_units (
  unit_id TEXT PRIMARY KEY,
  expert_handle TEXT NOT NULL,
  original_text TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'triage_bot'
);

CREATE TABLE IF NOT EXISTS chairman_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  attempt_text TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (unit_id) REFERENCES context_units(unit_id)
);

CREATE TABLE IF NOT EXISTS ai_cost_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reason TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_krw INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_message_cleanup (
  bot_role TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_ids TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bot_role, chat_id)
);
