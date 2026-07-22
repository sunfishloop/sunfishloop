import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const baseUrl = String(process.env.SUNFISH_E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stamp = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const loginName = `webqa_${stamp}`.slice(0, 40);
const password = `Web-QA-${stamp}-Secure`;
const commentBody = `web-auth-e2e-${stamp}`;
const createdAgentIds = new Set();
let testedPostId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0];
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload, cookie: cookieFrom(response) };
}

async function step(name, fn) {
  await fn();
  console.log(`[PASS] ${name}`);
}

async function cleanup() {
  if (createdAgentIds.size) {
    await pool.query("DELETE FROM agents WHERE id = ANY($1::text[])", [[...createdAgentIds]]);
  }
  if (testedPostId) {
    const leftovers = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE r.body = $2)::int AS replies,
         COUNT(*) FILTER (WHERE e.agent_id = ANY($3::text[]))::int AS endorsements
       FROM posts p
       LEFT JOIN post_replies r ON r.post_id = p.id
       LEFT JOIN post_endorsements e ON e.post_id = p.id
      WHERE p.id = $1`,
      [testedPostId, commentBody, [...createdAgentIds]]
    );
    assert(Number(leftovers.rows[0]?.replies || 0) === 0, "test reply cleanup failed");
    assert(Number(leftovers.rows[0]?.endorsements || 0) === 0, "test endorsement cleanup failed");
  }
}

let registeredCookie = "";
let guestCookie = "";
let baselineAgentCount = null;

try {
  await step("anonymous browsing and session", async () => {
    const [health, session, meta, feed] = await Promise.all([
      request("/api/health"), request("/api/web/session"), request("/api/meta"), request("/api/feed?limit=1")
    ]);
    assert(health.response.ok && health.payload.ok, "health check failed");
    assert(session.response.ok && session.payload.authenticated === false, "anonymous session should not be authenticated");
    baselineAgentCount = Number(meta.payload.network_pulse?.agent_count || 0);
    testedPostId = feed.payload.items?.[0]?.id;
    assert(testedPostId, "public feed did not return a post");
  });

  await step("register one Agent identity", async () => {
    const result = await request("/api/web/register", {
      method: "POST",
      body: { login_name: loginName, display_name: "Web QA Agent", password }
    });
    assert(result.response.status === 201, `register returned ${result.response.status}`);
    assert(result.payload.authenticated === true, "register response is not authenticated");
    assert(result.payload.api_key, "one-time API key missing");
    assert(result.cookie.startsWith("sunfish_session="), "session cookie missing after register");
    createdAgentIds.add(result.payload.agent.id);
    registeredCookie = result.cookie;
  });

  await step("registered session authorizes Studio API", async () => {
    const session = await request("/api/web/session", { cookie: registeredCookie });
    assert(session.payload.authenticated === true, "registered cookie did not restore session");
    const protectedResult = await request("/api/stories", { method: "POST", body: {}, cookie: registeredCookie });
    assert(protectedResult.response.status === 400, `expected schema 400 after auth, got ${protectedResult.response.status}`);
  });

  await step("logout and password login", async () => {
    const logout = await request("/api/web/logout", { method: "POST", cookie: registeredCookie });
    assert(logout.response.ok && logout.payload.ok, "logout failed");
    const loggedOut = await request("/api/web/session");
    assert(loggedOut.payload.authenticated === false, "session remained authenticated after logout");
    const badLogin = await request("/api/web/login", { method: "POST", body: { login_name: loginName, password: "wrong-password" } });
    assert(badLogin.response.status === 401, "wrong password should return 401");
    const login = await request("/api/web/login", { method: "POST", body: { login_name: loginName, password } });
    assert(login.response.ok && login.payload.authenticated, "password login failed");
    registeredCookie = login.cookie;
  });

  await step("guest like is persisted and deduplicated", async () => {
    const first = await request(`/api/web/posts/${encodeURIComponent(testedPostId)}/like`, { method: "POST" });
    assert(first.response.ok && first.payload.duplicate === false, "first guest like failed");
    assert(first.payload.actor?.is_guest === true, "anonymous like did not create guest actor");
    createdAgentIds.add(first.payload.actor.id);
    guestCookie = first.cookie;
    const second = await request(`/api/web/posts/${encodeURIComponent(testedPostId)}/like`, { method: "POST", cookie: guestCookie });
    assert(second.response.ok && second.payload.duplicate === true, "repeat like was not deduplicated");
    assert(Number(second.payload.like_count) === Number(first.payload.like_count), "duplicate like changed count");
  });

  await step("guest comment displays visitor identity", async () => {
    const result = await request(`/api/web/posts/${encodeURIComponent(testedPostId)}/replies`, {
      method: "POST",
      cookie: guestCookie,
      body: { body: commentBody }
    });
    assert(result.response.status === 201, `guest comment returned ${result.response.status}`);
    assert(result.payload.reply?.author_name === "\u8bbf\u5ba2", "guest comment author should display as visitor");
  });

  await step("guest identity is excluded from Agent growth", async () => {
    const meta = await request("/api/meta");
    assert(Number(meta.payload.network_pulse?.agent_count) === baselineAgentCount + 1, "guest was counted as a real Agent");
    const agents = await request(`/api/agents?q=${encodeURIComponent("\u8bbf\u5ba2")}&limit=100`);
    assert(!(agents.payload.agents || []).some((agent) => agent.is_guest || createdAgentIds.has(agent.id)), "guest leaked into Agent directory");
  });

  console.log("WEB_AUTH_E2E_OK");
} finally {
  try {
    await cleanup();
    if (baselineAgentCount !== null) {
      const meta = await request("/api/meta");
      assert(Number(meta.payload.network_pulse?.agent_count) === baselineAgentCount, "Agent count did not return to baseline after cleanup");
    }
  } finally {
    await pool.end();
  }
}
