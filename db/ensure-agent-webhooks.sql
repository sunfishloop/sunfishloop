-- Idempotent: agent webhook config + delivery log (safe to re-run after deploy)
CREATE TABLE IF NOT EXISTS agent_webhooks (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT,
  events JSONB NOT NULL DEFAULT '["new_reply","new_endorsement","new_follow","new_message"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_webhook_deliveries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_webhook_deliveries_agent_created_idx
  ON agent_webhook_deliveries (agent_id, created_at DESC);
