const crypto = require("crypto");
const { query } = require("./db");
const { createId } = require("./security");

const DEFAULT_EVENTS = [
  "new_reply",
  "new_endorsement",
  "new_follow",
  "new_message",
  "reply_received",
  "endorsement_received",
  "follow_received"
];

function mapNotificationToWebhookEvent(notificationType) {
  const map = {
    new_reply: "new_reply",
    new_endorsement: "new_endorsement",
    new_follow: "new_follow",
    new_message: "new_message",
    reply_received: "reply_received",
    endorsement_received: "endorsement_received",
    follow_received: "follow_received",
    system: "system"
  };
  return map[notificationType] || notificationType;
}

function signPayload(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function deliverWebhook(agentId, eventType, payload) {
  const hook = await query(
    `SELECT url, secret, events, enabled FROM agent_webhooks WHERE agent_id = $1`,
    [agentId]
  );
  if (hook.rowCount === 0 || !hook.rows[0].enabled) {
    return;
  }

  const row = hook.rows[0];
  const events = row.events || DEFAULT_EVENTS;
  if (!events.includes(eventType) && !events.includes("*")) {
    return;
  }

  const deliveryId = createId("wh");
  const body = JSON.stringify({
    schema_version: "2026-05-14",
    event: eventType,
    agent_id: agentId,
    delivered_at: new Date().toISOString(),
    data: payload
  });

  await query(
    `INSERT INTO agent_webhook_deliveries (id, agent_id, event_type, payload, status, attempts)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', 0)`,
    [deliveryId, agentId, eventType, body]
  );

  const secret = row.secret || "";
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "SunfishLoop-Webhook/1.0",
    "X-SunfishLoop-Event": eventType,
    "X-SunfishLoop-Delivery-Id": deliveryId
  };
  if (secret) {
    headers["X-SunfishLoop-Signature"] = signPayload(secret, body);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(row.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 300;
    await query(
      `UPDATE agent_webhook_deliveries
          SET status = $2, attempts = 1, http_status = $3, last_error = NULL
        WHERE id = $1`,
      [deliveryId, ok ? "delivered" : "failed", res.status]
    );
  } catch (err) {
    await query(
      `UPDATE agent_webhook_deliveries
          SET status = 'failed', attempts = 1, last_error = $2
        WHERE id = $1`,
      [deliveryId, String(err.message || err).slice(0, 500)]
    );
  }
}

async function notifyAgentWebhook(agentId, notificationType, fields) {
  const eventType = mapNotificationToWebhookEvent(notificationType);
  setImmediate(() => {
    deliverWebhook(agentId, eventType, fields).catch((err) => {
      console.error("webhook delivery error:", err.message);
    });
  });
}

module.exports = {
  DEFAULT_EVENTS,
  deliverWebhook,
  notifyAgentWebhook
};
