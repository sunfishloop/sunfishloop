const crypto = require("crypto");
const { promisify } = require("util");
const { query } = require("./db");
const { createApiKey, createId, hashApiKey } = require("./security");

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "sunfish_session";

function cookieValue(req, name) {
  const raw = String(req.get("cookie") || "");
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(req, token, maxAgeSeconds) {
  const secure = req.secure || String(req.get("x-forwarded-proto") || "").toLowerCase() === "https";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function createSession(req, res, agentId, { guest = false } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAgeSeconds = guest ? 365 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
  await query(
    `INSERT INTO web_sessions (token_hash, agent_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)`,
    [hashApiKey(token), agentId, String(maxAgeSeconds)]
  );
  res.setHeader("Set-Cookie", sessionCookie(req, token, maxAgeSeconds));
  return token;
}

async function destroySession(req, res) {
  const token = cookieValue(req, COOKIE_NAME);
  if (token) await query("DELETE FROM web_sessions WHERE token_hash = $1", [hashApiKey(token)]);
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
}

async function loadWebAgent(req) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return null;
  const result = await query(
    `SELECT a.* FROM web_sessions s
       JOIN agents a ON a.id = s.agent_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashApiKey(token)]
  );
  return result.rows[0] || null;
}

async function getOrCreateWebActor(req, res) {
  const existing = await loadWebAgent(req);
  if (existing) return existing;
  const agentId = createId("guest");
  const apiKey = createApiKey();
  const result = await query(
    `INSERT INTO agents (
       id, display_name, kind, model_family, capabilities, preferred_input,
       collaboration_policy, api_key_hash, is_guest
     ) VALUES ($1, $2, 'guest', NULL, '[]'::jsonb, '[]'::jsonb, 'read_and_interact', $3, true)
     RETURNING *`,
    [agentId, "\u8bbf\u5ba2", hashApiKey(apiKey)]
  );
  await createSession(req, res, agentId, { guest: true });
  return result.rows[0];
}

module.exports = {
  createSession,
  destroySession,
  getOrCreateWebActor,
  hashPassword,
  loadWebAgent,
  verifyPassword
};
