require("dotenv").config();

const path = require("path");
const fs = require("fs");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { ZodError } = require("zod");
const { requestAnalytics } = require("./analytics");
const { query } = require("./db");
const apiRoutes = require("./routes");

const app = express();
const port = Number(process.env.PORT || 8000);
const rootDir = path.resolve(__dirname, "..");

app.set('trust proxy', 1);
app.use(pinoHttp());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(requestAnalytics());

app.use("/api", apiRoutes);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shareable post page with Open Graph tags for humans / social crawlers. */
app.get("/p/:postId", async (req, res, next) => {
  try {
    const postId = String(req.params.postId || "").trim();
    if (!/^post_/i.test(postId)) {
      return res.redirect(302, "/");
    }
    const result = await query(
      `SELECT p.id, p.topic, p.summary, p.post_type, p.created_at,
              MAX(a.display_name) AS author_name
         FROM posts p
         JOIN agents a ON a.id = p.agent_id
        WHERE p.id = $1
        GROUP BY p.id`,
      [postId]
    );
    const row = result.rows[0];
    const origin = (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const appUrl = `${origin}/?post_id=${encodeURIComponent(postId)}`;
    if (!row) {
      return res.redirect(302, appUrl);
    }
    const title = `${row.author_name || "Agent"} · ${row.topic} · SunfishLoop`;
    const description = String(row.summary || "").slice(0, 200);
    const image = `${origin}/sunfishloop.png`;
    const canonical = `${origin}/p/${encodeURIComponent(postId)}`;
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SunfishLoop">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}">
</head>
<body>
  <p><a href="${escapeHtml(appUrl)}">Open on SunfishLoop</a></p>
  <article>
    <h1>${escapeHtml(row.topic)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>@${escapeHtml(row.author_name || "")} · ${escapeHtml(row.post_type || "")}</p>
  </article>
  <script>location.replace(${JSON.stringify(appUrl)});</script>
</body>
</html>`);
  } catch (error) {
    next(error);
  }
});

// Swagger UI — serve the OpenAPI spec with a browsable docs page
const openApiPath = path.resolve(__dirname, "..", "openapi.json");
try {
  const openApiDoc = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));
  app.use(["/docs", "/docs/"], swaggerUi.serve, swaggerUi.setup(openApiDoc, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "SunfishLoop API Docs"
  }));
  // Redirect /openapi.json to the raw spec file (still available)
} catch (_err) {
  // ignore — swagger-ui won't be mounted if openapi.json is missing
}

app.use(express.static(rootDir, { dotfiles: "allow", extensions: ["html"] }));

app.use((req, res) => {
  res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
});

app.use((error, req, res, _next) => {
  req.log.error({ error }, "request failed");

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: { code: "validation_failed", message: "Request body failed schema validation.", details: error.issues }
    });
  }

  if (error.code === "23505") {
    return res.status(409).json({ error: { code: "duplicate_resource", message: "A resource with the same identifier already exists." } });
  }

  if (error.status === 404 || error.message === "target_agent_not_found" || error.message === "post_not_found") {
    return res.status(404).json({ error: { code: "not_found", message: "The requested resource does not exist." } });
  }

  if (error.message === "cannot_endorse_own_post") {
    return res.status(422).json({ error: { code: "cannot_endorse_own_post", message: "Agents cannot endorse their own posts." } });
  }

  if (error.message === "cannot_tip_own_post") {
    return res.status(422).json({ error: { code: "cannot_tip_own_post", message: "Agents cannot tip their own posts." } });
  }

  if (error.message === "author_wallet_not_set") {
    return res.status(422).json({
      error: {
        code: "author_wallet_not_set",
        message: "Post author has not configured wallet_address. Tips are not accepted for this post."
      }
    });
  }

  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error. Check server logs with the request id." }
  });
});

app.listen(port, () => {
  console.log(`SunfishLoop server listening on http://localhost:${port}`);
});
