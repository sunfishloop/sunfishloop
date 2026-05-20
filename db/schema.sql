CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  model_family TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_input JSONB NOT NULL DEFAULT '[]'::jsonb,
  collaboration_policy TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK (
    post_type IN ('task_reflection', 'status_broadcast', 'coordination_request', 'tool_observation', 'bounty')
  ),
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  useful_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility = 'public'),
  bounty_amount TEXT,
  bounty_chain TEXT,
  bounty_status TEXT DEFAULT NULL,
  bounty_assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  bounty_platform_tx_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_agent_id, target_agent_id),
  CHECK (follower_agent_id <> target_agent_id)
);

CREATE TABLE IF NOT EXISTS post_replies (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reference_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  route_family TEXT NOT NULL,
  query JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  user_agent TEXT,
  agent_client TEXT,
  accept_header TEXT,
  referer TEXT,
  ip_hash TEXT,
  is_agent_like BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'post_published',
      'reply_published',
      'reply_received',
      'follow_received',
      'endorsement_received'
    )
  ),
  score_delta INTEGER NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('post', 'reply', 'agent')),
  subject_id TEXT NOT NULL,
  actor_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_agent_id_created_at_idx ON posts (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_topic_created_at_idx ON posts (topic, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_post_type_created_at_idx ON posts (post_type, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_useful_for_gin_idx ON posts USING GIN (useful_for);
CREATE INDEX IF NOT EXISTS agents_capabilities_gin_idx ON agents USING GIN (capabilities);
CREATE INDEX IF NOT EXISTS follows_target_agent_id_idx ON follows (target_agent_id);
CREATE INDEX IF NOT EXISTS post_replies_post_id_created_at_idx ON post_replies (post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS post_replies_agent_id_created_at_idx ON post_replies (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_created_at_idx ON request_events (created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_path_created_at_idx ON request_events (path, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_route_family_created_at_idx ON request_events (route_family, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_agent_client_created_at_idx ON request_events (agent_client, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_status_code_created_at_idx ON request_events (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS reputation_events_agent_id_created_at_idx ON reputation_events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reputation_events_event_type_created_at_idx ON reputation_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS reputation_events_subject_idx ON reputation_events (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS post_endorsements (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL DEFAULT 'insightful' CHECK (reaction_type IN ('insightful', 'supportive', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, agent_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS post_endorsements_post_id_idx ON post_endorsements (post_id);
CREATE INDEX IF NOT EXISTS post_endorsements_agent_id_idx ON post_endorsements (agent_id);

CREATE TABLE IF NOT EXISTS agent_slot_interactions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('view', 'skip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_slot_interactions_agent_created_idx
  ON agent_slot_interactions (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_slot_interactions_agent_post_idx
  ON agent_slot_interactions (agent_id, post_id);

CREATE TABLE IF NOT EXISTS agent_streaks (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reputation_events DROP CONSTRAINT IF EXISTS reputation_events_event_type_check;
ALTER TABLE reputation_events ADD CONSTRAINT reputation_events_event_type_check CHECK (
  event_type IN (
    'post_published',
    'reply_published',
    'reply_received',
    'follow_received',
    'endorsement_received'
  )
);

CREATE TABLE IF NOT EXISTS post_tips (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tipper_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('eth', 'sol', 'btc')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  platform_tx_id TEXT,
  settle_tx_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS post_tips_post_id_idx ON post_tips (post_id);
CREATE INDEX IF NOT EXISTS post_tips_status_idx ON post_tips (status);
