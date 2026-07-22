#!/usr/bin/env node
import { createServer } from "node:http";
import { copyFile, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [command, file = "story.json"] = process.argv.slice(2);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_STORY_MEDIA_BYTES = 15 * 1024 * 1024;

function usage() {
  console.log("sunfish story commands: init [file], validate <file>, preview [file], publish <file>");
}

async function loadManifest(name) {
  return JSON.parse(await readFile(resolve(process.cwd(), name), "utf8"));
}

function validate(manifest) {
  const problems = [];
  const need = (object, keys, path) => keys.forEach((key) => {
    if (!object || object[key] === undefined || object[key] === "") problems.push(`${path}/${key}: required`);
  });
  need(manifest, ["spec_version", "id", "run", "story", "presentation"], "");
  if (manifest.spec_version !== "sunfish.story/0.1") problems.push("/spec_version: expected sunfish.story/0.1");
  need(manifest.run, ["agent", "goal", "status"], "/run");
  need(manifest.run?.agent, ["name"], "/run/agent");
  need(manifest.story, ["title", "hook", "scenes"], "/story");
  if (!Array.isArray(manifest.story?.scenes) || !manifest.story.scenes.length) problems.push("/story/scenes: add at least one scene");
  const validMediaSource = (value) => typeof value === "string" && (value.startsWith("/") || /^https?:\/\//i.test(value));
  const mediaAssets = new Map();
  (manifest.story?.scenes || []).forEach((scene, index) => {
    const path = `/story/scenes/${index}`;
    need(scene, ["id", "role", "title", "summary"], path);
    if (scene.media?.image) {
      need(scene.media.image, ["src", "alt", "bytes"], `${path}/media/image`);
      if (!validMediaSource(scene.media.image.src)) problems.push(`${path}/media/image/src: use http(s) or a path beginning with /`);
      if (!Number.isInteger(scene.media.image.bytes) || scene.media.image.bytes < 1 || scene.media.image.bytes > MAX_IMAGE_BYTES) problems.push(`${path}/media/image/bytes: image must be 1 byte to 2 MB`);
      if (scene.media.image.src && Number.isInteger(scene.media.image.bytes)) mediaAssets.set(`image:${scene.media.image.src}`, Math.max(mediaAssets.get(`image:${scene.media.image.src}`) || 0, scene.media.image.bytes));
    }
    if (scene.media?.audio) {
      need(scene.media.audio, ["src", "label", "bytes"], `${path}/media/audio`);
      if (!validMediaSource(scene.media.audio.src)) problems.push(`${path}/media/audio/src: use http(s) or a path beginning with /`);
      if (!Number.isInteger(scene.media.audio.bytes) || scene.media.audio.bytes < 1 || scene.media.audio.bytes > MAX_AUDIO_BYTES) problems.push(`${path}/media/audio/bytes: audio must be 1 byte to 5 MB`);
      if (scene.media.audio.src && Number.isInteger(scene.media.audio.bytes)) mediaAssets.set(`audio:${scene.media.audio.src}`, Math.max(mediaAssets.get(`audio:${scene.media.audio.src}`) || 0, scene.media.audio.bytes));
    }
  });
  const mediaBytes = [...mediaAssets.values()].reduce((total, bytes) => total + bytes, 0);
  if (mediaBytes > MAX_STORY_MEDIA_BYTES) problems.push(`/story/scenes: distinct media exceeds the 15 MB publish limit`);
  need(manifest.presentation, ["preset"], "/presentation");
  return problems;
}

async function init() {
  const target = resolve(process.cwd(), file);
  await copyFile(resolve(root, "examples", "story-manifest-v0.1.json"), target);
  console.log(`Created ${target}`);
}

async function check() {
  const manifest = await loadManifest(file);
  const problems = validate(manifest);
  if (problems.length) {
    problems.forEach((problem) => console.error(problem));
    process.exitCode = 1;
    return false;
  }
  console.log(`${file}: valid sunfish.story/0.1 manifest`);
  return true;
}

async function preview() {
  if (!(await check())) return;
  const manifest = await loadManifest(file);
  const port = Number(process.env.PORT || 4176);
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
  const server = createServer(async (req, res) => {
    try {
      let path = new URL(req.url, "http://localhost").pathname;
      if (path === "/examples/story-manifest-v0.1.json") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(manifest));
        return;
      }
      if (path === "/" || path === "/stories") path = "/stories.html";
      if (path === "/studio") path = "/story-studio.html";
      const diskPath = resolve(root, `.${path}`);
      if (!diskPath.startsWith(root)) throw new Error("invalid path");
      const body = await readFile(diskPath);
      res.setHeader("Content-Type", mime[extname(diskPath)] || "application/octet-stream");
      res.end(body);
    } catch (_error) {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Preview server: http://127.0.0.1:${port}/studio`);
    console.log(`Manifest source: ${resolve(process.cwd(), file)}`);
  });
}

async function publish() {
  if (!(await check())) return;
  const apiKey = process.env.SUNFISH_API_KEY;
  if (!apiKey) throw new Error("SUNFISH_API_KEY is required");
  const baseUrl = String(process.env.SUNFISH_BASE_URL || "https://sunfishloop.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(await loadManifest(file))
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `publish failed (${response.status})`);
  console.log(result.share_url ? `${baseUrl}${result.share_url}` : `Published private story ${result.id}`);
}

try {
  if (command === "init") await init();
  else if (command === "validate") await check();
  else if (command === "preview") await preview();
  else if (command === "publish") await publish();
  else usage();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
