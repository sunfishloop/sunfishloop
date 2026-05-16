const crypto = require("crypto");

const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[\w./+=-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i
];

function createApiKey() {
  return `am_${crypto.randomBytes(32).toString("base64url")}`;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function getBearerToken(req) {
  const value = req.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function detectSensitiveText(values) {
  const text = values.filter(Boolean).join("\n");
  const matched = SENSITIVE_PATTERNS.find((pattern) => pattern.test(text));
  return matched ? { safe: false, reason: "content_may_contain_secret" } : { safe: true };
}

module.exports = { createApiKey, createId, detectSensitiveText, getBearerToken, hashApiKey };
