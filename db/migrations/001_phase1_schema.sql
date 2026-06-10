-- Investment OS v9 Phase 1 schema.
-- v3 master is the base; v3-A4 overrides cost, ingestion, RT-only, JIT, and pattern behavior.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS context_units (
  unit_id TEXT PRIMARY KEY,
  expert_handle TEXT NOT NULL,
  structural_basis TEXT[] NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completion_status TEXT NOT NULL CHECK (completion_status IN ('open','completed_candidate','completed','reopened','versioned_update')),
  included_post_ids TEXT[] NOT NULL DEFAULT '{}',
  source_stimulus JSONB NOT NULL DEFAULT '{"status":"absent"}',
  elite_posts JSONB NOT NULL DEFAULT '[]',
  media_items JSONB NOT NULL DEFAULT '[]',
  chairman_triage JSONB NOT NULL DEFAULT '{}',
  deep_internalization JSONB NOT NULL DEFAULT '{}',
  archival_status JSONB NOT NULL DEFAULT '{"indexed":true,"retrievable":true,"can_be_reactivated":true}',
  canonical_status TEXT NOT NULL CHECK (canonical_status IN ('pending','verified','quarantined')) DEFAULT 'pending',
  rt_only_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  pattern_tracking_status TEXT NOT NULL CHECK (pattern_tracking_status IN ('none','advisory_candidate','reinforcement','evolution','reversal','retired')) DEFAULT 'none',
  pattern_signature_id UUID,
  difficulty_tier TEXT CHECK (difficulty_tier IN ('T0','T1','T2','T3')),
  jit_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_units_completed_at ON context_units(completed_at);
CREATE INDEX IF NOT EXISTS idx_context_units_triage_gate ON context_units(canonical_status, rt_only_excluded, completed_at);

CREATE TABLE IF NOT EXISTS daily_ingestion_jobs (
  job_id TEXT PRIMARY KEY,
  run_date DATE NOT NULL,
  expert_handle TEXT NOT NULL,
  posts_fetched INT NOT NULL DEFAULT 0,
  new_posts INT NOT NULL DEFAULT 0,
  duplicate_posts INT NOT NULL DEFAULT 0,
  source_stimulus_fetched INT NOT NULL DEFAULT 0,
  unavailable_sources INT NOT NULL DEFAULT 0,
  media_items_seen INT NOT NULL DEFAULT 0,
  media_items_stored_metadata_only INT NOT NULL DEFAULT 0,
  context_units_updated INT NOT NULL DEFAULT 0,
  context_units_created INT NOT NULL DEFAULT 0,
  context_units_completed INT NOT NULL DEFAULT 0,
  failures TEXT[] NOT NULL DEFAULT '{}',
  retry_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internalization_sessions (
  session_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES context_units(unit_id),
  chairman_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_presented_first BOOLEAN NOT NULL DEFAULT TRUE CHECK (original_presented_first = TRUE),
  ai_pre_explanation_blocked BOOLEAN NOT NULL DEFAULT TRUE CHECK (ai_pre_explanation_blocked = TRUE),
  chairman_attempts JSONB NOT NULL DEFAULT '[]',
  ai_feedback JSONB NOT NULL DEFAULT '[]',
  mastery_state TEXT NOT NULL CHECK (mastery_state IN ('not_started','in_progress','retry_required','media_required','mastered')) DEFAULT 'not_started'
);

CREATE TABLE IF NOT EXISTS model_call_logs (
  call_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id TEXT REFERENCES context_units(unit_id),
  route_level TEXT CHECK (route_level IN ('L0','L1','L2','L3','L4')),
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  prompt_fingerprint TEXT,
  cache_type TEXT,
  input_tokens INT,
  cached_input_tokens INT,
  output_tokens INT,
  estimated_cost_usd NUMERIC(10,6),
  actual_cost_usd NUMERIC(10,6),
  difficulty_tier_at_call TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS x_resource_ledger (
  post_id TEXT PRIMARY KEY,
  conversation_id TEXT,
  author_id TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_via TEXT NOT NULL CHECK (fetched_via IN ('x_ppu','apify','twscrape','scrapfly','manual','fixture')),
  trust_layer TEXT NOT NULL CHECK (trust_layer IN ('canonical','gray','quarantined','pending')),
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  raw_payload_hash TEXT,
  referenced_type TEXT,
  is_rt_only BOOLEAN NOT NULL DEFAULT FALSE,
  residual_text_len INT NOT NULL DEFAULT 0,
  canonical_verified_at TIMESTAMPTZ,
  archived BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_xrl_conv ON x_resource_ledger(conversation_id);
CREATE INDEX IF NOT EXISTS idx_xrl_author_fetched ON x_resource_ledger(author_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_xrl_trust_gate ON x_resource_ledger(trust_layer, is_rt_only, archived);

CREATE TABLE IF NOT EXISTS rt_only_archive (
  archive_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL,
  expert_handle TEXT NOT NULL,
  retweeted_post_id TEXT,
  self_rt BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_payload_hash TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pattern_signatures (
  signature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_text TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  repeat_count INT NOT NULL DEFAULT 1,
  chairman_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  advisory_only BOOLEAN NOT NULL DEFAULT TRUE,
  auto_skip_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  drift_flag BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE context_units
  ADD CONSTRAINT fk_context_units_pattern_signature
  FOREIGN KEY (pattern_signature_id)
  REFERENCES pattern_signatures(signature_id);

CREATE TABLE IF NOT EXISTS jit_verification_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id TEXT NOT NULL REFERENCES context_units(unit_id),
  selected_for_batch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('queued','verified','quarantined','failed')) DEFAULT 'queued',
  provider TEXT NOT NULL DEFAULT 'manual',
  failure_reason TEXT,
  UNIQUE (unit_id)
);

CREATE INDEX IF NOT EXISTS idx_jit_status ON jit_verification_queue(status, selected_for_batch_at);

CREATE TABLE IF NOT EXISTS bot_message_cleanup (
  bot_role TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_ids TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_role, chat_id)
);
