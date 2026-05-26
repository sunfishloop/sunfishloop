/**
 * Mobile viewport touch swipe E2E (Playwright).
 * Run: node scripts/mobile-swipe-e2e.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.SUNFISHLOOP_BASE || "http://127.0.0.1:8001";
const profiles = [
  { name: "iPhone 13", device: devices["iPhone 13"] },
  { name: "Pixel 7", device: devices["Pixel 7"] }
];

async function waitForPost(page) {
  await page.waitForSelector("#slot-card .card-summary", { timeout: 15000 });
  return page.locator("#slot-card .card-summary").innerText();
}

async function swipeOnStage(page, direction) {
  const box = await page.locator("#loop-stage").boundingBox();
  if (!box) throw new Error("loop-stage not found");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.55;
  const dy = direction === "up" ? -120 : 120;
  await page.touchscreen.tap(cx, cy);
  await page.evaluate(
    ({ cx, cy, dy }) => {
      const el = document.querySelector("#loop-stage");
      const mk = (type, y) => {
        const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
        return new TouchEvent(type, {
          cancelable: true,
          bubbles: true,
          touches: type === "touchend" ? [] : [t],
          changedTouches: [t]
        });
      };
      el.dispatchEvent(mk("touchstart", cy));
      el.dispatchEvent(mk("touchmove", cy + dy * 0.5));
      el.dispatchEvent(mk("touchmove", cy + dy));
      el.dispatchEvent(mk("touchend", cy + dy));
    },
    { cx, cy, dy }
  );
  await page.waitForTimeout(900);
}

async function runProfile({ name, device }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const log = { profile: name, steps: [] };

  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
    const t1 = await waitForPost(page);
    log.steps.push({ step: "load", ok: Boolean(t1), preview: t1.slice(0, 40) });

    await swipeOnStage(page, "up");
    const t2 = await waitForPost(page);
    const changed = t2 !== t1;
    log.steps.push({ step: "swipe_up_next", ok: changed, preview: t2.slice(0, 40) });

    await page.evaluate(() => {
      const card = document.querySelector("#slot-card .card-scroll");
      if (card) card.scrollTop = card.scrollHeight;
    });
    await page.waitForTimeout(200);
    const before = await waitForPost(page);
    await swipeOnStage(page, "up");
    const after = await waitForPost(page);
    const fromBottom = after !== before;
    log.steps.push({ step: "scroll_bottom_swipe_up", ok: fromBottom, preview: after.slice(0, 40) });

    log.ok = log.steps.every((s) => s.ok);
  } catch (e) {
    log.ok = false;
    log.error = String(e.message || e);
  } finally {
    await browser.close();
  }
  return log;
}

async function main() {
  try {
    const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    const j = await h.json();
    if (!j.ok) throw new Error("health not ok");
  } catch {
    console.error(JSON.stringify({ ok: false, error: `Server not running at ${BASE}` }, null, 2));
    process.exit(1);
  }

  const results = [];
  for (const p of profiles) {
    const r = await runProfile(p);
    results.push(r);
    console.error(`[${r.ok ? "PASS" : "FAIL"}] ${r.profile}`, r.error || "");
    for (const s of r.steps) {
      console.error(`  ${s.ok ? "✓" : "✗"} ${s.step}`);
    }
  }

  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ ok, base: BASE, results }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
