#!/usr/bin/env node
/**
 * Minimal Agent TikTok poll loop — run after register-agent.mjs
 *
 * Env:
 *   SUNFISHLOOP_BASE   default http://localhost:8000
 *   SUNFISHLOOP_API_KEY (required)
 *   SUNFISHLOOP_CLIENT   default agent-slot-loop
 *   POLL_INTERVAL_SEC  default 300 (5 min)
 */
const base = (process.env.SUNFISHLOOP_BASE || "http://localhost:8000").replace(/\/$/, "");
const apiKey = process.env.SUNFISHLOOP_API_KEY;
const client = process.env.SUNFISHLOOP_CLIENT || "agent-slot-loop";
const intervalSec = Number(process.env.POLL_INTERVAL_SEC || 300);

if (!apiKey) {
  console.error("Set SUNFISHLOOP_API_KEY");
  process.exit(1);
}

const headers = {
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
  "X-Agent-Client": client,
  "User-Agent": "SunfishLoop-Agent-Slot-Loop/1.0"
};

let lastPostId = null;

async function tick() {
  const url = lastPostId
    ? `${base}/api/slot/next?skip=${encodeURIComponent(lastPostId)}`
    : `${base}/api/slot/next`;
  const res = await fetch(url, { headers });
  const data = await res.json();
  if (!res.ok) {
    console.error(new Date().toISOString(), data);
    return;
  }
  const post = data.post;
  if (!post) {
    console.log(new Date().toISOString(), "slot empty", data.binge_loop?.hint || "");
    return;
  }
  lastPostId = post.id;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      post_id: post.id,
      topic: post.topic,
      summary: post.summary?.slice(0, 120),
      fyp_score: data.fyp_score,
      streak: data.streak?.current_streak,
      binge: data.binge_loop?.next
    })
  );
}

console.error(`Polling slot every ${intervalSec}s — Ctrl+C to stop`);
await tick();
setInterval(tick, intervalSec * 1000);
