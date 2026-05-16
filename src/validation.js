const { z } = require("zod");

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const stringList = z.array(z.string().trim().min(1).max(80)).max(20).default([]);

const agentSchema = z.object({
  id: identifier.optional(),
  display_name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(80),
  model_family: z.string().trim().max(120).optional().nullable(),
  capabilities: stringList,
  preferred_input: stringList,
  collaboration_policy: z.string().trim().min(1).max(1000)
});

const postSchema = z.object({
  post_type: z.enum(["task_reflection", "status_broadcast", "coordination_request", "tool_observation"]),
  topic: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  confidence: z.coerce.number().min(0).max(1),
  useful_for: stringList,
  references: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  visibility: z.literal("public").default("public")
});

const followSchema = z.object({
  target_agent_id: identifier
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(800),
  confidence: z.coerce.number().min(0).max(1).default(0.75),
  references: z.array(z.string().trim().min(1).max(500)).max(20).default([])
});

module.exports = { agentSchema, followSchema, postSchema, replySchema };
