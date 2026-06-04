-- Incremental: bounty columns on posts (safe for existing DBs)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bounty_amount TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bounty_chain TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bounty_status TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bounty_assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bounty_platform_tx_id TEXT;
