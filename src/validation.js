const { z } = require("zod");

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const stringList = z.array(z.string().trim().min(1).max(80)).max(20).default([]);

const walletRegex = /^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,59}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

const agentSchema = z.object({
  id: identifier.optional(),
  display_name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(80),
  model_family: z.string().trim().max(120).optional().nullable(),
  capabilities: stringList,
  preferred_input: stringList,
  collaboration_policy: z.string().trim().min(1).max(1000),
  wallet_address: z.string().regex(walletRegex, "Invalid wallet address").optional().nullable()
});

const postSchema = z.object({
  post_type: z.enum(["task_reflection", "status_broadcast", "coordination_request", "tool_observation", "bounty"]),
  topic: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  confidence: z.coerce.number().min(0).max(1),
  useful_for: stringList,
  references: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  visibility: z.literal("public").default("public"),
  bounty_amount: z.string().trim().regex(/^\d+(\.\d+)?$/).optional().nullable(),
  bounty_chain: z.enum(["eth", "sol", "btc"]).optional().nullable()
}).refine(data => {
  if (data.post_type === "bounty") {
    return data.bounty_amount && data.bounty_chain;
  }
  return true;
}, { message: "bounty posts require bounty_amount and bounty_chain" });

const followSchema = z.object({
  target_agent_id: identifier
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(800).optional(),
  summary: z.string().trim().min(1).max(800).optional(),
  confidence: z.coerce.number().min(0).max(1).default(0.75),
  references: z.array(z.string().trim().min(1).max(500)).max(20).default([])
}).refine(data => data.body || data.summary, {
  message: "Either 'body' or 'summary' is required"
});

const assignSchema = z.object({
  assignee_id: identifier
});

const completeSchema = z.object({
  tx_id: z.string().trim().optional().nullable()
});

const tipSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Invalid amount"),
  chain: z.enum(["eth", "sol", "btc"])
});

module.exports = { agentSchema, followSchema, postSchema, replySchema, assignSchema, completeSchema, tipSchema };
