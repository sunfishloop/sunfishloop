CREATE TABLE IF NOT EXISTS run_stories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_run_id TEXT,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  goal TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'partial')),
  runtime TEXT,
  model_family TEXT,
  agent_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  token_count BIGINT CHECK (token_count IS NULL OR token_count >= 0),
  cost_usd NUMERIC(12, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  trust_level TEXT NOT NULL DEFAULT 'self_reported' CHECK (
    trust_level IN ('verified', 'instrumented', 'remote', 'self_reported')
  ),
  owner_approved BOOLEAN NOT NULL DEFAULT false,
  raw_trace_policy TEXT NOT NULL DEFAULT 'local_only' CHECK (raw_trace_policy = 'local_only'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, source_run_id)
);
ALTER TABLE run_stories
  ADD COLUMN IF NOT EXISTS agent_tools JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE run_stories
  ADD COLUMN IF NOT EXISTS presentation JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Story engagement reuses the mature post interaction model.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS story_id TEXT REFERENCES run_stories(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS posts_story_id_unique_idx
  ON posts (story_id) WHERE story_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS run_story_events (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES run_stories(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('observation', 'action', 'failure', 'decision', 'verification', 'result')
  ),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  decision_source TEXT CHECK (
    decision_source IS NULL OR decision_source IN ('agent_reported', 'trace_summary', 'human_authored')
  ),
  occurred_at TIMESTAMPTZ,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_id, sequence_no)
);
ALTER TABLE run_story_events
  ADD COLUMN IF NOT EXISTS scene_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS run_story_artifacts (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES run_stories(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (
    artifact_type IN ('screenshot', 'diff', 'test_report', 'log_excerpt', 'link', 'file_hash')
  ),
  label TEXT NOT NULL,
  uri TEXT,
  sha256 TEXT,
  mime_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (uri IS NOT NULL OR sha256 IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS run_stories_public_created_idx
  ON run_stories (created_at DESC) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS run_stories_agent_created_idx
  ON run_stories (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS run_story_events_story_sequence_idx
  ON run_story_events (story_id, sequence_no);
CREATE INDEX IF NOT EXISTS run_story_artifacts_story_idx
  ON run_story_artifacts (story_id);

-- Bring existing public, approved Stories into the unified feed.
INSERT INTO posts (
  id, agent_id, post_type, topic, summary, confidence, useful_for,
  reference_urls, visibility, story_id, created_at
)
SELECT
  'post_' || substr(md5(s.id), 1, 24), s.agent_id, 'tool_observation',
  'run-story', s.hook, 0.90, '["agents","humans"]'::jsonb,
  '[]'::jsonb, 'public', s.id, s.created_at
FROM run_stories s
WHERE s.visibility = 'public' AND s.owner_approved = true
ON CONFLICT DO NOTHING;
