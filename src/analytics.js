const crypto = require("crypto");
const { query } = require("./db");

const AGENT_PATTERN = /(agent|bot|mcp|langchain|langgraph|autogen|crewai|cursor|claude|openai|anthropic|sunfishloop)/i;
const STATIC_ASSET_PATTERN = /\.(css|js|map|png|jpg|jpeg|gif|webp|ico|svg|woff2?)$/i;
const SENSITIVE_QUERY_KEYS = new Set(["api_key", "apikey", "token", "access_token", "authorization", "password"]);

function requestAnalytics() {
  return (req, res, next) => {
    if (process.env.ANALYTICS_ENABLED === "false" || shouldSkip(req)) {
      return next();
    }

    const startedAt = process.hrtime.bigint();
    const requestPath = originalPath(req);

    res.on("finish", () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const event = buildEvent(req, res, durationMs, requestPath);

      query(
        `INSERT INTO request_events (
          request_id, method, path, route_family, query, status_code, duration_ms,
          user_agent, agent_client, accept_header, referer, ip_hash, is_agent_like
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          event.request_id,
          event.method,
          event.path,
          event.route_family,
          JSON.stringify(event.query),
          event.status_code,
          event.duration_ms,
          event.user_agent,
          event.agent_client,
          event.accept_header,
          event.referer,
          event.ip_hash,
          event.is_agent_like
        ]
      ).catch((error) => {
        req.log?.warn({ error: error.message }, "request analytics write failed");
      });
    });

    next();
  };
}

function shouldSkip(req) {
  const path = originalPath(req);

  if (path === "/api/health" || path === "/api/meta" || path === "/favicon.ico") {
    return true;
  }

  return process.env.ANALYTICS_EXCLUDE_ASSETS !== "false" && STATIC_ASSET_PATTERN.test(path);
}

function buildEvent(req, res, durationMs, requestPath) {
  const userAgent = truncate(req.get("user-agent"), 500);
  const agentClient = truncate(req.get("x-agent-client"), 200);

  return {
    request_id: req.id ? String(req.id) : null,
    method: req.method,
    path: requestPath,
    route_family: routeFamily(requestPath),
    query: sanitizeQuery(req.query),
    status_code: res.statusCode,
    duration_ms: durationMs,
    user_agent: userAgent,
    agent_client: agentClient,
    accept_header: truncate(req.get("accept"), 300),
    referer: truncate(req.get("referer"), 500),
    ip_hash: hashIp(req.ip),
    is_agent_like: AGENT_PATTERN.test(`${userAgent || ""} ${agentClient || ""}`)
  };
}

function originalPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0] || "/";
}

function routeFamily(path) {
  if (path.startsWith("/api/agents")) return "agents";
  if (path.startsWith("/api/feed")) return "feed";
  if (path.startsWith("/api/meta")) return "meta";
  if (path.startsWith("/api/digest")) return "digest";
  if (path.startsWith("/api/recommendations")) return "recommendations";
  if (path.startsWith("/api/slot")) return "slot";
  if (path.startsWith("/api/for-you")) return "for_you";
  if (path.startsWith("/api/trending")) return "trending";
  if (path.startsWith("/api/stream")) return "stream";
  if (path.startsWith("/api/posts")) return "posts";
  if (path.startsWith("/.well-known")) return "well-known";
  if (path === "/" || path === "/index.html") return "homepage";
  return path.startsWith("/api") ? "api_other" : "static";
}

function sanitizeQuery(source) {
  const clean = {};

  for (const [key, value] of Object.entries(source || {})) {
    const safeKey = sanitizeKey(key);
    const normalizedKey = safeKey.toLowerCase();
    clean[safeKey] = SENSITIVE_QUERY_KEYS.has(normalizedKey) ? "[redacted]" : sanitizeAnalyticsValue(value);
  }

  return clean;
}

function sanitizeAnalyticsValue(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncate(stripUnsafeJsonChars(value), 500);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAnalyticsValue(item, depth + 1));
  }

  if (typeof value === "object" && depth < 3) {
    const clean = {};
    for (const [key, nested] of Object.entries(value).slice(0, 50)) {
      clean[sanitizeKey(key)] = sanitizeAnalyticsValue(nested, depth + 1);
    }
    return clean;
  }

  return truncate(stripUnsafeJsonChars(String(value)), 500);
}

function sanitizeKey(key) {
  const safe = stripUnsafeJsonChars(String(key)).slice(0, 120);
  return safe || "_";
}

function stripUnsafeJsonChars(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "");
}

function hashIp(ip) {
  if (!ip) {
    return null;
  }

  const salt = process.env.ANALYTICS_IP_SALT || "sunfishloop-request-analytics";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function truncate(value, maxLength) {
  if (!value) {
    return null;
  }

  return String(value).slice(0, maxLength);
}

module.exports = { requestAnalytics };
