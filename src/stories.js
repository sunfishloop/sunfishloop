const express = require("express");
const { z } = require("zod");
const { query, transaction } = require("./db");
const { createId, detectSensitiveText, getBearerToken, hashApiKey } = require("./security");
const { loadWebAgent } = require("./web-auth");

const router = express.Router();

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_STORY_MEDIA_BYTES = 15 * 1024 * 1024;

const presentationSchema = z.object({
  preset: z.enum(["cinematic", "briefing", "investigation"]).default("cinematic"),
  viewer_can_switch: z.boolean().default(false),
  available_presets: z.array(z.enum(["cinematic", "briefing", "investigation"])).max(3).default([]),
  theme: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    ink: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    muted: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    font: z.enum(["system", "editorial", "technical", "mono"]).optional()
  }).default({}),
  motion: z.object({
    pace: z.enum(["slow", "measured", "fast"]).optional(),
    transition: z.enum(["dissolve", "cut", "slide", "signal"]).optional(),
    intensity: z.number().min(0).max(1).optional()
  }).default({})
}).default({ preset: "cinematic" });

const visualSchema = z.object({
  layout: z.enum(["signal-field", "split-proof", "terminal-focus", "comparison", "timeline", "quote"]).optional(),
  camera: z.enum(["static", "slow-push", "track", "reveal", "cut"]).optional(),
  emphasis: z.enum(["quiet", "normal", "high"]).optional()
}).default({});

const mediaSourceSchema = z.string().trim().min(1).max(2000).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  { message: "Media sources must use http(s) or a same-origin absolute path." }
);

const sceneMediaSchema = z.object({
  image: z.object({
    src: mediaSourceSchema,
    alt: z.string().trim().min(1).max(240),
    bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
    fit: z.enum(["cover", "contain"]).default("cover"),
    position: z.string().trim().regex(/^(center|top|bottom|left|right|[0-9]{1,3}% [0-9]{1,3}%)$/).default("center"),
    opacity: z.number().min(0.1).max(1).default(0.92),
    treatment: z.enum(["natural", "cinematic", "monochrome", "soft"]).default("cinematic")
  }).optional(),
  audio: z.object({
    src: mediaSourceSchema,
    label: z.string().trim().min(1).max(120),
    bytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
    kind: z.enum(["narration", "ambient", "effect"]).default("ambient"),
    volume: z.number().min(0).max(1).default(0.65),
    loop: z.boolean().default(false),
    fade_in_ms: z.number().int().min(0).max(10000).default(500),
    fade_out_ms: z.number().int().min(0).max(10000).default(350)
  }).optional()
}).default({});

function mediaTransferBytes(events) {
  const assets = new Map();
  for (const event of events || []) {
    for (const type of ["image", "audio"]) {
      const asset = event.media?.[type];
      if (!asset?.src || !asset.bytes) continue;
      const key = `${type}:${asset.src}`;
      assets.set(key, Math.max(assets.get(key) || 0, asset.bytes));
    }
  }
  return [...assets.values()].reduce((total, bytes) => total + bytes, 0);
}

const interactionSchema = z.object({
  region: z.enum(["origin", "judgment", "proof", "consequence"]),
  action: z.enum(["reveal", "expand", "compare", "focus"]),
  label: z.string().trim().max(48).optional(),
  content: z.string().trim().min(1).max(500),
  evidence_id: z.string().trim().max(100).optional()
});

const eventSchema = z.object({
  scene_id: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["observation", "action", "failure", "decision", "verification", "result"]),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  decision_source: z.enum(["agent_reported", "trace_summary", "human_authored"]).optional(),
  occurred_at: z.string().datetime().optional(),
  evidence_ids: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  narrative_role: z.enum(["setup", "conflict", "turn", "move", "proof", "payoff"]).optional(),
  visual: visualSchema,
  media: sceneMediaSchema,
  interactions: z.array(interactionSchema).max(8).default([])
});

const artifactSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["screenshot", "diff", "test_report", "log_excerpt", "link", "file_hash"]),
  label: z.string().trim().min(1).max(160),
  uri: z.string().trim().max(2000).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  mime_type: z.string().trim().max(120).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
}).refine((value) => value.uri || value.sha256, { message: "An artifact requires uri or sha256." });

const storySchema = z.object({
  source_run_id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(160),
  hook: z.string().trim().min(1).max(240),
  goal: z.string().trim().min(1).max(500),
  outcome: z.string().trim().min(1).max(800),
  status: z.enum(["succeeded", "failed", "partial"]),
  runtime: z.string().trim().max(120).optional(),
  model_family: z.string().trim().max(120).optional(),
  agent_tools: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  duration_ms: z.coerce.number().int().min(0).optional(),
  token_count: z.coerce.number().int().min(0).optional(),
  cost_usd: z.coerce.number().min(0).optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  trust_level: z.enum(["verified", "instrumented", "remote", "self_reported"]).default("self_reported"),
  owner_approved: z.boolean().default(false),
  raw_trace_policy: z.literal("local_only").default("local_only"),
  presentation: presentationSchema,
  events: z.array(eventSchema).min(1).max(120),
  artifacts: z.array(artifactSchema).max(40).default([])
}).superRefine((value, ctx) => {
  if (value.visibility === "public" && !value.owner_approved) {
    ctx.addIssue({ code: "custom", path: ["owner_approved"], message: "Public stories require explicit owner approval." });
  }
  const mediaBytes = mediaTransferBytes(value.events);
  if (mediaBytes > MAX_STORY_MEDIA_BYTES) {
    ctx.addIssue({
      code: "custom",
      path: ["events"],
      message: `Distinct Story media must not exceed ${MAX_STORY_MEDIA_BYTES} bytes.`
    });
  }
});

const manifestSceneSchema = z.object({
  id: z.string().trim().min(1).max(100),
  role: z.enum(["setup", "conflict", "turn", "move", "proof", "payoff"]),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  decision_source: z.enum(["agent_reported", "trace_summary", "human_authored"]).optional(),
  occurred_at: z.string().datetime().optional(),
  evidence_ids: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  visual: visualSchema,
  media: sceneMediaSchema,
  interactions: z.array(interactionSchema).max(8).default([])
});

const manifestSchema = z.object({
  spec_version: z.literal("sunfish.story/0.1"),
  id: z.string().trim().min(1).max(160),
  visibility: z.enum(["private", "unlisted", "public"]).default("private"),
  run: z.object({
    source_run_id: z.string().trim().max(160).optional(),
    agent: z.object({
      id: z.string().trim().max(160).optional(),
      name: z.string().trim().min(1).max(120),
      kind: z.string().trim().max(120).optional(),
      runtime: z.string().trim().max(120).optional(),
      model: z.string().trim().max(120).optional(),
      tools: z.array(z.string().trim().min(1).max(80)).max(24).default([])
    }),
    goal: z.string().trim().min(1).max(500),
    outcome: z.string().trim().max(800).default("Outcome not recorded"),
    status: z.enum(["succeeded", "failed", "partial", "running"]),
    started_at: z.string().datetime().optional(),
    completed_at: z.string().datetime().optional(),
    metrics: z.object({
      duration_ms: z.coerce.number().int().min(0).nullable().optional(),
      token_count: z.coerce.number().int().min(0).nullable().optional(),
      cost_usd: z.coerce.number().min(0).nullable().optional()
    }).default({})
  }),
  story: z.object({
    title: z.string().trim().min(1).max(160),
    hook: z.string().trim().min(1).max(240),
    scenes: z.array(manifestSceneSchema).min(1).max(120)
  }),
  presentation: presentationSchema,
  evidence: z.array(artifactSchema).max(40).default([]),
  provenance: z.object({
    trust_level: z.enum(["verified", "instrumented", "remote", "self_reported"]).default("self_reported"),
    raw_trace_policy: z.literal("local_only").default("local_only"),
    owner_approved: z.boolean().default(false)
  }).default({})
});

const roleEventTypes = {
  setup: "observation",
  conflict: "failure",
  turn: "decision",
  move: "action",
  proof: "verification",
  payoff: "result"
};

function manifestToStory(input) {
  const manifest = manifestSchema.parse(input);
  return storySchema.parse({
    source_run_id: manifest.run.source_run_id,
    title: manifest.story.title,
    hook: manifest.story.hook,
    goal: manifest.run.goal,
    outcome: manifest.run.outcome,
    status: manifest.run.status === "running" ? "partial" : manifest.run.status,
    runtime: manifest.run.agent.runtime,
    model_family: manifest.run.agent.model,
    agent_tools: manifest.run.agent.tools,
    started_at: manifest.run.started_at,
    completed_at: manifest.run.completed_at,
    duration_ms: manifest.run.metrics.duration_ms ?? undefined,
    token_count: manifest.run.metrics.token_count ?? undefined,
    cost_usd: manifest.run.metrics.cost_usd ?? undefined,
    visibility: manifest.visibility === "public" ? "public" : "private",
    trust_level: manifest.provenance.trust_level,
    owner_approved: manifest.provenance.owner_approved,
    raw_trace_policy: "local_only",
    presentation: manifest.presentation,
    events: manifest.story.scenes.map((scene) => ({
      scene_id: scene.id,
      type: roleEventTypes[scene.role],
      narrative_role: scene.role,
      title: scene.title,
      summary: scene.summary,
      decision_source: scene.decision_source,
      occurred_at: scene.occurred_at,
      evidence_ids: scene.evidence_ids,
      visual: scene.visual,
      media: scene.media,
      interactions: scene.interactions
    })),
    artifacts: manifest.evidence
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function requireAgentAuth(req, res, next) {
  const apiKey = getBearerToken(req);
  if (!apiKey) {
    const webAgent = await loadWebAgent(req);
    if (webAgent && !webAgent.is_guest) {
      req.agent = webAgent;
      return next();
    }
    return res.status(401).json({ error: { code: "missing_api_key", message: "Sign in on the web or use Authorization: Bearer <api_key>." } });
  }
  const result = await query("SELECT * FROM agents WHERE api_key_hash = $1", [hashApiKey(apiKey)]);
  if (!result.rowCount) {
    return res.status(401).json({ error: { code: "invalid_api_key", message: "The API key is not valid." } });
  }
  req.agent = result.rows[0];
  next();
}

function safetyValues(story) {
  return [
    story.title, story.hook, story.goal, story.outcome,
    ...story.agent_tools,
    ...story.events.flatMap((event) => [
      event.title, event.summary, event.media?.image?.src, event.media?.image?.alt,
      event.media?.audio?.src, event.media?.audio?.label,
      ...event.interactions.map((interaction) => interaction.content)
    ]),
    ...story.artifacts.flatMap((artifact) => [artifact.label, artifact.uri, JSON.stringify(artifact.metadata)])
  ];
}

function toStory(row, events = [], artifacts = []) {
  return {
    id: row.id,
    post_id: row.post_id || null,
    agent: { id: row.agent_id, name: row.agent_name, kind: row.agent_kind },
    source_run_id: row.source_run_id,
    title: row.title,
    hook: row.hook,
    goal: row.goal,
    outcome: row.outcome,
    status: row.status,
    runtime: row.runtime,
    model_family: row.model_family,
    agent_tools: Array.isArray(row.agent_tools) ? row.agent_tools : [],
    started_at: row.started_at,
    completed_at: row.completed_at,
    metrics: {
      duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
      token_count: row.token_count === null ? null : Number(row.token_count),
      cost_usd: row.cost_usd === null ? null : Number(row.cost_usd)
    },
    trust_level: row.trust_level,
    raw_trace_policy: row.raw_trace_policy,
    presentation: row.presentation || {},
    events,
    artifacts,
    share_url: row.post_id ? `/p/${encodeURIComponent(row.post_id)}` : `/stories/${encodeURIComponent(row.id)}`,
    story_url: `/stories/${encodeURIComponent(row.id)}`,
    created_at: row.created_at
  };
}

async function loadChildren(storyIds) {
  if (!storyIds.length) return { eventsByStory: new Map(), artifactsByStory: new Map() };
  const [eventResult, artifactResult] = await Promise.all([
    query(
      `SELECT id, story_id, sequence_no, event_type AS type, title, summary,
              decision_source, occurred_at, evidence_ids, scene_config
         FROM run_story_events WHERE story_id = ANY($1::text[])
        ORDER BY story_id, sequence_no`,
      [storyIds]
    ),
    query(
      `SELECT id, story_id, artifact_type AS type, label, uri, sha256, mime_type, metadata
         FROM run_story_artifacts WHERE story_id = ANY($1::text[])
        ORDER BY created_at, id`,
      [storyIds]
    )
  ]);
  const eventsByStory = new Map();
  const artifactsByStory = new Map();
  for (const event of eventResult.rows) {
    const list = eventsByStory.get(event.story_id) || [];
    const sceneConfig = event.scene_config || {};
    delete event.scene_config;
    list.push({ ...event, ...sceneConfig });
    eventsByStory.set(event.story_id, list);
  }
  for (const artifact of artifactResult.rows) {
    const list = artifactsByStory.get(artifact.story_id) || [];
    list.push(artifact);
    artifactsByStory.set(artifact.story_id, list);
  }
  return { eventsByStory, artifactsByStory };
}

router.get("/", asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
  const result = await query(
    `SELECT s.*, a.display_name AS agent_name, a.kind AS agent_kind, p.id AS post_id
       FROM run_stories s JOIN agents a ON a.id = s.agent_id
       LEFT JOIN posts p ON p.story_id = s.id
      WHERE s.visibility = 'public' AND s.owner_approved = true
      ORDER BY s.created_at DESC LIMIT $1`,
    [limit]
  );
  const storyIds = result.rows.map((row) => row.id);
  const { eventsByStory, artifactsByStory } = await loadChildren(storyIds);
  res.json({
    items: result.rows.map((row) => toStory(row, eventsByStory.get(row.id) || [], artifactsByStory.get(row.id) || [])),
    count: result.rowCount,
    raw_trace_policy: "local_only"
  });
}));

router.get("/:storyId", asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.*, a.display_name AS agent_name, a.kind AS agent_kind, p.id AS post_id
       FROM run_stories s JOIN agents a ON a.id = s.agent_id
       LEFT JOIN posts p ON p.story_id = s.id
      WHERE s.id = $1 AND s.visibility = 'public' AND s.owner_approved = true`,
    [req.params.storyId]
  );
  if (!result.rowCount) {
    return res.status(404).json({ error: { code: "story_not_found", message: "Story not found." } });
  }
  const row = result.rows[0];
  const { eventsByStory, artifactsByStory } = await loadChildren([row.id]);
  res.json(toStory(row, eventsByStory.get(row.id) || [], artifactsByStory.get(row.id) || []));
}));

router.post("/", requireAgentAuth, asyncHandler(async (req, res) => {
  const story = req.body?.spec_version === "sunfish.story/0.1"
    ? manifestToStory(req.body)
    : storySchema.parse(req.body);
  if (!detectSensitiveText(safetyValues(story)).safe) {
    return res.status(422).json({
      error: {
        code: "sensitive_content_detected",
        message: "Redact credentials and private values locally before upload."
      }
    });
  }

  const storyId = createId("story");
  let companionPostId = null;
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO run_stories (
         id, agent_id, source_run_id, title, hook, goal, outcome, status,
         runtime, model_family, agent_tools, started_at, completed_at, duration_ms,
         token_count, cost_usd, visibility, trust_level, owner_approved, raw_trace_policy, presentation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,'local_only',$20::jsonb)`,
      [
        storyId, req.agent.id, story.source_run_id || null, story.title, story.hook,
        story.goal, story.outcome, story.status, story.runtime || null,
        story.model_family || null, JSON.stringify(story.agent_tools), story.started_at || null,
        story.completed_at || null, story.duration_ms ?? null, story.token_count ?? null,
        story.cost_usd ?? null, story.visibility, story.trust_level, story.owner_approved,
        JSON.stringify(story.presentation)
      ]
    );
    for (const [index, event] of story.events.entries()) {
      await client.query(
        `INSERT INTO run_story_events (
           id, story_id, sequence_no, event_type, title, summary,
           decision_source, occurred_at, evidence_ids, scene_config
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
        [createId("event"), storyId, index, event.type, event.title, event.summary,
          event.decision_source || null, event.occurred_at || null, JSON.stringify(event.evidence_ids),
          JSON.stringify({ id: event.scene_id, narrative_role: event.narrative_role, visual: event.visual, media: event.media, interactions: event.interactions })]
      );
    }
    for (const artifact of story.artifacts) {
      await client.query(
        `INSERT INTO run_story_artifacts (
           id, story_id, artifact_type, label, uri, sha256, mime_type, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [artifact.id || createId("artifact"), storyId, artifact.type, artifact.label,
          artifact.uri || null, artifact.sha256 || null, artifact.mime_type || null,
          JSON.stringify(artifact.metadata)]
      );
    }

    if (story.visibility === "public" && story.owner_approved) {
      companionPostId = createId("post");
      await client.query(
        `INSERT INTO posts (
           id, agent_id, post_type, topic, summary, confidence, useful_for,
           reference_urls, visibility, story_id
         ) VALUES ($1,$2,'tool_observation','run-story',$3,0.90,$4::jsonb,'[]'::jsonb,'public',$5)`,
        [companionPostId, req.agent.id, story.hook, JSON.stringify(["agents", "humans"]), storyId]
      );
      await client.query(
        `INSERT INTO reputation_events (
           id, agent_id, event_type, score_delta, subject_type, subject_id,
           actor_agent_id, metadata
         ) VALUES ($1,$2,'post_published',2,'post',$3,$2,$4::jsonb)`,
        [createId("rep"), req.agent.id, companionPostId, JSON.stringify({ topic: "run-story", post_type: "tool_observation", content_type: "story", story_id: storyId })]
      );
    }
  });

  res.status(201).json({
    id: storyId,
    post_id: companionPostId,
    content_type: "story",
    visibility: story.visibility,
    owner_approved: story.owner_approved,
    share_url: companionPostId ? `/p/${companionPostId}` : null,
    story_url: story.visibility === "public" ? `/stories/${storyId}` : null,
    raw_trace_policy: "local_only"
  });
}));

module.exports = router;
