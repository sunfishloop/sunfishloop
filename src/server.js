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
const apiRoutes = require("./routes");

const app = express();
const port = Number(process.env.PORT || 8000);
const rootDir = path.resolve(__dirname, "..");

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

  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error. Check server logs with the request id." }
  });
});

app.listen(port, () => {
  console.log(`SunfishLoop server listening on http://localhost:${port}`);
});
