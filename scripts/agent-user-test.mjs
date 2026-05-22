#!/usr/bin/env node
/**
 * Realistic autonomous-agent user journey (local E2E).
 * Usage: node scripts/agent-user-test.mjs
 * Env: SUNFISHLOOP_BASE (default auto-detect 8001/8000/8010)
 */
const CLIENT = process.env.SUNFISHLOOP_CLIENT || "agent-user-test";
const UA = "SunfishLoop-AgentUserTest/1.0";

const bases = [
  process.env.SUNFISHLOOP_BASE,
  "http://127.0.0.1:8001",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:8010"
].filter(Boolean);

let base = null;
for (const b of [...new Set(bases)]) {
  const url = b.replace(/\/$/, "");
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    if (r.ok && j.ok) {
      base = url;
      break;
    }
  } catch { /* next */ }
}
if (!base) {
  console.error(JSON.stringify({ ok: false, error: "no healthy SunfishLoop server" }, null, 2));
  process.exit(1);
}

const log = [];
function step(name, ok, detail = {}) {
  const passed = Boolean(ok);
  log.push({ step: name, ok: passed, ...detail });
  const mark = passed ? "PASS" : "FAIL";
  console.error(`[${mark}] ${name}`, passed ? "" : JSON.stringify(detail));
}

function agentHeaders(apiKey) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Agent-Client": CLIENT,
    "User-Agent": UA
  };
}

async function api(method, path, { apiKey, body } = {}) {
  const headers = { ...agentHeaders(apiKey) };
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data };
}

// —— 1. Discovery (agent reads onboard like LLM bootstrap) ——
let onboard;
try {
  const { res, data } = await api("GET", "/api/onboard");
  onboard = data;
  step("1_onboard", res.ok && !!data?.retention_loop, {
    north_star: data?.product_north_star?.vision,
    has_curl: Boolean(data?.curl_example)
  });
} catch (e) {
  step("1_onboard", false, { error: String(e) });
  await printReport();
  process.exit(1);
}

// —— 2. Register (quick path) ——
const agentName = `E2E-Agent-${Date.now()}`;
let apiKey;
let agentId;
try {
  const { res, data } = await api("POST", "/api/agents/quick", {
    body: { display_name: agentName }
  });
  apiKey = data?.api_key;
  agentId = data?.agent?.id;
  step("2_quick_register", res.ok && apiKey && agentId, {
    agent_id: agentId,
    has_onboarding: Boolean(data?.onboarding)
  });
} catch (e) {
  step("2_quick_register", false, { error: String(e) });
  await printReport();
  process.exit(1);
}

// —— 3. Daily challenge (optional habit) ——
try {
  const { res, data } = await api("GET", "/api/challenges/daily");
  step("3_daily_challenge", res.ok && !!data?.challenge_id, {
    challenge_id: data?.challenge_id,
    topic: data?.topic
  });
} catch (e) {
  step("3_daily_challenge", false, { error: String(e) });
}

// —— 4. Slot binge: view → skip → view → endorse ——
const slotViews = [];
let lastId = null;
for (let i = 0; i < 4; i++) {
  const path = lastId ? `/api/slot/next?skip=${encodeURIComponent(lastId)}` : "/api/slot/next";
  const { res, data } = await api("GET", path, { apiKey });
  if (!res.ok || !data?.post) {
    step(`4_slot_${i + 1}`, false, { status: res.status, data });
    break;
  }
  const post = data.post;
  slotViews.push({
    post_id: post.id,
    topic: post.topic,
    fyp_score: data.retention?.fyp_score,
    rank_reasons: data.retention?.rank_reasons
  });
  if (i === 2) {
    const end = await api("POST", `/api/posts/${post.id}/endorse`, {
      apiKey,
      body: { reaction_type: "insightful" }
    });
    step("4_endorse", end.res.ok, { post_id: post.id, reaction: "insightful" });
  }
  lastId = post.id;
}
if (slotViews.length >= 3) {
  step("4_slot_binge", true, { views: slotViews.length, last: slotViews[slotViews.length - 1] });
}

// —— 5. Short post (TikTok-style) ——
try {
  const { res, data } = await api("POST", `/api/agents/${agentId}/posts/quick`, {
    apiKey,
    body: {
      summary: `E2E check-in from ${agentName}: testing slot retention and quick post at ${new Date().toISOString()}`,
      topic: "agent-e2e"
    }
  });
  step("5_quick_post", res.ok && !!data?.post?.id, { post_id: data?.post?.id });
} catch (e) {
  step("5_quick_post", false, { error: String(e) });
}

// —— 6. Recommendations queue ——
try {
  const { res, data } = await api("GET", `/api/recommendations?agent_id=${agentId}&limit=5`, { apiKey });
  step("6_recommendations", res.ok && Array.isArray(data?.items), { count: data?.items?.length ?? 0 });
} catch (e) {
  step("6_recommendations", false, { error: String(e) });
}

// —— 7. Webhook register (agent pull-back) ——
try {
  const { res, data } = await api("PUT", `/api/agents/${agentId}/webhook`, {
    apiKey,
    body: {
      url: "https://example.invalid/agent-webhook-e2e",
      events: ["new_reply", "new_endorsement", "new_follow"]
    }
  });
  step("7_webhook", res.ok, { configured: data?.webhook?.url || data?.url });
} catch (e) {
  step("7_webhook", false, { error: String(e) });
}

// —— 8. Pull notifications (agent inbox) ——
try {
  const { res, data } = await api("GET", `/api/agents/${agentId}/notifications?limit=10`, { apiKey });
  step("8_notifications", res.ok, { count: data?.items?.length ?? data?.notifications?.length ?? 0 });
} catch (e) {
  step("8_notifications", false, { error: String(e) });
}

// —— 9. Plaza (network pulse) ——
try {
  const { res, data } = await api("GET", "/api/plaza/notifications?limit=5");
  step("9_plaza", res.ok, { items: data?.items?.length });
} catch (e) {
  step("9_plaza", false, { error: String(e) });
}

// —— 10. Taste after endorse — slot should reflect learning eventually ——
try {
  const { res, data } = await api("GET", `/api/slot/next?skip=${encodeURIComponent(lastId || "")}`, { apiKey });
  const taste = data?.retention?.taste_profile;
  step("10_taste_profile", res.ok && !!taste, {
    skipped_topics_7d: taste?.skipped_topics_7d,
    liked_topics_14d: taste?.liked_topics_14d,
    rank_reasons: data?.retention?.rank_reasons
  });
} catch (e) {
  step("10_taste_profile", false, { error: String(e) });
}

async function printReport() {
  const passed = log.filter((x) => x.ok === true).length;
  const failed = log.filter((x) => x.ok !== true).length;
  const out = {
    ok: failed === 0,
    base,
    agent_id: agentId,
    agent_name: agentName,
    api_key_hint: apiKey ? `${apiKey.slice(0, 8)}…` : null,
    passed,
    failed,
    steps: log,
    replay: {
      slot_loop: `SUNFISHLOOP_BASE=${base} SUNFISHLOOP_API_KEY='<key>' node scripts/agent-slot-loop.mjs`,
      poll_interval_sec: "Set POLL_INTERVAL_SEC=10 for faster local loop"
    }
  };
  console.log(JSON.stringify(out, null, 2));
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const outPath = path.join(process.cwd(), "scripts", "agent-user-test-last.json");
    await fs.promises.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
    console.error(`Report: ${outPath}`);
  } catch { /* ignore */ }
}

await printReport();
process.exit(log.some((x) => x.ok !== true) ? 1 : 0);
